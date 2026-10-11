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
    const manual = (body, token = manager, key = crypto.randomUUID()) => call("POST", "/transfer-admin/bookings", { token, body, headers: { "Idempotency-Key": key } });
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

    await t.test("staff create manual bookings priced by the server, once per Idempotency-Key", async () => {
      const key = crypto.randomUUID();
      const first = await manual(bookingBody({ manualChannel: "WHATSAPP" }), manager, key);
      const retry = await manual(bookingBody({ manualChannel: "WHATSAPP" }), manager, key);
      assert.equal(first.status, 201);
      assert.equal(retry.status, 200);
      assert.equal(retry.data.reference, first.data.reference);
      assert.equal(await store.models.Booking.countDocuments({ "customer.email": "walkin@example.test" }), 1);
      ctx.manualId = first.data.id;
      const detail = await call("GET", `/transfer-admin/bookings/${first.data.id}`, { token: manager });
      assert.equal(detail.data.source, "MANUAL");
      assert.equal(detail.data.manualChannel, "WHATSAPP");
      assert.equal(detail.data.status, "AWAITING_PAYMENT");
      assert.equal(detail.data.pricing.total, "45.00");
      assert.equal(detail.data.createdBy.email, "manager@example.test");
      assert.equal(detail.data.pricingHistory[0].source, "ENGINE");
      assert.equal(detail.data.audit, undefined, "managers do not see the audit trail");
      assert.equal((await manual(bookingBody({ manualChannel: "PHONE", expectedTotal: "1.00" }))).code, "TRANSFER_PRICE_CHANGED");
      assert.equal((await manual(bookingBody({ manualChannel: "PHONE", price: "1" }))).status, 422);
    });

    await t.test("simultaneous manual submissions all get the same booking id back", async () => {
      const key = crypto.randomUUID();
      const body = bookingBody({ manualChannel: "EMAIL", travelTime: "13:13", customer: { fullName: "Burst", email: "burst@example.test", phone: "+255 700 000 009" } });
      const results = await Promise.all(Array.from({ length: 6 }, () => manual(body, manager, key)));
      assert.ok(results.every((result) => [200, 201].includes(result.status)), results.map((result) => result.status).join(","));
      assert.equal(new Set(results.map((result) => result.data.id)).size, 1);
      assert.match(results[0].data.id, /^[a-f0-9]{24}$/);
      assert.ok(results.every((result) => /^[a-f0-9]{24}$/.test(result.data.id)), "every response, including replays, carries the id");
      assert.equal(await store.models.Booking.countDocuments({ "customer.email": "burst@example.test" }), 1);
    });

    await t.test("a likely duplicate needs an explicit reason", async () => {
      const duplicate = await manual(bookingBody({ manualChannel: "PHONE" }));
      assert.equal(duplicate.code, "TRANSFER_POSSIBLE_DUPLICATE");
      assert.equal(duplicate.json.error.details.id, ctx.manualId);
      assert.equal((await manual(bookingBody({ manualChannel: "PHONE", allowDuplicate: true }))).code, "TRANSFER_DUPLICATE_REASON_REQUIRED");
      const accepted = await manual(bookingBody({ manualChannel: "PHONE", allowDuplicate: true, duplicateReason: "Second vehicle for the same group" }));
      assert.equal(accepted.status, 201);
      const audit = await store.models.AuditLog.findOne({ entityId: accepted.data.id, action: "booking.created_manually" }).lean();
      assert.match(audit.reason, /Second vehicle/);
    });

    await t.test("dispatchers and accountants can view bookings but not change them", async () => {
      assert.equal((await call("GET", "/transfer-admin/bookings", { token: dispatcher })).status, 200);
      assert.equal((await call("GET", "/transfer-admin/bookings", { token: accountant })).status, 200);
      assert.equal((await manual(bookingBody({ manualChannel: "PHONE", travelTime: "11:00" }), dispatcher)).status, 403);
      assert.equal((await call("POST", `/transfer-admin/bookings/${ctx.manualId}/reject`, { token: accountant, body: { reason: "test reason" } })).status, 403);
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

    await t.test("cash on arrival confirms the booking but leaves it unpaid", async () => {
      const approved = await call("POST", `/transfer-admin/bookings/${ctx.manualId}/approve-cash-on-arrival`, { token: manager, body: { reason: "Regular guest, pays driver" } });
      assert.equal(approved.status, 200);
      assert.equal(approved.data.status, "CONFIRMED");
      assert.equal(approved.data.paymentStatus, "UNPAID");
      assert.equal(approved.data.paymentArrangement, "CASH_ON_ARRIVAL");
      assert.equal((await call("POST", `/transfer-admin/bookings/${ctx.manualId}/reject`, { token: manager, body: { reason: "too late" } })).code, "TRANSFER_INVALID_TRANSITION");
      assert.equal((await call("POST", `/transfer-admin/bookings/${ctx.manualId}/approve-cash-on-arrival`, { token: manager, body: { reason: "x" } })).status, 422, "a reason is required");
    });

    await t.test("approve and reject at the same moment: exactly one wins", async () => {
      const contested = await manual(bookingBody({ manualChannel: "EMAIL", travelTime: "15:00", customer: { fullName: "Race", email: "race@example.test", phone: "+255 700 000 003" } }));
      const [approve, rejectResult] = await Promise.all([
        call("POST", `/transfer-admin/bookings/${contested.data.id}/approve-cash-on-arrival`, { token: admin, body: { reason: "approve it" } }),
        call("POST", `/transfer-admin/bookings/${contested.data.id}/reject`, { token: manager, body: { reason: "reject it" } })
      ]);
      assert.deepEqual([approve.status, rejectResult.status].sort(), [200, 409]);
      const final = await store.models.Booking.findById(contested.data.id).lean();
      assert.ok(["CONFIRMED", "REJECTED"].includes(final.status));
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
      assert.deepEqual(dashboard.paidRevenue, { amount: "0.00", count: 0 }, "nothing is paid yet");
      const awaiting = stored.filter((booking) => booking.status === "AWAITING_PAYMENT");
      assert.equal(dashboard.awaitingPayment.count, awaiting.length);
      assert.equal(dashboard.awaitingPayment.amount, awaiting.reduce((sum, booking) => sum + Number(booking.pricing.total.toString()), 0).toFixed(2));
      assert.equal(dashboard.cashToCollect.count, stored.filter((booking) => booking.paymentArrangement === "CASH_ON_ARRIVAL" && booking.status === "CONFIRMED").length);
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
      for (const action of ["booking.created_manually", "booking.approved_cash_on_arrival", "booking.rejected"]) {
        assert.ok(await store.models.AuditLog.countDocuments({ action }), action);
      }
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    const store = await getTransferStore().catch(() => null);
    if (store) await store.connection.db.dropDatabase();
    await closeTransferStore();
  }
});
