// Phase 3C: the read-only Finance escalation queue. Launches its own throwaway mongod; no network.
process.env.NODE_ENV = "test";
process.env.MONGO_URI = "mongodb://127.0.0.1:1/unused-finance-escalations";
process.env.JWT_SECRET = "finance-escalations-fixture-secret";
process.env.BOKUN_MOCK_MODE = "true";
process.env.EMAIL_ENABLED = "false";
process.env.TRUST_PROXY = "1";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const { latestEscalation } = require("../src/services/financeEscalations");
const { issueBookingAccessToken } = require("../src/security/bookingAccess");

test("latest escalation comes from the recorded history only", () => {
  assert.equal(latestEscalation({}), null);
  assert.equal(latestEscalation({ operations: { state: "AWAITING_FINANCE", history: [] } }), null, "no invented escalation");
  const at = new Date("2026-10-01T10:00:00Z");
  const later = new Date("2026-10-02T10:00:00Z");
  const result = latestEscalation({ operations: { history: [
    { action: "escalated", escalatedTo: "FINANCE", text: "first", at, actorId: "a", actorRole: "tour_admin", fromState: "RECEIVED" },
    { action: "escalated", escalatedTo: "SUPPLIER", text: "supplier", at: later },
    { action: "escalated", escalatedTo: "FINANCE", text: "", at: later, actorId: "b", actorRole: "tour_admin", fromState: "UNDER_REVIEW" }
  ] } });
  assert.deepEqual(result, { reason: "", at: later, fromState: "UNDER_REVIEW", actorId: "b", actorRole: "tour_admin" });
});

const binary = process.env.MONGOD_BINARY || (process.platform === "win32" ? "C:/Program Files/MongoDB/Server/8.2/bin/mongod.exe" : "/usr/bin/mongod");

// Required for Phase 3C: fail loudly instead of skipping when MongoDB is not installed.
test("isolated Mongo: Finance escalation queue over HTTP", { timeout: 180000 }, async (t) => {
  assert.ok(fs.existsSync(binary), `mongod not found at ${binary}; set MONGOD_BINARY`);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "finance-escalations-test-"));
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(binary, ["--bind_ip", "127.0.0.1", "--port", String(port), "--dbpath", directory, "--quiet"], { windowsHide: true, stdio: "ignore" });
  let server;
  try {
    await mongoose.connect(`mongodb://127.0.0.1:${port}/finance_escalations_test`, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 30000 });
    assert.equal(mongoose.connection.name, "finance_escalations_test");
    const app = require("../src/app");
    const Booking = require("../src/models/Booking");
    const BookingRequest = require("../src/models/BookingRequest");
    const User = require("../src/models/User");
    const Agent = require("../src/models/Agent");

    const objectId = () => new mongoose.Types.ObjectId();
    const ids = { superAdmin: objectId(), admin: objectId(), staff: objectId(), tour: objectId(), agent: objectId() };
    const user = (_id, role) => ({ _id, firstName: role, lastName: "User", fullName: role, email: `${role}.${_id}@example.test`, password: "x".repeat(60), role, isActive: true, tokenVersion: 0 });
    await User.collection.insertMany([user(ids.superAdmin, "super_admin"), user(ids.admin, "admin"), user(ids.staff, "staff"), user(ids.tour, "tour_admin")]);
    await Agent.collection.insertOne({ _id: ids.agent, companyName: "A", contactFirstName: "A", contactLastName: "B", fullName: "A", email: "a@agents.test", password: "x".repeat(60), role: "agent", isActive: true });

    const booking = (n) => ({
      _id: objectId(), bookingReference: `ZNZ-17000000000${n}-200${n}`, bookingOrigin: "WEBSITE", bokunProductId: "P1", bokunOptionId: "O1",
      productTitle: "Spice Tour", optionTitle: "Morning", travelDate: `2026-12-1${n}`, paymentStatus: "paid", bookingStatus: "confirmed", supplierStatus: "confirmed",
      customer: { firstName: "Guest", lastName: `N${n}`, email: `guest${n}@example.test`, phone: "+255700000001" }, currency: "USD", transactionCurrency: "USD",
      invoiceSnapshot: { invoiceNumber: `INV-${n}`, total: 200, amountPaid: 200, amountRefunded: 0, balanceDue: 0, paymentStatus: "paid" },
      rawBokunResponse: { secret: "raw-supplier" }, estimatedCostSnapshot: { supplierNet: 120 }, createdByRole: "customer", sourceChannel: "direct_website",
      createdAt: new Date(), updatedAt: new Date()
    });
    const b = [1, 2, 3, 4].map(booking);
    await Booking.collection.insertMany(b);
    const at = (iso) => new Date(iso);
    const escalation = (text, iso, from = "UNDER_REVIEW") => ({ _id: objectId(), action: "escalated", text, fromState: from, toState: "AWAITING_FINANCE", escalatedTo: "FINANCE", category: "", actorId: String(ids.tour), actorRole: "tour_admin", at: at(iso) });
    const request = (n, overrides = {}) => ({
      _id: objectId(), requestReference: `REQ-${n}`, booking: b[n - 1]._id, type: "cancel_booking", status: "submitted", customerReason: `reason ${n}`,
      originalSnapshot: { date: b[n - 1].travelDate, totalAmount: 200, amountPaid: 200, currency: "USD" },
      refund: { required: true, status: "requested", estimatedAmount: 150, eligibleAmount: null, providerRefundReference: "PROVIDER-REF-SECRET", providerResolution: { raw: "provider-raw" } },
      priceAdjustment: { originalAmount: 200, newAmount: null, difference: null, type: "refund" },
      adminDecision: { internalNote: "staff-only note" },
      bokunSync: { status: "not_required", idempotencyKey: `idem-${n}`, requestPayload: { supplier: "payload" }, responseSnapshot: { supplier: "response" } },
      createdAt: at(`2026-10-0${n}T08:00:00Z`), updatedAt: new Date(),
      ...overrides
    });
    const r = {
      awaiting: request(1, { operations: { state: "AWAITING_FINANCE", category: "refund_inquiry", version: 2, notes: [{ _id: objectId(), action: "note_added", text: "Guest asked about refund timing", actorId: String(ids.tour), actorRole: "tour_admin", at: at("2026-10-05T09:00:00Z") }], history: [escalation("Refund decision needed", "2026-10-05T10:00:00Z")], updatedAt: at("2026-10-05T10:00:00Z") } }),
      movedOn: request(2, { type: "reschedule", operations: { state: "AWAITING_SUPPLIER", version: 3, history: [escalation("Check price difference", "2026-10-04T10:00:00Z"), { _id: objectId(), action: "escalated", text: "Supplier check", fromState: "AWAITING_FINANCE", toState: "AWAITING_SUPPLIER", escalatedTo: "SUPPLIER", actorId: String(ids.tour), actorRole: "tour_admin", at: at("2026-10-06T10:00:00Z") }], updatedAt: at("2026-10-06T10:00:00Z") } }),
      neverEscalated: request(3, { operations: { state: "UNDER_REVIEW", version: 1, history: [], updatedAt: at("2026-10-03T10:00:00Z") } }),
      noHistory: request(4, { refund: { required: false, status: "not_required" }, operations: { state: "AWAITING_FINANCE", version: 1 } })
    };
    await BookingRequest.collection.insertMany(Object.values(r));

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    let n = 0;
    const call = async (method, route, { bearer, headers = {}, body } = {}) => {
      n += 1;
      const response = await fetch(base + route, { method, headers: { "content-type": "application/json", "x-forwarded-for": `10.30.0.${n % 250}`, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) };
    };
    const userJwt = (id) => jwt.sign({ sub: String(id), userType: "user", tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: "10m" });
    const agentJwt = (id) => jwt.sign({ sub: String(id), userType: "agent", tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: "10m" });
    const staff = userJwt(ids.staff);
    const snapshot = async () => JSON.stringify({
      bookings: await Booking.collection.find({}).sort({ _id: 1 }).toArray(),
      requests: await BookingRequest.collection.find({}).sort({ _id: 1 }).toArray()
    });
    const before = await snapshot();

    await t.test("queue: currently escalated by default, ever escalated with scope=all", async () => {
      const awaiting = await call("GET", "/admin/finance/escalations", { bearer: staff });
      assert.equal(awaiting.status, 200);
      assert.match(awaiting.headers.get("cache-control"), /no-store/);
      assert.deepEqual(awaiting.body.data.items.map((item) => item.requestReference), ["REQ-1", "REQ-4"]);
      const first = awaiting.body.data.items[0];
      assert.deepEqual(first.escalation, { reason: "Refund decision needed", at: "2026-10-05T10:00:00.000Z", fromState: "UNDER_REVIEW", actorId: String(ids.tour), actorRole: "tour_admin" });
      assert.equal(first.category, "refund_inquiry");
      assert.equal(first.booking.bookingReference, b[0].bookingReference);
      assert.equal(first.booking.customer.email, "guest1@example.test");
      assert.equal(awaiting.body.data.items[1].escalation, null, "missing escalation data is not invented");
      const all = await call("GET", "/admin/finance/escalations?scope=all", { bearer: staff });
      assert.deepEqual(all.body.data.items.map((item) => item.requestReference).sort(), ["REQ-1", "REQ-2", "REQ-4"]);
      assert.equal(all.body.data.items.find((item) => item.requestReference === "REQ-2").state, "AWAITING_SUPPLIER");
      const serialized = JSON.stringify(all.body);
      for (const leak of ["REQ-3", "raw-supplier", "supplierNet", "PROVIDER-REF-SECRET", "provider-raw", "requestPayload", "responseSnapshot", "staff-only note"]) {
        assert.ok(!serialized.includes(leak), `leaked ${leak}`);
      }
    });

    await t.test("filters, pagination and validation", async () => {
      const page = await call("GET", "/admin/finance/escalations?scope=all&limit=2&page=2", { bearer: staff });
      assert.equal(page.body.data.items.length, 1);
      assert.equal(page.body.data.total, 3);
      assert.equal(page.body.data.hasMore, false);
      assert.deepEqual((await call("GET", "/admin/finance/escalations?scope=all&type=reschedule", { bearer: staff })).body.data.items.map((item) => item.requestReference), ["REQ-2"]);
      assert.deepEqual((await call("GET", "/admin/finance/escalations?category=refund_inquiry", { bearer: staff })).body.data.items.map((item) => item.requestReference), ["REQ-1"]);
      assert.deepEqual((await call("GET", `/admin/finance/escalations?scope=all&bookingReference=${b[1].bookingReference.toLowerCase()}`, { bearer: staff })).body.data.items.map((item) => item.requestReference), ["REQ-2"]);
      assert.equal((await call("GET", "/admin/finance/escalations?bookingReference=ZNZ-NOPE-1", { bearer: staff })).body.data.total, 0);
      assert.deepEqual((await call("GET", "/admin/finance/escalations?requestReference=REQ-4", { bearer: staff })).body.data.items.map((item) => item.requestReference), ["REQ-4"]);
      for (const bad of ["limit=500", "scope=everything", "unknown=1", "state[$ne]=x", "bookingReference=%24ne"]) {
        assert.equal((await call("GET", `/admin/finance/escalations?${bad}`, { bearer: staff })).status, 422, bad);
      }
    });

    await t.test("detail: request, Tour notes, history, supplier status and recorded Finance evidence only", async () => {
      const detail = await call("GET", `/admin/finance/escalations/${r.awaiting._id}`, { bearer: staff });
      assert.equal(detail.status, 200);
      const data = detail.body.data;
      assert.equal(data.request.customerReason, "reason 1");
      assert.equal(data.operations.notes[0].text, "Guest asked about refund timing");
      assert.equal(data.operations.history.length, 1);
      assert.equal(data.operations.allowedTransitions, undefined, "Finance is not offered workflow moves");
      assert.equal(data.escalations[0].escalatedTo, "FINANCE");
      assert.equal(data.supplier.syncStatus, "not_required");
      assert.deepEqual(data.financeEvidence.refund, { required: true, status: "requested", estimatedAmount: 150, eligibleAmount: null, approvedAmount: null, requestedAmount: null, confirmedRefundedAmount: null, cancellationFee: null, providerLabel: "" });
      assert.deepEqual(data.financeEvidence.priceAdjustment, { type: "refund", originalAmount: 200, newAmount: null, difference: null });
      assert.deepEqual(data.financeEvidence.invoice, { invoiceNumber: "INV-1", paymentStatus: "paid", total: 200, amountPaid: 200, amountRefunded: 0, balanceDue: 0 });
      assert.equal(data.financeEvidence.currency, "USD");
      assert.match(data.notice, /Review only/);
      const serialized = JSON.stringify(detail.body);
      for (const leak of ["raw-supplier", "supplierNet", "PROVIDER-REF-SECRET", "provider-raw", "requestPayload", "responseSnapshot", "staff-only note", "idempotencyKey"]) {
        assert.ok(!serialized.includes(leak), `leaked ${leak}`);
      }
      assert.equal((await call("GET", `/admin/finance/escalations/${r.movedOn._id}`, { bearer: staff })).status, 200, "previously escalated stays reviewable");
      assert.equal((await call("GET", `/admin/finance/escalations/${r.noHistory._id}`, { bearer: staff })).body.data.escalation, null);
      assert.equal((await call("GET", `/admin/finance/escalations/${r.neverEscalated._id}`, { bearer: staff })).status, 404, "never-escalated requests are not part of the queue");
      assert.equal((await call("GET", "/admin/finance/escalations/not-an-id", { bearer: staff })).status, 422);
    });

    await t.test("authorization: Finance roles read; Tour Admin, agents, customers and anonymous are refused", async () => {
      const id = String(r.awaiting._id);
      for (const route of ["/admin/finance/escalations", `/admin/finance/escalations/${id}`]) {
        assert.equal((await call("GET", route)).status, 401, `anonymous ${route}`);
        const customerToken = issueBookingAccessToken(b[0]).token;
        assert.equal((await call("GET", route, { headers: { "X-Booking-Access-Token": customerToken } })).status, 401, "customer access token is not a session");
        assert.equal((await call("GET", route, { bearer: userJwt(ids.tour) })).status, 403, "tour_admin");
        assert.equal((await call("GET", route, { bearer: agentJwt(ids.agent) })).status, 403, "agent");
        for (const id2 of [ids.staff, ids.admin, ids.superAdmin]) assert.equal((await call("GET", route, { bearer: userJwt(id2) })).status, 200);
      }
    });

    await t.test("no write capability: queue has no write routes and Finance gains no Tour workflow writes", async () => {
      const id = String(r.awaiting._id);
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        for (const route of ["/admin/finance/escalations", `/admin/finance/escalations/${id}`, `/admin/finance/escalations/${id}/resolve`]) {
          const response = await call(method, route, { bearer: userJwt(ids.superAdmin), body: {} });
          assert.ok(response.status >= 400, `${method} ${route} -> ${response.status}`);
        }
      }
      assert.equal((await call("POST", `/tour-operations/requests/${id}/transition`, { bearer: staff, body: { toState: "RESOLVED", expectedVersion: 2 } })).status, 403);
      assert.equal((await call("POST", `/tour-operations/requests/${id}/notes`, { bearer: staff, body: { text: "x" } })).status, 403);
      assert.equal(await snapshot(), before, "reads changed nothing");
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    if (child.exitCode === null) { child.kill(); await once(child, "exit"); }
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("finance-escalations-test-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
