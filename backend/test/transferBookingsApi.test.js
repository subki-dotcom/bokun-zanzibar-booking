// Public transfer booking API end to end against a real MongoDB, using a throwaway database that is dropped
// afterwards. Skipped when no MongoDB is reachable on 127.0.0.1:27017 (for example in CI).
const TEST_DB = `riser_transfers_booking_test_${process.pid}`;
const BUSINESS_DB = `business_platform_test_${process.pid}`;
process.env.NODE_ENV = "test";
process.env.MONGO_URI = `mongodb://127.0.0.1:27017/${BUSINESS_DB}`;
process.env.JWT_SECRET = "business-platform-test-secret-0123456789";
process.env.TRANSFERS_MONGO_URI = "mongodb://127.0.0.1:27017";
process.env.TRANSFERS_DB_NAME = TEST_DB;
process.env.TRANSFER_JWT_SECRET = "transfer-admin-test-secret-0123456789abcdef";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const express = require("express");
const mongoose = require("mongoose");

const app = require("../src/app");
const errorHandler = require("../src/middleware/errorHandler");
const { getTransferStore, closeTransferStore } = require("../src/transfers/db/connection");
const { createTransferServices } = require("../src/transfers");
const { createTransferPublicRouter } = require("../src/transfers/routes/public.routes");

const mongoReachable = async () => {
  const probe = mongoose.createConnection("mongodb://127.0.0.1:27017/admin", { serverSelectionTimeoutMS: 1500 });
  try {
    await probe.asPromise();
    return true;
  } catch (_error) {
    return false;
  } finally {
    await probe.close().catch(() => {});
  }
};

const listen = async (handler) => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
};

// A Zanzibar-local date some days ahead, as the form sends it.
const daysAhead = (days) => new Date(Date.now() + days * 86400000 + 3 * 3600000).toISOString().slice(0, 10);

test("public transfer booking API against a real database", async (t) => {
  if (!(await mongoReachable())) {
    t.skip("MongoDB is not reachable on 127.0.0.1:27017");
    return;
  }

  const services = createTransferServices();
  // Generous limits for the behavioural tests; the real limits are checked separately below.
  const testApp = express();
  testApp.use(express.json());
  testApp.use("/api/transfers", createTransferPublicRouter({ bookings: services.bookings, limits: { locations: 1000, quote: 1000, bookings: 1000, lookup: 1000 } }));
  testApp.use(errorHandler);
  const { server, base } = await listen(testApp);

  const call = async (method, path, { body, headers = {} } = {}) => {
    const response = await fetch(`${base}/api/transfers${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await response.json().catch(() => null);
    return { status: response.status, json, data: json?.data, code: json?.error?.code, headers: response.headers };
  };
  const key = () => crypto.randomUUID();
  const book = (body, idempotencyKey = key()) => call("POST", "/bookings", { body, headers: { "Idempotency-Key": idempotencyKey } });

  try {
    const store = await getTransferStore();
    const actor = { id: "", email: "setup", role: "transfer_admin" };
    const { catalog } = services;
    const zoneA = await catalog.createZone({ actor, input: { code: "A", name: "Zone A" } });
    const zoneB = await catalog.createZone({ actor, input: { code: "B", name: "Zone B" } });
    const zoneOff = await catalog.createZone({ actor, input: { code: "OFF", name: "Closed zone", active: false } });
    const airport = await catalog.createLocation({ actor, input: { name: "Airport", type: "AIRPORT", zoneId: zoneA.id } });
    const hotel = await catalog.createLocation({ actor, input: { name: "Beach Hotel", type: "HOTEL", zoneId: zoneB.id } });
    await catalog.createLocation({ actor, input: { name: "Hidden", type: "AREA", zoneId: zoneOff.id } });
    await catalog.createLocation({ actor, input: { name: "Retired", type: "AREA", zoneId: zoneA.id, active: false } });
    const route = await catalog.createRoute({ actor, input: { fromZoneId: zoneA.id, toZoneId: zoneB.id, bidirectional: true } });
    await catalog.createRate({ actor, input: { routeId: route.id, minPassengers: 1, maxPassengers: 5, price: "45" } });

    const booking = (overrides = {}) => ({
      tripType: "ONE_WAY",
      pickupLocationId: airport.id,
      dropoffLocationId: hotel.id,
      travelDate: daysAhead(10),
      travelTime: "14:30",
      passengers: { adults: 2, children: 1, infants: 1 },
      luggage: { largeBags: 2, smallBags: 2, notes: "One surfboard" },
      flightNumber: "PW 721",
      pickupAddress: "Arrivals hall",
      dropoffAddress: "Room 12, Beach Hotel",
      customer: { fullName: "Jane Doe", email: "Jane.Doe@example.com", phone: "+255 712 345 678", whatsapp: true },
      specialRequests: "Child seat please",
      expectedTotal: "45.00",
      ...overrides
    });

    await t.test("locations list only active places in active zones, without internal zone data", async () => {
      const result = await call("GET", "/locations");
      assert.equal(result.status, 200);
      assert.equal(result.headers.get("cache-control"), "no-store");
      assert.deepEqual(result.data.map((location) => location.name).sort(), ["Airport", "Beach Hotel"]);
      assert.deepEqual(Object.keys(result.data[0]).sort(), ["id", "name", "type"]);
    });

    await t.test("options give the booking horizon and online payment as the only, not yet available, method", async () => {
      const result = await call("GET", "/options");
      assert.equal(result.status, 200);
      assert.equal(result.headers.get("cache-control"), "no-store");
      assert.deepEqual(result.data, { currency: "USD", maxAdvanceDays: 730, payment: { methods: ["PESAPAL"], onlineAvailable: false } });
    });

    await t.test("quotes are priced by the server and expose no route or rate ids", async () => {
      const quote = await call("POST", "/quote", { body: { tripType: "ROUND_TRIP", pickupLocationId: airport.id, dropoffLocationId: hotel.id, passengers: { adults: 3 } } });
      assert.equal(quote.data.status, "PRICED");
      assert.equal(quote.data.total, "90.00");
      assert.equal(JSON.stringify(quote.data).includes(route.id), false);
      const tooMany = await call("POST", "/quote", { body: { pickupLocationId: airport.id, dropoffLocationId: hotel.id, passengers: { adults: 6 } } });
      assert.equal(tooMany.data.status, "QUOTE_REQUIRED");
      assert.equal(tooMany.data.total, null);
    });

    await t.test("a priced booking is stored as awaiting payment, never confirmed, in the transfer database only", async () => {
      const result = await book(booking());
      assert.equal(result.status, 201);
      assert.match(result.data.reference, /^TRF-[2-9A-HJKMNP-Z]{8}$/);
      assert.ok(result.data.accessToken.length >= 40);
      assert.equal(result.data.booking.status, "AWAITING_PAYMENT");
      assert.equal(result.data.booking.paymentStatus, "UNPAID");
      assert.equal(result.data.booking.pricing.total, "45.00");
      assert.equal(result.data.booking.customer.email, "j******@example.com");

      const stored = await store.models.Booking.findOne({ reference: result.data.reference }).lean();
      assert.equal(stored.status, "AWAITING_PAYMENT");
      assert.equal(stored.customer.email, "jane.doe@example.com");
      assert.equal(stored.passengers.capacity, 4);
      assert.equal(stored.legs[0].pickupAt.toISOString(), new Date(`${daysAhead(10)}T14:30:00+03:00`).toISOString());
      assert.equal(stored.accessNonce, undefined, "nonce is not selected by default");
      assert.equal(JSON.stringify(stored).includes(result.data.accessToken), false, "the access token is not stored");

      const business = mongoose.createConnection(`mongodb://127.0.0.1:27017/${BUSINESS_DB}`);
      await business.asPromise();
      assert.equal((await business.db.listCollections().toArray()).length, 0);
      await business.close();
    });

    await t.test("retrying with the same Idempotency-Key returns the same booking instead of a duplicate", async () => {
      const idempotencyKey = key();
      const first = await book(booking({ travelTime: "08:00" }), idempotencyKey);
      const again = await book(booking({ travelTime: "08:00" }), idempotencyKey);
      assert.equal(first.status, 201);
      assert.equal(again.status, 200);
      assert.equal(again.data.replayed, true);
      assert.equal(again.data.reference, first.data.reference);
      assert.equal(again.data.accessToken, first.data.accessToken);
      assert.equal(await store.models.Booking.countDocuments({ "legs.localTime": "08:00" }), 1);

      const different = await book(booking({ travelTime: "09:00" }), idempotencyKey);
      assert.equal(different.code, "TRANSFER_IDEMPOTENCY_KEY_REUSED");
      assert.equal((await call("POST", "/bookings", { body: booking() })).code, "TRANSFER_IDEMPOTENCY_KEY_REQUIRED");
      assert.equal((await book(booking(), "short")).code, "TRANSFER_IDEMPOTENCY_KEY_REQUIRED");
    });

    await t.test("simultaneous double submissions create exactly one booking", async () => {
      const idempotencyKey = key();
      const results = await Promise.all(Array.from({ length: 8 }, () => book(booking({ travelTime: "11:11" }), idempotencyKey)));
      assert.ok(results.every((result) => result.status === 200 || result.status === 201), results.map((result) => result.status).join(","));
      assert.equal(new Set(results.map((result) => result.data.reference)).size, 1);
      assert.equal(await store.models.Booking.countDocuments({ "legs.localTime": "11:11" }), 1);
    });

    await t.test("the server re-prices at submission and refuses a booking whose price changed", async () => {
      const before = await store.models.Booking.countDocuments();
      const stale = await book(booking({ expectedTotal: "40.00" }));
      assert.equal(stale.status, 409);
      assert.equal(stale.code, "TRANSFER_PRICE_CHANGED");
      assert.equal(stale.json.error.details.quote.total, "45.00");
      assert.equal((await book(booking({ expectedTotal: null }))).code, "TRANSFER_PRICE_CHANGED");
      assert.equal((await book(booking({ total: "1.00" }))).status, 422, "a client price field is rejected");
      assert.equal((await book(booking({ pricing: { total: "1" } }))).status, 422);
      assert.equal(await store.models.Booking.countDocuments(), before);
    });

    await t.test("without a rate the booking is a quote request with no invented price", async () => {
      const result = await book(booking({ passengers: { adults: 6 }, expectedTotal: null }));
      assert.equal(result.status, 201);
      assert.equal(result.data.booking.status, "QUOTE_REQUESTED");
      assert.equal(result.data.booking.pricing.total, null);
      assert.equal(result.data.booking.legs[0].price, null);
      assert.equal((await book(booking({ passengers: { adults: 6 }, expectedTotal: "45.00" }))).code, "TRANSFER_PRICE_CHANGED");
    });

    await t.test("round trips price both legs and need a return after the outbound transfer", async () => {
      const result = await book(booking({ tripType: "ROUND_TRIP", returnDate: daysAhead(14), returnTime: "10:00", expectedTotal: "90.00" }));
      assert.equal(result.status, 201);
      assert.deepEqual(result.data.booking.legs.map((leg) => [leg.direction, leg.pickupLocationName, leg.dropoffLocationName, leg.price]), [
        ["OUTBOUND", "Airport", "Beach Hotel", "45.00"],
        ["RETURN", "Beach Hotel", "Airport", "45.00"]
      ]);
      assert.equal((await book(booking({ tripType: "ROUND_TRIP", returnDate: daysAhead(9), returnTime: "10:00", expectedTotal: "90.00" }))).code, "TRANSFER_INVALID_SCHEDULE");
      assert.equal((await book(booking({ tripType: "ROUND_TRIP", expectedTotal: "90.00" }))).status, 422);
      assert.equal((await book(booking({ returnDate: daysAhead(14), returnTime: "10:00" }))).status, 422);
    });

    await t.test("dates in the past, impossible dates and filled honeypots are rejected", async () => {
      assert.equal((await book(booking({ travelDate: daysAhead(-1) }))).code, "TRANSFER_INVALID_SCHEDULE");
      assert.equal((await book(booking({ travelDate: "2027-02-30" }))).code, "TRANSFER_INVALID_SCHEDULE");
      assert.equal((await book(booking({ travelDate: daysAhead(800) }))).code, "TRANSFER_INVALID_SCHEDULE");
      assert.equal((await book(booking({ website: "http://spam.example" }))).status, 422);
      assert.equal((await book(booking({ pickupLocationId: hotel.id }))).code, "TRANSFER_SAME_LOCATION");
      assert.equal((await book(booking({ customer: { fullName: "J", email: "bad", phone: "x" } }))).status, 422);
    });

    await t.test("the booking horizon set by the admin limits how far ahead customers can book", async () => {
      await catalog.updateSettings({ actor, input: { maxAdvanceDays: 30, reason: "test" } });
      const tooFar = await book(booking({ travelDate: daysAhead(40) }));
      assert.equal(tooFar.code, "TRANSFER_INVALID_SCHEDULE");
      assert.match(tooFar.json.message, /up to 30 days ahead/);
      assert.equal((await book(booking({ travelDate: daysAhead(20), travelTime: "07:15" }))).status, 201);
      await catalog.updateSettings({ actor, input: { maxAdvanceDays: 730 } });
      assert.equal((await book(booking({ flightNumber: "kq-488", travelTime: "07:45" }))).status, 201);
    });

    await t.test("a booking opens only with its own access token; the reference alone is not enough", async () => {
      const mine = await book(booking({ travelTime: "16:45" }));
      const other = await book(booking({ travelTime: "17:45" }));
      const lookup = (reference, token) => call("GET", `/bookings/${reference}`, { headers: token ? { "X-Transfer-Access-Token": token } : {} });

      const ok = await lookup(mine.data.reference, mine.data.accessToken);
      assert.equal(ok.status, 200);
      assert.equal(ok.data.reference, mine.data.reference);
      assert.equal(ok.data.customer.email, "j******@example.com");
      assert.equal(ok.data.customer.phone, "+•••••••••678");
      const json = JSON.stringify(ok.data);
      for (const hidden of ["jane.doe@example.com", "712 345", "_id", "accessNonce", "idempotencyKey", "routeId", "rateId", "pickupLocationId", airport.id]) {
        assert.equal(json.includes(hidden), false, hidden);
      }
      assert.equal((await lookup(mine.data.reference.toLowerCase(), mine.data.accessToken)).status, 200);

      const noToken = await lookup(mine.data.reference);
      const wrongToken = await lookup(mine.data.reference, other.data.accessToken);
      const missing = await lookup("TRF-ZZZZZZZZ", mine.data.accessToken);
      const malformed = await lookup("not-a-reference", mine.data.accessToken);
      for (const result of [noToken, wrongToken, missing, malformed]) {
        assert.equal(result.status, 404);
        assert.equal(result.code, "TRANSFER_BOOKING_NOT_FOUND");
      }
    });

    await t.test("each booking is in the transfer audit log without its secrets", async () => {
      const entries = await store.models.AuditLog.find({ action: "booking.created" }).lean();
      assert.equal(entries.length, await store.models.Booking.countDocuments());
      const text = JSON.stringify(entries);
      assert.equal(/accessNonce|idempotencyKey|requestFingerprint/.test(text), false);
      assert.equal(entries[0].actorRole, "customer");
    });

    await t.test("the real rate limit stops a burst of booking submissions from one address", async () => {
      const limited = express();
      limited.use(express.json());
      limited.use("/api/transfers", createTransferPublicRouter({ bookings: services.bookings }));
      limited.use(errorHandler);
      const { server: limitedServer, base: limitedBase } = await listen(limited);
      try {
        const statuses = [];
        for (let attempt = 0; attempt < 11; attempt += 1) {
          const response = await fetch(`${limitedBase}/api/transfers/bookings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          statuses.push(response.status);
        }
        assert.deepEqual(statuses.slice(0, 10), Array(10).fill(422));
        assert.equal(statuses[10], 429);
      } finally {
        await new Promise((resolve) => limitedServer.close(resolve));
      }
    });

    await t.test("the website-facing app mounts the public API at /api/transfers", async () => {
      const { server: realServer, base: realBase } = await listen(app);
      try {
        const response = await fetch(`${realBase}/api/transfers/locations`);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).data.length, 2);
      } finally {
        await new Promise((resolve) => realServer.close(resolve));
      }
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    const store = await getTransferStore().catch(() => null);
    if (store) await store.connection.db.dropDatabase();
    await closeTransferStore();
  }
});
