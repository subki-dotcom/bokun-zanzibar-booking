// Transfer Admin booking management end to end against a real MongoDB, using a throwaway database that is
// dropped afterwards. Skipped when no MongoDB is reachable on 127.0.0.1:27017 (for example in CI).
const TEST_DB = `rt_admin_bookings_${process.pid}`;
process.env.NODE_ENV = "test";
process.env.MONGO_URI = `mongodb://127.0.0.1:27017/business_platform_test_${process.pid}`;
process.env.JWT_SECRET = "business-platform-test-secret-0123456789";
process.env.TRANSFERS_MONGO_URI = "mongodb://127.0.0.1:27017";
process.env.TRANSFERS_DB_NAME = TEST_DB;
process.env.TRANSFER_JWT_SECRET = "transfer-admin-test-secret-0123456789abcdef";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const mongoose = require("mongoose");

const app = require("../src/app");
const { getTransferStore, closeTransferStore } = require("../src/transfers/db/connection");
const { createTransferServices } = require("../src/transfers");

const PASSWORD = "Booking-Admin-Passw0rd";

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

const daysAhead = (days) => new Date(Date.now() + days * 86400000 + 3 * 3600000).toISOString().slice(0, 10);

test("Transfer Admin booking management against a real database", async (t) => {
  if (!(await mongoReachable())) {
    t.skip("MongoDB is not reachable on 127.0.0.1:27017");
    return;
  }
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, path, { token, body, headers = {} } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await response.json().catch(() => null);
    return { status: response.status, json, data: json?.data, code: json?.error?.code };
  };
  const login = async (email) => (await call("POST", "/transfer-admin/auth/login", { body: { email, password: PASSWORD } })).data.token;

  try {
    const store = await getTransferStore();
    const services = createTransferServices();
    await services.auth.createFirstAdmin({ name: "Admin", email: "admin@example.test", password: PASSWORD });
    const admin = await login("admin@example.test");
    for (const [email, role] of [["manager@example.test", "transfer_manager"], ["dispatcher@example.test", "dispatcher"], ["accountant@example.test", "transfer_accountant"]]) {
      await call("POST", "/transfer-admin/users", { token: admin, body: { name: role, email, role, password: PASSWORD } });
    }
    const manager = await login("manager@example.test");
    const dispatcher = await login("dispatcher@example.test");
    const accountant = await login("accountant@example.test");

    const actor = { id: "", email: "setup", role: "transfer_admin" };
    const zoneA = await services.catalog.createZone({ actor, input: { code: "A", name: "Zone A" } });
    const zoneB = await services.catalog.createZone({ actor, input: { code: "B", name: "Zone B" } });
    const zoneC = await services.catalog.createZone({ actor, input: { code: "C", name: "Zone C" } });
    const airport = await services.catalog.createLocation({ actor, input: { name: "Airport", type: "AIRPORT", zoneId: zoneA.id } });
    const hotel = await services.catalog.createLocation({ actor, input: { name: "Hotel", type: "HOTEL", zoneId: zoneB.id } });
    const villa = await services.catalog.createLocation({ actor, input: { name: "Villa", type: "AREA", zoneId: zoneC.id } });
    const route = await services.catalog.createRoute({ actor, input: { fromZoneId: zoneA.id, toZoneId: zoneB.id, bidirectional: true } });
    await services.catalog.createRate({ actor, input: { routeId: route.id, minPassengers: 1, maxPassengers: 5, price: "45" } });

    const bookingBody = (overrides = {}) => ({
      tripType: "ONE_WAY",
      pickupLocationId: airport.id,
      dropoffLocationId: hotel.id,
      travelDate: daysAhead(5),
      travelTime: "10:00",
      passengers: { adults: 2 },
      customer: { fullName: "Walk In", email: "walkin@example.test", phone: "+255 700 000 001", whatsapp: true },
      expectedTotal: "45.00",
      ...overrides
    });
    const website = (body) => call("POST", "/transfers/bookings", { body, headers: { "Idempotency-Key": crypto.randomUUID() } });
    const ctx = {};

    await t.test("an empty dashboard shows zeros, not invented figures", async () => {
      const dashboard = await call("GET", "/transfer-admin/dashboard", { token: manager });
      assert.equal(dashboard.status, 200);
      assert.equal(dashboard.data.total, 0);
      assert.deepEqual(dashboard.data.paidRevenue, { amount: "0.00", count: 0 });
      assert.deepEqual(dashboard.data.awaitingPayment, { amount: "0.00", count: 0 });
      assert.deepEqual(dashboard.data.upcoming, []);
    });

    await t.test("bookings come from the website: unpaid, online payment, and readable in Transfer Admin", async () => {
      const created = await website(bookingBody());
      assert.equal(created.status, 201);
      const stored = await store.models.Booking.findOne({ reference: created.data.reference }).lean();
      ctx.websiteId = String(stored._id);
      const detail = await call("GET", `/transfer-admin/bookings/${ctx.websiteId}`, { token: manager });
      assert.equal(detail.data.source, "WEBSITE");
      assert.equal(detail.data.status, "AWAITING_PAYMENT");
      assert.equal(detail.data.paymentStatus, "UNPAID");
      assert.equal(detail.data.paymentArrangement, "ONLINE");
      assert.equal(detail.data.pricing.total, "45.00");
      assert.equal(detail.data.pricingHistory[0].source, "ENGINE");
      assert.equal(detail.data.audit, undefined, "managers do not see the audit trail");
    });

    await t.test("no Transfer Admin role can create a booking through the API, and each attempt is audited", async () => {
      const before = await store.models.Booking.countDocuments();
      for (const token of [admin, manager, dispatcher, accountant]) {
        const attempt = await call("POST", "/transfer-admin/bookings", { token, body: { ...bookingBody({ travelTime: "11:00" }), manualChannel: "PHONE" }, headers: { "Idempotency-Key": crypto.randomUUID() } });
        assert.equal(attempt.status, 410);
        assert.equal(attempt.code, "TRANSFER_ADMIN_BOOKING_CREATION_DISABLED");
      }
      assert.equal((await call("POST", "/transfer-admin/bookings", { body: bookingBody() })).status, 401, "unauthenticated callers are refused before anything else");
      assert.equal(await store.models.Booking.countDocuments(), before, "nothing was created");
      const refused = await store.models.AuditLog.find({ action: "booking.create_refused" }).lean();
      assert.deepEqual(refused.map((entry) => entry.actorEmail).sort(), ["accountant@example.test", "admin@example.test", "dispatcher@example.test", "manager@example.test"]);
    });

    await t.test("cash on arrival cannot be approved for any booking, by any role", async () => {
      for (const token of [admin, manager]) {
        const attempt = await call("POST", `/transfer-admin/bookings/${ctx.websiteId}/approve-cash-on-arrival`, { token, body: { reason: "Pays the driver" } });
        assert.equal(attempt.status, 410);
        assert.equal(attempt.code, "TRANSFER_CASH_ON_ARRIVAL_DISABLED");
      }
      const unchanged = await store.models.Booking.findById(ctx.websiteId).lean();
      assert.equal(unchanged.status, "AWAITING_PAYMENT");
      assert.equal(unchanged.paymentStatus, "UNPAID");
      assert.equal(unchanged.paymentArrangement, "ONLINE");
      assert.equal(await store.models.AuditLog.countDocuments({ action: "booking.cash_on_arrival_refused", entityId: ctx.websiteId }), 2);
    });

    await t.test("no code path can confirm, mark paid, switch to cash or create a non-website booking without a verified payment", async () => {
      const { Booking } = store.models;
      const refusedWith = async (operation) => assert.rejects(operation, (error) => error.code === "TRANSFER_PAYMENT_RULE");
      await refusedWith(() => Booking.updateOne({ _id: ctx.websiteId }, { $set: { status: "CONFIRMED" } }));
      await refusedWith(() => Booking.findOneAndUpdate({ _id: ctx.websiteId }, { $set: { paymentStatus: "PAID" } }));
      await refusedWith(() => Booking.updateMany({}, { status: "CONFIRMED" }));
      await refusedWith(() => Booking.updateOne({ _id: ctx.websiteId }, { $set: { paymentArrangement: "CASH_ON_ARRIVAL" } }));
      await refusedWith(() => Booking.updateOne({ _id: ctx.websiteId }, { $set: { source: "MANUAL" } }));
      await refusedWith(() => Booking.updateOne({ reference: "TRF-NEWXXXXX" }, { $set: { status: "AWAITING_PAYMENT" } }, { upsert: true }));
      const document = await Booking.findById(ctx.websiteId);
      document.status = "CONFIRMED";
      await refusedWith(() => document.save());
      const copy = { ...(await Booking.findById(ctx.websiteId).select("+idempotencyKey +requestFingerprint +accessNonce").lean()), _id: undefined, reference: "TRF-COPYAAAA", idempotencyKey: crypto.randomUUID() };
      await refusedWith(() => Booking.create({ ...copy, source: "MANUAL" }));
      await refusedWith(() => Booking.create({ ...copy, paymentArrangement: "CASH_ON_ARRIVAL" }));
      await refusedWith(() => Booking.create({ ...copy, status: "CONFIRMED" }));
      await refusedWith(() => Booking.insertMany([{ ...copy, paymentStatus: "PAID" }]));
      const stored = await Booking.findById(ctx.websiteId).lean();
      assert.deepEqual([stored.status, stored.paymentStatus, stored.paymentArrangement, stored.source], ["AWAITING_PAYMENT", "UNPAID", "ONLINE", "WEBSITE"]);
      // The payment phase confirms a booking only with a verified payment, which it marks explicitly.
      const verified = await Booking.findOneAndUpdate({ _id: ctx.websiteId }, { $set: { status: "CONFIRMED", paymentStatus: "PAID" } }, { new: true, verifiedPayment: true }).lean();
      assert.equal(verified.status, "CONFIRMED");
      ctx.paidId = ctx.websiteId;
    });

    await t.test("historical manual and cash-on-arrival bookings stay readable", async () => {
      // A record written before these rules existed, inserted directly as it would already be in the database.
      const legacy = await store.models.Booking.findById(ctx.websiteId).select("+idempotencyKey +requestFingerprint +accessNonce").lean();
      const { insertedId } = await store.connection.db.collection("transfer_bookings").insertOne({
        ...legacy, _id: new mongoose.Types.ObjectId(), reference: "TRF-LEGACY22", idempotencyKey: crypto.randomUUID(), source: "MANUAL", manualChannel: "WHATSAPP",
        createdBy: { id: "", email: "manager@example.test" }, status: "CONFIRMED", paymentStatus: "UNPAID", paymentArrangement: "CASH_ON_ARRIVAL",
        customer: { fullName: "Legacy Guest", email: "legacy@example.test", phone: "+255 700 000 077", whatsapp: false }
      });
      ctx.legacyId = String(insertedId);
      const detail = await call("GET", `/transfer-admin/bookings/${ctx.legacyId}`, { token: manager });
      assert.equal(detail.status, 200);
      assert.deepEqual([detail.data.source, detail.data.manualChannel, detail.data.paymentArrangement, detail.data.createdBy.email], ["MANUAL", "WHATSAPP", "CASH_ON_ARRIVAL", "manager@example.test"]);
      const listed = await call("GET", "/transfer-admin/bookings?source=MANUAL", { token: accountant });
      assert.deepEqual(listed.data.items.map((item) => item.reference), ["TRF-LEGACY22"]);
      assert.equal((await call("POST", `/transfer-admin/bookings/${ctx.legacyId}/reject`, { token: manager, body: { reason: "too late" } })).code, "TRANSFER_INVALID_TRANSITION", "a confirmed booking cannot be rejected");
    });

    await t.test("dispatchers and accountants can view bookings but not change them", async () => {
      assert.equal((await call("GET", "/transfer-admin/bookings", { token: dispatcher })).status, 200);
      assert.equal((await call("GET", "/transfer-admin/bookings", { token: accountant })).status, 200);
      assert.equal((await call("POST", `/transfer-admin/bookings/${ctx.websiteId}/reject`, { token: accountant, body: { reason: "test reason" } })).status, 403);
      assert.equal((await call("GET", "/transfer-admin/bookings")).status, 401);
    });

    await t.test("a quote request gets an admin price, keeping the original pricing snapshot", async () => {
      const request = await website(bookingBody({ pickupLocationId: airport.id, dropoffLocationId: villa.id, expectedTotal: null, customer: { fullName: "Quote Me", email: "quote@example.test", phone: "+255 700 000 002" }, tripType: "ROUND_TRIP", returnDate: daysAhead(8), returnTime: "09:00" }));
      assert.equal(request.data.booking.status, "QUOTE_REQUESTED");
      const stored = await store.models.Booking.findOne({ reference: request.data.reference }).lean();
      ctx.quoteId = String(stored._id);
      const quoteUrl = `/transfer-admin/bookings/${ctx.quoteId}/quote`;
      assert.equal((await call("POST", quoteUrl, { token: manager, body: { legs: [{ direction: "OUTBOUND", price: "60" }], reason: "Villa run" } })).code, "TRANSFER_QUOTE_LEGS_MISMATCH");
      assert.equal((await call("POST", quoteUrl, { token: manager, body: { legs: [{ direction: "OUTBOUND", price: "60" }, { direction: "RETURN", price: "0" }], reason: "Villa run" } })).status, 422);
      const quoted = await call("POST", quoteUrl, { token: manager, body: { legs: [{ direction: "OUTBOUND", price: "60" }, { direction: "RETURN", price: "55.50" }], reason: "Villa run, private road" } });
      assert.equal(quoted.status, 200);
      assert.equal(quoted.data.status, "AWAITING_PAYMENT");
      assert.equal(quoted.data.paymentStatus, "UNPAID");
      assert.equal(quoted.data.pricing.total, "115.50");
      assert.deepEqual(quoted.data.pricingHistory.map((entry) => [entry.source, entry.status, entry.total]), [
        ["ENGINE", "QUOTE_REQUIRED", null],
        ["ADMIN_QUOTE", "PRICED", "115.50"]
      ]);
      assert.equal((await call("POST", quoteUrl, { token: manager, body: { legs: [{ direction: "OUTBOUND", price: "1" }, { direction: "RETURN", price: "1" }], reason: "again" } })).code, "TRANSFER_INVALID_TRANSITION");
    });

    await t.test("two staff pricing the same quote request at the same moment: exactly one price is kept", async () => {
      const request = await website(bookingBody({ dropoffLocationId: villa.id, expectedTotal: null, travelTime: "15:00", customer: { fullName: "Race", email: "race@example.test", phone: "+255 700 000 003" } }));
      const stored = await store.models.Booking.findOne({ reference: request.data.reference }).lean();
      const results = await Promise.all(["70", "75"].map((price, index) =>
        call("POST", `/transfer-admin/bookings/${stored._id}/quote`, { token: index ? manager : admin, body: { legs: [{ direction: "OUTBOUND", price }], reason: "price it" } })));
      assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
      const final = await store.models.Booking.findById(stored._id).lean();
      assert.equal(final.status, "AWAITING_PAYMENT");
      assert.equal(final.paymentStatus, "UNPAID", "pricing a quote never marks it paid");
      assert.equal(final.pricingHistory.filter((entry) => entry.source === "ADMIN_QUOTE").length, 1);
      assert.equal(final.statusHistory.length, 2);
    });

    await t.test("rejection needs a reason and the customer sees it on their status page", async () => {
      const created = await website(bookingBody({ travelTime: "18:00", customer: { fullName: "Reject Me", email: "reject@example.test", phone: "+255 700 000 004" } }));
      const stored = await store.models.Booking.findOne({ reference: created.data.reference }).lean();
      assert.equal((await call("POST", `/transfer-admin/bookings/${stored._id}/reject`, { token: manager, body: {} })).status, 422);
      const rejected = await call("POST", `/transfer-admin/bookings/${stored._id}/reject`, { token: manager, body: { reason: "No vehicle that day" } });
      assert.equal(rejected.data.status, "REJECTED");
      const publicView = await call("GET", `/transfers/bookings/${created.data.reference}`, { headers: { "X-Transfer-Access-Token": created.data.accessToken } });
      assert.equal(publicView.data.status, "REJECTED");
    });

    await t.test("staff can issue the customer's private link, and each issue is audited", async () => {
      const link = await call("POST", `/transfer-admin/bookings/${ctx.quoteId}/customer-link`, { token: manager });
      assert.match(link.data.path, /^\/transfers\/booking\/TRF-[2-9A-HJKMNP-Z]{8}#t=/);
      const token = decodeURIComponent(link.data.path.split("#t=")[1]);
      assert.equal((await call("GET", `/transfers/bookings/${link.data.reference}`, { headers: { "X-Transfer-Access-Token": token } })).status, 200);
      assert.equal((await call("POST", `/transfer-admin/bookings/${ctx.quoteId}/customer-link`, { token: dispatcher })).status, 403);
      assert.equal(await store.models.AuditLog.countDocuments({ action: "booking.customer_link_issued", entityId: ctx.quoteId }), 1);
    });

    await t.test("the list filters, searches and paginates", async () => {
      const all = await call("GET", "/transfer-admin/bookings?limit=2", { token: manager });
      assert.equal(all.data.items.length, 2);
      assert.equal(all.data.pagination.total, await store.models.Booking.countDocuments());
      assert.equal(all.data.pagination.totalPages, Math.ceil(all.data.pagination.total / 2));
      const quoted = await call("GET", "/transfer-admin/bookings?status=AWAITING_PAYMENT,QUOTE_REQUESTED&source=WEBSITE", { token: manager });
      assert.ok(quoted.data.items.every((item) => ["AWAITING_PAYMENT", "QUOTE_REQUESTED"].includes(item.status) && item.source === "WEBSITE"));
      const search = await call("GET", "/transfer-admin/bookings?search=quote%40example", { token: manager });
      assert.deepEqual(search.data.items.map((item) => item.customer.email), ["quote@example.test"]);
      const injection = await call("GET", "/transfer-admin/bookings?search=.*", { token: manager });
      assert.equal(injection.data.items.length, 0, "search input is treated as text, not a pattern");
    });

    await t.test("the dashboard counts real bookings and never counts unpaid bookings as revenue", async () => {
      const dashboard = (await call("GET", "/transfer-admin/dashboard", { token: accountant })).data;
      const stored = await store.models.Booking.find({}).lean();
      assert.equal(dashboard.total, stored.length);
      for (const status of ["QUOTE_REQUESTED", "AWAITING_PAYMENT", "CONFIRMED", "REJECTED"]) {
        assert.equal(dashboard.counts[status], stored.filter((booking) => booking.status === status).length, status);
      }
      const paid = stored.filter((booking) => booking.paymentStatus === "PAID");
      assert.deepEqual(dashboard.paidRevenue, { amount: paid.reduce((sum, booking) => sum + Number(booking.pricing.total.toString()), 0).toFixed(2), count: paid.length }, "only verified payments are revenue");
      assert.equal(paid.length, 1);
      const awaiting = stored.filter((booking) => booking.status === "AWAITING_PAYMENT");
      assert.equal(dashboard.awaitingPayment.count, awaiting.length);
      assert.equal(dashboard.awaitingPayment.amount, awaiting.reduce((sum, booking) => sum + Number(booking.pricing.total.toString()), 0).toFixed(2));
      assert.equal(dashboard.cashToCollect, undefined, "the dashboard no longer reports cash to collect");
      assert.ok(dashboard.upcoming.length > 0);
      assert.equal(dashboard.createdToday, stored.length);
    });

    await t.test("every booking change is audited with before and after", async () => {
      const entries = (await call("GET", `/transfer-admin/bookings/${ctx.quoteId}`, { token: admin })).data.audit;
      assert.deepEqual(entries.map((entry) => entry.action), ["booking.created", "booking.quoted", "booking.customer_link_issued"]);
      const quotedEntry = await store.models.AuditLog.findOne({ action: "booking.quoted", entityId: ctx.quoteId }).lean();
      assert.equal(quotedEntry.before.status, "QUOTE_REQUESTED");
      assert.equal(quotedEntry.after.status, "AWAITING_PAYMENT");
      assert.equal(quotedEntry.actorEmail, "manager@example.test");
      for (const action of ["booking.created", "booking.rejected", "booking.create_refused", "booking.cash_on_arrival_refused"]) {
        assert.ok(await store.models.AuditLog.countDocuments({ action }), action);
      }
      for (const action of ["booking.created_manually", "booking.approved_cash_on_arrival"]) {
        assert.equal(await store.models.AuditLog.countDocuments({ action }), 0, `${action} no longer happens`);
      }
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    const store = await getTransferStore().catch(() => null);
    if (store) await store.connection.db.dropDatabase();
    await closeTransferStore();
  }
});
