// Phase 3A: booking origin, the tour_admin role, the Tour Operations booking list and internal handling
// of customer booking requests. HTTP tests launch their own throwaway mongod; any outbound request to a
// non-local host fails the test (no Bókun, payment or email provider can be reached).
process.env.NODE_ENV = "test";
process.env.MONGO_URI = "mongodb://127.0.0.1:1/unused-tour-operations";
process.env.JWT_SECRET = "tour-operations-fixture-secret";
process.env.BOKUN_MOCK_MODE = "true";
process.env.EMAIL_ENABLED = "false";
process.env.TRUST_PROXY = "1";

const outbound = [];
{
  const http = require("node:http");
  const https = require("node:https");
  const isLocal = (host = "") => /^(localhost|127\.0\.0\.1|::1|\[::1\])$/i.test(String(host).split(":")[0]);
  const hostOf = ([first, second]) => {
    if (typeof first === "string" || first instanceof URL) return new URL(String(first)).hostname;
    return (first && (first.hostname || first.host)) || (second && (second.hostname || second.host)) || "";
  };
  for (const mod of [http, https]) {
    for (const name of ["request", "get"]) {
      const original = mod[name];
      mod[name] = function guarded(...args) {
        const host = hostOf(args);
        if (!isLocal(host)) {
          outbound.push(host);
          throw new Error(`Outbound request to ${host} blocked in test`);
        }
        return original.apply(this, args);
      };
    }
  }
}

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

const { originForSourceContext, resolveBookingOrigin, originFilter, KNOWN_ORIGINS } = require("../src/services/bookings/origin");
const { findDuplicateCandidates } = require("../src/services/bookingIdentity/duplicateCandidates");
const { getPermissionsForRole, PERMISSIONS } = require("../src/security/permissions");
const tourOperations = require("../src/services/tourOperations");

const ZNZ = (n) => `ZNZ-17${String(n).padStart(11, "0")}-${String(1000 + n).slice(-4)}`;
const TOUR_PERMISSIONS = ["tour_operations.read", "tour_requests.read", "tour_requests.process"];

test("checkout source contexts map to WEBSITE or AGENT_PORTAL", () => {
  assert.equal(originForSourceContext({ sourceChannel: "direct_website" }), "WEBSITE");
  assert.equal(originForSourceContext({ sourceChannel: "agent_referral" }), "WEBSITE", "referral links are website checkouts");
  assert.equal(originForSourceContext({ sourceChannel: "admin_dashboard" }), "WEBSITE", "staff using the website checkout");
  assert.equal(originForSourceContext({ sourceChannel: "agent_portal" }), "AGENT_PORTAL");
});

test("recorded origin wins; historical origin needs unambiguous creation evidence", () => {
  const cases = [
    [{ bookingOrigin: "AGENT_PORTAL", createdByRole: "bokun_import" }, "AGENT_PORTAL", "recorded"],
    [{ createdByRole: "bokun_import", bookingReference: "BOKUN-1" }, "BOKUN_IMPORT", "historical"],
    [{ createdByRole: "agent", sourceChannel: "agent_portal", agentId: "a1", bookingReference: ZNZ(1) }, "AGENT_PORTAL", "historical"],
    [{ createdByRole: "customer", sourceChannel: "direct_website", bookingReference: ZNZ(2) }, "WEBSITE", "historical"],
    [{ createdByRole: "customer", sourceChannel: "agent_referral", agentId: "a1", bookingReference: ZNZ(3) }, "WEBSITE", "historical"],
    [{ createdByRole: "payment_recovery", sourceChannel: "direct_website", bookingReference: ZNZ(4) }, "WEBSITE", "historical"],
    // A website booking stays WEBSITE even with Bókun evidence: operationalSource is not origin.
    [{ createdByRole: "customer", sourceChannel: "direct_website", bookingReference: ZNZ(5), operationalSource: "BOKUN", bokunBookingId: "B5", salesChannel: "VIATOR" }, "WEBSITE", "historical"],
    // Ambiguous: schema defaults on an early import, staff-created, missing evidence, agent without owner.
    [{ createdByRole: "customer", sourceChannel: "direct_website", bookingReference: "VIA-778812", operationalSource: "BOKUN" }, "UNKNOWN", "unresolved"],
    [{ createdByRole: "admin", sourceChannel: "admin_dashboard", bookingReference: ZNZ(6) }, "UNKNOWN", "unresolved"],
    [{ bookingReference: ZNZ(7) }, "UNKNOWN", "unresolved"],
    [{ createdByRole: "agent", sourceChannel: "agent_portal", bookingReference: ZNZ(8) }, "UNKNOWN", "unresolved"],
    [{ bookingOrigin: "SOMETHING_ELSE", createdByRole: "customer", sourceChannel: "direct_website", bookingReference: ZNZ(9) }, "WEBSITE", "historical"]
  ];
  for (const [booking, origin, basis] of cases) {
    assert.deepEqual(resolveBookingOrigin(booking), { origin, basis }, JSON.stringify(booking));
  }
});

test("tour_admin holds exactly the three tour permissions; other roles keep their permissions", () => {
  assert.deepEqual(getPermissionsForRole("tour_admin").sort(), [...TOUR_PERMISSIONS].sort());
  for (const permission of TOUR_PERMISSIONS) {
    assert.ok(!getPermissionsForRole("staff").includes(permission), `staff must not gain ${permission}`);
    assert.ok(!getPermissionsForRole("agent").includes(permission));
    assert.ok(getPermissionsForRole("super_admin").includes(permission));
    assert.ok(getPermissionsForRole("admin").includes(permission));
  }
  assert.equal(getPermissionsForRole("staff").length, 22, "staff permission set unchanged");
  assert.deepEqual(getPermissionsForRole("agent").sort(), [PERMISSIONS.AGENT_PORTAL_READ, PERMISSIONS.AGENT_PORTAL_WRITE].sort());
});

test("duplicate detector reports identity conflicts and orphaned imports without touching data", () => {
  const website = { _id: "w1", bookingReference: ZNZ(11), bookingOrigin: "WEBSITE", bokunProductId: "P1", travelDate: "2026-12-01", paymentStatus: "paid", bookingStatus: "pending", customer: { email: "Guest@Example.test", firstName: "Amina", lastName: "Said", phone: "+255 700 000 111" } };
  const orphan = { _id: "i1", bookingReference: "BOKUN-REF-9", createdByRole: "bokun_import", bokunProductId: "P1", travelDate: "2026-12-01", bokunBookingId: "B9", customer: { email: "guest@example.test" } };
  const linked = { _id: "i2", bookingReference: "BOKUN-REF-10", createdByRole: "bokun_import", bokunExternalBookingReference: ZNZ(11), bokunProductId: "P1", travelDate: "2026-12-01", customer: { email: "guest@example.test" } };
  const namePhone = { _id: "i3", bookingReference: "BOKUN-REF-11", bookingOrigin: "BOKUN_IMPORT", bokunProductId: "P1", travelDate: "2026-12-01", customer: { firstName: "AMINA", lastName: "said", phone: "255700000111" } };
  const otherDate = { _id: "i4", bookingReference: "BOKUN-REF-12", bookingOrigin: "BOKUN_IMPORT", bokunProductId: "P1", travelDate: "2026-12-02", customer: { email: "guest@example.test" } };
  const conflict = { _id: "w2", bookingReference: ZNZ(12), bookingOrigin: "WEBSITE", bokunBookingId: "B9", bokunProductId: "P2", travelDate: "2026-12-03" };
  const input = [website, orphan, linked, namePhone, otherDate, conflict];
  const before = JSON.stringify(input);
  const results = findDuplicateCandidates(input);
  assert.equal(JSON.stringify(input), before, "input untouched");
  const pairs = results.map((row) => `${row.kind}:${row.records.map((record) => record.id).sort().join("+")}:${row.confidence}`).sort();
  assert.deepEqual(pairs, [
    "IDENTITY_CONFLICT:i1+w2:high",
    "ORPHANED_IMPORT:i1+w1:probable",
    "ORPHANED_IMPORT:i3+w1:possible"
  ]);
  assert.ok(!JSON.stringify(results).includes("@example.test"), "report carries no customer details");
});

const binary = process.env.MONGOD_BINARY || (process.platform === "win32" ? "C:/Program Files/MongoDB/Server/8.2/bin/mongod.exe" : "/usr/bin/mongod");

test("isolated Mongo: Tour Operations over HTTP", { skip: !fs.existsSync(binary), timeout: 300000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tour-operations-test-"));
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(binary, ["--bind_ip", "127.0.0.1", "--port", String(port), "--dbpath", directory, "--quiet"], { windowsHide: true, stdio: "ignore" });
  let server;
  try {
    await mongoose.connect(`mongodb://127.0.0.1:${port}/tour_operations_test`, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 30000 });
    assert.equal(mongoose.connection.name, "tour_operations_test");

    const app = require("../src/app");
    const Booking = require("../src/models/Booking");
    const BookingRequest = require("../src/models/BookingRequest");
    const Invoice = require("../src/models/Invoice");
    const Payment = require("../src/models/Payment");
    const Refund = require("../src/models/Refund");
    const AuditLog = require("../src/models/AuditLog");
    const User = require("../src/models/User");
    const Agent = require("../src/models/Agent");
    const { createBokunConfirmedBookingImportService } = require("../src/services/bokunConfirmedBookings");
    const { mapBokunBookingForImport } = require("../src/integrations/bokun/confirmedBooking.mapper");
    const bokunService = require("../src/services/bokun");
    const refundsService = require("../src/services/refunds");
    const emailService = require("../src/services/email");

    const objectId = () => new mongoose.Types.ObjectId();
    const ids = { superAdmin: objectId(), admin: objectId(), staff: objectId(), tourAdmin: objectId(), tourAdmin2: objectId(), agentA: objectId(), agentB: objectId() };
    const user = (_id, role) => ({ _id, firstName: role, lastName: "User", fullName: `${role} User`, email: `${role}.${_id}@example.test`, password: "x".repeat(60), role, isActive: true, tokenVersion: 0 });
    await User.collection.insertMany([user(ids.superAdmin, "super_admin"), user(ids.admin, "admin"), user(ids.staff, "staff"), user(ids.tourAdmin, "tour_admin"), user(ids.tourAdmin2, "tour_admin")]);
    await Agent.collection.insertMany([ids.agentA, ids.agentB].map((_id, index) => ({ _id, companyName: `Agent ${index}`, contactFirstName: "A", contactLastName: "B", fullName: `Agent ${index}`, email: `agent${index}@agents.test`, password: "x".repeat(60), role: "agent", isActive: true })));

    const booking = (n, overrides = {}) => ({
      _id: objectId(), bookingReference: ZNZ(n), bokunProductId: "PROD-1", bokunOptionId: "OPT-1", productTitle: "Stone Town Tour",
      optionTitle: "Morning", travelDate: `2026-12-${String(n).padStart(2, "0")}`, startTime: "09:30", paxSummary: { adults: 2, children: 0, infants: 0, total: 2 },
      customer: { firstName: "Guest", lastName: `N${n}`, email: `guest${n}@example.test`, phone: "+255700000001", country: "TZ", hotelName: "Hotel" },
      bookingStatus: "pending", paymentStatus: "pending", supplierStatus: "awaiting_payment", amount: 150, currency: "USD",
      pricingSnapshot: { currency: "USD", finalPayable: 150, grossAmount: 150 }, estimatedCostSnapshot: { supplierNet: 90 },
      rawBokunResponse: { secret: "raw" }, paymentTransactionId: `txn-${n}`, invoiceSnapshot: { invoiceNumber: `INV-${n}`, total: 150 },
      pendingCheckout: { checkoutPayload: { quoteToken: "secret-quote" }, finalization: { status: "idle" } },
      createdByRole: "customer", sourceChannel: "direct_website", salesChannel: "DIRECT_WEBSITE", operationalSource: "LOCAL",
      createdAt: new Date(Date.UTC(2026, 9, n)), updatedAt: new Date(Date.UTC(2026, 9, n)),
      ...overrides
    });
    const b = {
      websitePending: booking(1, { bookingOrigin: "WEBSITE" }),
      websitePaidSupplierPending: booking(2, { bookingOrigin: "WEBSITE", paymentStatus: "paid", supplierStatus: "supplier_pending", pendingCheckout: { finalizationPending: true, finalization: { status: "pending_retry" } } }),
      websiteConfirmed: booking(3, { bookingOrigin: "WEBSITE", paymentStatus: "paid", bookingStatus: "confirmed", supplierStatus: "confirmed", operationalSource: "BOKUN", bokunBookingId: "B-3", bokunConfirmationCode: "RTS-3", bokunStatus: { normalized: "confirmed" }, salesChannel: "DIRECT_WEBSITE" }),
      websiteFailed: booking(4, { bookingOrigin: "WEBSITE", paymentStatus: "failed", bookingStatus: "failed" }),
      websiteCancelled: booking(5, { bookingOrigin: "WEBSITE", paymentStatus: "paid", bookingStatus: "cancelled", cancellation: { cancelledAt: new Date() } }),
      agentA: booking(6, { bookingOrigin: "AGENT_PORTAL", createdByRole: "agent", sourceChannel: "agent_portal", agentId: ids.agentA, salesChannel: "AGENT" }),
      agentB: booking(7, { bookingOrigin: "AGENT_PORTAL", createdByRole: "agent", sourceChannel: "agent_portal", agentId: ids.agentB, salesChannel: "AGENT" }),
      historicalWebsite: booking(8, { operationalSource: "BOKUN", bokunBookingId: "B-8", paymentStatus: "paid", bookingStatus: "confirmed" }),
      historicalAgent: booking(9, { createdByRole: "agent", sourceChannel: "agent_portal", agentId: ids.agentA }),
      importedOta: booking(10, { bookingReference: "VTR-555", bookingOrigin: "BOKUN_IMPORT", createdByRole: "bokun_import", sourceChannel: "viator", salesChannel: "VIATOR", operationalSource: "BOKUN", bokunBookingId: "B-10" }),
      historicalImport: booking(11, { bookingReference: "GYG-777", createdByRole: "bokun_import", sourceChannel: "getyourguide", operationalSource: "BOKUN" }),
      ambiguousImportDefaults: booking(12, { bookingReference: "BOKUN-999", operationalSource: "BOKUN", bokunBookingId: "B-12" }),
      ambiguousStaff: booking(13, { createdByRole: "admin", sourceChannel: "admin_dashboard" })
    };
    await Booking.collection.insertMany(Object.values(b));
    const operationalKeys = ["websitePending", "websitePaidSupplierPending", "websiteConfirmed", "websiteFailed", "websiteCancelled", "agentA", "agentB", "historicalWebsite", "historicalAgent"];

    const request = (key, type, overrides = {}) => ({
      _id: objectId(), requestReference: `REQ-${key}`, booking: b[key]._id, type, status: "submitted",
      customerReason: "Customer reason", customerNotes: "", originalSnapshot: { date: b[key].travelDate, startTime: "09:30", totalAmount: 150, amountPaid: 150, currency: "USD" },
      requestedChanges: type === "reschedule" ? { date: "2026-12-20", startTime: "09:30" } : {},
      priceAdjustment: { originalAmount: 150, newAmount: 170, difference: 20, type: "additional_payment" },
      refund: { required: type === "cancel_booking", estimatedAmount: 120, eligibleAmount: 120, providerRefundReference: "PROVIDER-SECRET", status: type === "cancel_booking" ? "requested" : "not_required" },
      additionalPayment: { required: false, status: "not_required" },
      adminDecision: { decision: "", customerFacingReason: "", internalNote: "staff-only finance note" },
      bokunSync: { status: "not_required", idempotencyKey: `idem-${key}-${type}`, requestPayload: { secret: true } },
      createdAt: new Date(), updatedAt: new Date(),
      ...overrides
    });
    const r = {
      reschedule: request("websiteConfirmed", "reschedule"),
      cancellation: request("agentA", "cancel_booking"),
      travelers: request("websitePaidSupplierPending", "change_travelers"),
      agentBCancel: request("agentB", "cancel_booking"),
      importedCancel: request("importedOta", "cancel_booking"),
      concurrency: request("historicalWebsite", "reschedule")
    };
    await BookingRequest.collection.insertMany(Object.values(r));
    await Invoice.collection.insertMany(Object.values(b).map((row) => ({ _id: objectId(), invoiceNumber: row.invoiceSnapshot.invoiceNumber, bookingReference: row.bookingReference, total: 150, amountPaid: 150, accountingPostingKey: `post-${row.bookingReference}` })));
    await Payment.collection.insertMany(Object.values(b).map((row) => ({ _id: objectId(), bookingReference: row.bookingReference, provider: "pesapal", status: "paid", amount: 150, currency: "USD" })));
    await Refund.collection.insertOne({ _id: objectId(), bookingId: b.agentA._id, bookingReference: b.agentA.bookingReference, status: "requested", amount: 120 });

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    let client = 0;
    const call = async (method, route, { bearer, body } = {}) => {
      client += 1;
      const response = await fetch(base + route, {
        method,
        headers: { "content-type": "application/json", "x-forwarded-for": `10.20.${Math.floor(client / 250)}.${client % 250}`, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
        body: body ? JSON.stringify(body) : method === "GET" ? undefined : "{}"
      });
      let json = null;
      try { json = await response.json(); } catch { json = null; }
      return { status: response.status, headers: response.headers, body: json };
    };
    const userJwt = (id) => jwt.sign({ sub: String(id), userType: "user", tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: "10m" });
    const agentJwt = (id) => jwt.sign({ sub: String(id), userType: "agent", tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: "10m" });
    const tour = userJwt(ids.tourAdmin);
    const tour2 = userJwt(ids.tourAdmin2);

    // Supplier, refund and email side effects must never run from Tour Operations.
    const forbiddenCalls = [];
    for (const [module, names] of [[bokunService, ["createBooking", "cancelBooking", "editBooking", "lookupBooking"]], [refundsService, ["processRefund", "createRefundForRequest"]], [emailService, ["sendBookingEmailOnce", "sendBookingRequestEmailOnce"]]]) {
      for (const name of names) {
        if (typeof module[name] === "function") t.mock.method(module, name, async () => { forbiddenCalls.push(name); throw new Error(`${name} must not run`); });
      }
    }

    // Every field of every booking, invoice, payment and refund, and every request field except the
    // Tour Operations sub-document, keyed so a failure names the exact field that changed.
    const snapshot = async () => {
      const flat = {};
      const collect = (name, rows, skip = []) => {
        for (const row of rows) {
          for (const [field, value] of Object.entries(row)) {
            if (!skip.includes(field)) flat[`${name}:${row._id}:${field}`] = JSON.stringify(value);
          }
        }
      };
      collect("booking", await Booking.collection.find({}).toArray());
      collect("invoice", await Invoice.collection.find({}).toArray());
      collect("payment", await Payment.collection.find({}).toArray());
      collect("refund", await Refund.collection.find({}).toArray());
      collect("request", await BookingRequest.collection.find({}).toArray(), ["operations"]);
      return flat;
    };
    const changedFields = (left, right) =>
      [...new Set([...Object.keys(left), ...Object.keys(right)])].filter((key) => left[key] !== right[key]);
    const before = await snapshot();

    await t.test("origin filter selects exactly what the read-time classifier assigns", async () => {
      const all = await Booking.collection.find({}).toArray();
      for (const origin of KNOWN_ORIGINS) {
        const queried = (await Booking.collection.find(originFilter([origin]), { projection: { _id: 1 } }).toArray()).map((row) => String(row._id)).sort();
        const classified = all.filter((row) => resolveBookingOrigin(row).origin === origin).map((row) => String(row._id)).sort();
        assert.deepEqual(queried, classified, origin);
      }
      assert.equal(resolveBookingOrigin(b.ambiguousImportDefaults).origin, "UNKNOWN");
      assert.equal(resolveBookingOrigin(b.ambiguousStaff).origin, "UNKNOWN");
    });

    await t.test("Tour Admin booking list: website and Agent Portal bookings in every state, strict allowlist", async () => {
      const response = await call("GET", "/tour-operations/bookings?limit=100", { bearer: tour });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("cache-control"), /no-store/);
      const references = response.body.data.items.map((item) => item.bookingReference).sort();
      assert.deepEqual(references, operationalKeys.map((key) => b[key].bookingReference).sort());
      assert.equal(response.body.data.total, operationalKeys.length);
      const states = new Set(response.body.data.items.map((item) => `${item.status.payment}/${item.status.booking}/${item.status.supplier}`));
      assert.ok(states.size >= 5);
      const item = response.body.data.items.find((row) => row.bookingReference === b.websiteConfirmed.bookingReference);
      assert.deepEqual(Object.keys(item).sort(), ["agentId", "bookingReference", "createdAt", "customer", "id", "origin", "originBasis", "status", "supplierSync", "tour", "updatedAt"]);
      assert.equal(item.origin, "WEBSITE");
      assert.equal(item.supplierSync.linkedToBokun, true);
      const serialized = JSON.stringify(response.body);
      for (const leak of ["amount", "pricing", "finalPayable", "supplierNet", "estimatedCost", "rawBokunResponse", "secret", "paymentTransactionId", "txn-", "invoice", "INV-", "commission", "checkoutPayload", "quoteToken", "salesChannel"]) {
        assert.ok(!serialized.includes(leak), `leaked ${leak}`);
      }
      const historical = response.body.data.items.find((row) => row.bookingReference === b.historicalWebsite.bookingReference);
      assert.deepEqual([historical.origin, historical.originBasis], ["WEBSITE", "historical"]);
      assert.equal(response.body.data.items.find((row) => row.bookingReference === b.agentA.bookingReference).agentId, String(ids.agentA));
    });

    await t.test("pagination and filters", async () => {
      const page1 = await call("GET", "/tour-operations/bookings?limit=4&page=1", { bearer: tour });
      const page3 = await call("GET", "/tour-operations/bookings?limit=4&page=3", { bearer: tour });
      assert.equal(page1.body.data.items.length, 4);
      assert.equal(page1.body.data.hasMore, true);
      assert.equal(page3.body.data.items.length, 1);
      assert.equal(page3.body.data.hasMore, false);
      const agents = await call("GET", "/tour-operations/bookings?origin=AGENT_PORTAL", { bearer: tour });
      assert.deepEqual(agents.body.data.items.map((item) => item.origin), ["AGENT_PORTAL", "AGENT_PORTAL", "AGENT_PORTAL"]);
      const failed = await call("GET", "/tour-operations/bookings?bookingStatus=failed", { bearer: tour });
      assert.deepEqual(failed.body.data.items.map((item) => item.bookingReference), [b.websiteFailed.bookingReference]);
      const byReference = await call("GET", `/tour-operations/bookings?search=${b.websitePending.bookingReference.toLowerCase()}`, { bearer: tour });
      assert.equal(byReference.body.data.total, 1);
      const byEmail = await call("GET", `/tour-operations/bookings?search=${encodeURIComponent("GUEST6@example.test")}`, { bearer: tour });
      assert.equal(byEmail.body.data.items[0].bookingReference, b.agentA.bookingReference);
      assert.equal((await call("GET", "/tour-operations/bookings?search=VTR-555", { bearer: tour })).body.data.total, 0, "imports never appear");
      assert.equal((await call("GET", "/tour-operations/bookings?search=.*.*", { bearer: tour })).body.data.total, 0, "no regex injection");
      for (const bad of ["limit=500", "page=0", "origin=BOKUN_IMPORT", "unknown=1", "travelDateFrom=12-01-2026", "bookingStatus[$ne]=x"]) {
        assert.equal((await call("GET", `/tour-operations/bookings?${bad}`, { bearer: tour })).status, 422, bad);
      }
      const dated = await call("GET", "/tour-operations/bookings?travelDateFrom=2026-12-06&travelDateTo=2026-12-07", { bearer: tour });
      assert.deepEqual(dated.body.data.items.map((item) => item.bookingReference).sort(), [b.agentA.bookingReference, b.agentB.bookingReference].sort());
    });

    await t.test("access by role on Tour Operations endpoints", async () => {
      const id = String(r.reschedule._id);
      const endpoints = [
        ["GET", "/tour-operations/bookings"],
        ["GET", "/tour-operations/requests"],
        ["GET", `/tour-operations/requests/${id}`],
        ["POST", `/tour-operations/requests/${id}/notes`, { text: "role probe" }]
      ];
      for (const [method, route, body] of endpoints) {
        assert.equal((await call(method, route, { body })).status, 401, `anonymous ${route}`);
        for (const bearer of [agentJwt(ids.agentA), agentJwt(ids.agentB), userJwt(ids.staff)]) {
          assert.equal((await call(method, route, { bearer, body })).status, 403, route);
        }
      }
      for (const bearer of [userJwt(ids.admin), userJwt(ids.superAdmin)]) {
        assert.equal((await call("GET", "/tour-operations/bookings", { bearer })).status, 200);
        assert.equal((await call("GET", `/tour-operations/requests/${id}`, { bearer })).status, 200);
      }
    });

    await t.test("Tour Admin is refused finance, payment, refund, settlement, supplier and commission actions", async () => {
      const someId = String(objectId());
      const denied = [
        ["GET", "/admin/booking-accounting/dashboard"], ["GET", "/admin/booking-accounting/invoices"], ["GET", "/admin/booking-accounting/expenses"],
        ["GET", "/payments/reconciliation"], ["GET", "/payments"], ["POST", `/payments/reconciliation/${b.websitePending.bookingReference}/recheck`],
        ["GET", "/admin/settlements"], ["GET", "/admin/business-accounting/postings"], ["GET", "/admin/accounting/chart-of-accounts"],
        ["GET", "/admin/analytics/sales"], ["GET", "/admin/report-center/summary"], ["GET", "/admin/service-completions"],
        ["GET", "/admin/booking-requests"], ["POST", `/admin/booking-requests/${r.cancellation._id}/approve`], ["POST", `/admin/booking-requests/${r.cancellation._id}/reject`],
        ["POST", `/admin/booking-requests/${r.reschedule._id}/retry-bokun-sync`], ["POST", `/admin/refunds/${someId}/process`], ["POST", `/admin/refunds/${someId}/verify`],
        ["POST", `/admin/payment-adjustments/${someId}/mark-paid`], ["POST", "/bokun/bookings"], ["POST", `/bokun/bookings/${someId}/cancel`],
        ["POST", `/bookings/${b.websiteConfirmed._id}/cancel`], ["POST", `/bookings/${b.websiteConfirmed._id}/edit-request`], ["POST", `/bookings/${b.websitePaidSupplierPending._id}/finalization/retry`],
        ["GET", "/bookings/recent"], ["GET", `/invoices/${b.websiteConfirmed.invoiceSnapshot.invoiceNumber}`], ["GET", "/commissions/summary"],
        ["POST", `/agents/${ids.agentA}/update-commission`], ["GET", "/customers"], ["GET", "/reports/dashboard-summary"]
      ];
      for (const [method, route] of denied) {
        const response = await call(method, route, { bearer: tour });
        assert.ok([401, 403].includes(response.status), `${method} ${route} -> ${response.status}`);
      }
      // Customer booking and invoice lookups still need customer proof: a tour_admin session is not back office.
      assert.equal((await call("GET", `/bookings/${b.websiteConfirmed.bookingReference}`, { bearer: tour })).status, 404);
      assert.equal((await call("GET", `/invoices/booking/${b.websiteConfirmed.bookingReference}`, { bearer: tour })).status, 404);
    });

    await t.test("existing Admin, Staff and Agent access is preserved", async () => {
      assert.equal((await call("GET", "/admin/booking-requests", { bearer: userJwt(ids.staff) })).status, 200);
      assert.equal((await call("GET", "/admin/booking-accounting/dashboard", { bearer: userJwt(ids.staff) })).status, 200);
      assert.equal((await call("GET", "/bookings/recent", { bearer: userJwt(ids.admin) })).status, 200);
      assert.equal((await call("GET", `/invoices/${b.agentA.invoiceSnapshot.invoiceNumber}`, { bearer: agentJwt(ids.agentA) })).status, 200);
      assert.equal((await call("GET", `/invoices/${b.agentB.invoiceSnapshot.invoiceNumber}`, { bearer: agentJwt(ids.agentA) })).status, 404, "cross-agent");
      assert.equal((await call("GET", `/agent/bookings/${b.agentB.bookingReference}`, { bearer: agentJwt(ids.agentA) })).status, 404, "cross-agent");
    });

    await t.test("request list: operational bookings only, status-only finance signals", async () => {
      const response = await call("GET", "/tour-operations/requests?limit=100", { bearer: tour });
      assert.equal(response.status, 200);
      const references = response.body.data.items.map((item) => item.requestReference).sort();
      assert.deepEqual(references, ["REQ-agentA", "REQ-agentB", "REQ-historicalWebsite", "REQ-websiteConfirmed", "REQ-websitePaidSupplierPending"]);
      const serialized = JSON.stringify(response.body);
      for (const leak of ["PROVIDER-SECRET", "estimatedAmount", "eligibleAmount", "totalAmount", "amountPaid", "priceAdjustment", "staff-only finance note", "requestPayload", "idempotencyKey", "internalNote"]) {
        assert.ok(!serialized.includes(leak), `leaked ${leak}`);
      }
      const cancellation = response.body.data.items.find((item) => item.requestReference === "REQ-agentA");
      assert.deepEqual(cancellation.finance, { refundRequired: true, refundStatus: "requested", additionalPaymentRequired: false, additionalPaymentStatus: "not_required" });
      assert.equal(cancellation.operations.state, "RECEIVED");
      assert.equal(cancellation.operations.category, "cancellation");
      const filtered = await call("GET", "/tour-operations/requests?category=date_change", { bearer: tour });
      assert.deepEqual(filtered.body.data.items.map((item) => item.requestReference).sort(), ["REQ-historicalWebsite", "REQ-websiteConfirmed"]);
      assert.equal((await call("GET", `/tour-operations/requests/${r.importedCancel._id}`, { bearer: tour })).status, 404, "import-only booking requests stay in the Back Office");
      const forBooking = await call("GET", `/tour-operations/requests?bookingReference=${b.agentA.bookingReference.toLowerCase()}`, { bearer: tour });
      assert.deepEqual(forBooking.body.data.items.map((item) => item.requestReference), ["REQ-agentA"]);
      assert.equal((await call("GET", `/tour-operations/requests?bookingReference=${b.importedOta.bookingReference}`, { bearer: tour })).body.data.total, 0, "no import-only requests by reference either");
      assert.equal((await call("GET", "/tour-operations/requests?bookingReference=%24ne", { bearer: tour })).status, 422);
      assert.deepEqual(cancellation.operations.allowedTransitions.map((option) => option.toState), ["UNDER_REVIEW", "AWAITING_SUPPLIER", "AWAITING_FINANCE", "REJECTED"]);
      assert.deepEqual(cancellation.operations.allowedTransitions.find((option) => option.toState === "AWAITING_FINANCE"), { toState: "AWAITING_FINANCE", reasonRequired: true, escalatesTo: "FINANCE" });
    });

    let version = 0;
    await t.test("notes, classification and the internal workflow, with an audit trail", async () => {
      const id = String(r.reschedule._id);
      const note = await call("POST", `/tour-operations/requests/${id}/notes`, { bearer: tour, body: { text: "Called the guest; prefers 20 Dec." } });
      assert.equal(note.status, 200);
      assert.equal(note.body.data.operations.notes.length, 1);
      assert.equal(note.body.data.operations.notes[0].actorId, String(ids.tourAdmin));
      assert.equal(note.body.data.operations.version, 0, "notes do not change the version");
      const review = await call("POST", `/tour-operations/requests/${id}/transition`, { bearer: tour, body: { toState: "UNDER_REVIEW", expectedVersion: 0 } });
      assert.equal(review.status, 200);
      assert.equal(review.body.data.operations.state, "UNDER_REVIEW");
      version = review.body.data.operations.version;
      const noReason = await call("POST", `/tour-operations/requests/${id}/transition`, { bearer: tour, body: { toState: "AWAITING_SUPPLIER", expectedVersion: version } });
      assert.equal(noReason.body.error.code, "TOUR_REQUEST_REASON_REQUIRED");
      const escalated = await call("POST", `/tour-operations/requests/${id}/transition`, { bearer: tour2, body: { toState: "AWAITING_SUPPLIER", expectedVersion: version, reason: "Supplier must confirm 20 Dec availability" } });
      assert.equal(escalated.status, 200);
      version = escalated.body.data.operations.version;
      const resolved = await call("POST", `/tour-operations/requests/${id}/transition`, { bearer: tour, body: { toState: "RESOLVED", expectedVersion: version } });
      assert.equal(resolved.status, 200);
      // RESOLVED is internal: the customer decision and supplier status are untouched.
      assert.equal(resolved.body.data.customerStatus, "submitted");
      assert.equal(resolved.body.data.supplier.syncStatus, "not_required");
      assert.match(resolved.body.data.notice, /does not mean a supplier change/);
      const detail = await call("GET", `/tour-operations/requests/${id}`, { bearer: tour });
      const history = detail.body.data.operations.history;
      assert.deepEqual(history.map((entry) => entry.action), ["note_added", "state_changed", "escalated", "state_changed"]);
      assert.deepEqual(history.map((entry) => entry.actorId), [ids.tourAdmin, ids.tourAdmin, ids.tourAdmin2, ids.tourAdmin].map(String));
      assert.equal(history[2].escalatedTo, "SUPPLIER");
      assert.ok(history.every((entry) => entry.at && entry.actorRole === "tour_admin"));
      assert.ok(detail.body.data.auditTrail.some((row) => row.action === "tour_request_escalated"));
      const audits = await AuditLog.find({ entityId: id, action: /^tour_request_/ }).lean();
      assert.equal(audits.length, 4);
      assert.ok(audits.every((row) => ["tour_admin"].includes(row.actorRole) && row.actorId));
      assert.ok(!JSON.stringify(audits).includes("prefers 20 Dec"), "note text is not copied into the audit log");
    });

    await t.test("forbidden transitions and stale versions", async () => {
      const id = String(r.travelers._id);
      const tryMove = (toState, expectedVersion, reason) => call("POST", `/tour-operations/requests/${id}/transition`, { bearer: tour, body: { toState, expectedVersion, ...(reason ? { reason } : {}) } });
      assert.equal((await tryMove("RESOLVED", 0)).body.error.code, "TOUR_REQUEST_TRANSITION_NOT_ALLOWED", "no resolution without review");
      assert.equal((await tryMove("RECEIVED", 0)).body.error.code, "TOUR_REQUEST_TRANSITION_NOT_ALLOWED");
      assert.equal((await tryMove("APPROVED", 0)).status, 422, "unknown states are rejected");
      assert.equal((await tryMove("UNDER_REVIEW", 3)).status, 409, "stale version");
      assert.equal((await tryMove("UNDER_REVIEW", 0)).status, 200);
      assert.equal((await tryMove("UNDER_REVIEW", 1)).body.error.code, "TOUR_REQUEST_TRANSITION_NOT_ALLOWED", "no self transition");
      const body = { toState: "UNDER_REVIEW", expectedVersion: 1 };
      assert.equal((await call("POST", `/tour-operations/requests/${id}/transition`, { bearer: tour, body: { ...body, status: "approved" } })).status, 422, "extra fields are rejected");
      assert.equal((await call("POST", `/tour-operations/requests/${id}/notes`, { bearer: tour, body: { text: "x".repeat(2001) } })).status, 422);
    });

    await t.test("cancellation, date-change and refund requests are escalated, never executed", async () => {
      const cancel = String(r.cancellation._id);
      const toFinance = await call("POST", `/tour-operations/requests/${cancel}/transition`, { bearer: tour, body: { toState: "AWAITING_FINANCE", expectedVersion: 0, reason: "Refund decision needed for cancellation" } });
      assert.equal(toFinance.status, 200);
      assert.equal(toFinance.body.data.operations.history.at(-1).escalatedTo, "FINANCE");
      assert.equal(toFinance.body.data.finance.refundStatus, "requested", "refund untouched");
      const toSupplier = await call("POST", `/tour-operations/requests/${cancel}/transition`, { bearer: tour, body: { toState: "AWAITING_SUPPLIER", expectedVersion: 1, reason: "Supplier cancellation needed" } });
      assert.equal(toSupplier.body.data.operations.history.at(-1).escalatedTo, "SUPPLIER");
      const refundCategory = await call("POST", `/tour-operations/requests/${String(r.agentBCancel._id)}/category`, { bearer: tour, body: { category: "refund_inquiry", expectedVersion: 0 } });
      assert.equal(refundCategory.body.data.operations.category, "refund_inquiry");
      assert.equal(refundCategory.body.data.operations.categorySource, "operations");
      const refundEscalation = await call("POST", `/tour-operations/requests/${String(r.agentBCancel._id)}/transition`, { bearer: tour, body: { toState: "AWAITING_FINANCE", expectedVersion: 1, reason: "Customer asks about refund timing" } });
      assert.equal(refundEscalation.status, 200);
      const dateChange = await call("GET", `/tour-operations/requests/${String(r.reschedule._id)}`, { bearer: tour });
      assert.equal(dateChange.body.data.booking.tour.travelDate, b.websiteConfirmed.travelDate, "supplier-confirmed date unchanged");
      assert.equal((await call("POST", `/tour-operations/requests/${String(r.importedCancel._id)}/transition`, { bearer: tour, body: { toState: "UNDER_REVIEW", expectedVersion: 0 } })).status, 404);
      assert.equal((await call("POST", `/tour-operations/requests/${String(r.importedCancel._id)}/notes`, { bearer: tour, body: { text: "x" } })).status, 404);
    });

    await t.test("concurrent updates: exactly one transition wins; notes are never lost", async () => {
      const id = String(r.concurrency._id);
      const results = await Promise.all(Array.from({ length: 10 }, (_, index) =>
        call("POST", `/tour-operations/requests/${id}/transition`, { bearer: index % 2 ? tour : tour2, body: { toState: index % 2 ? "UNDER_REVIEW" : "REJECTED", expectedVersion: 0, reason: "racing" } })));
      assert.equal(results.filter((result) => result.status === 200).length, 1);
      assert.ok(results.filter((result) => result.status !== 200).every((result) => result.status === 409));
      await Promise.all(Array.from({ length: 8 }, (_, index) => call("POST", `/tour-operations/requests/${id}/notes`, { bearer: tour, body: { text: `note ${index}` } })));
      const detail = await call("GET", `/tour-operations/requests/${id}`, { bearer: tour });
      assert.equal(detail.body.data.operations.notes.filter((entry) => entry.text.startsWith("note ")).length, 8);
      assert.equal(detail.body.data.operations.version, 1);
    });

    await t.test("no booking, payment, invoice, refund, supplier or request-decision state changed", async () => {
      assert.deepEqual(changedFields(before, await snapshot()), []);
      assert.deepEqual(forbiddenCalls, []);
      assert.deepEqual(outbound, []);
    });

    await t.test("a stale Back Office save and Tour Operations changes do not overwrite each other", async () => {
      const staleDocument = await BookingRequest.findById(r.travelers._id);
      await call("POST", `/tour-operations/requests/${String(r.travelers._id)}/notes`, { bearer: tour, body: { text: "added after the document was loaded" } });
      staleDocument.customerNotes = "updated by an older worker";
      await staleDocument.save();
      const stored = await BookingRequest.findById(r.travelers._id).lean();
      assert.equal(stored.customerNotes, "updated by an older worker");
      assert.ok(stored.operations.notes.some((entry) => entry.text === "added after the document was loaded"));
      await BookingRequest.collection.updateOne({ _id: r.travelers._id }, { $set: { customerNotes: "" } });
    });

    await t.test("importer: new imports are BOKUN_IMPORT, matched imports keep their origin and stay single", async () => {
      const service = createBokunConfirmedBookingImportService({ now: () => new Date("2026-10-12T08:00:00.000Z"), bokun: { lookupBooking: async () => { throw new Error("no supplier calls"); } } });
      const raw = (overrides) => ({ bookingId: "BOKUN-5001", id: "BOKUN-5001", confirmationCode: "CONF-5001", status: "CONFIRMED", currency: "USD", totalPrice: 150, totalPaid: 150, channel: { title: "Viator" }, creationDate: "2026-10-01T07:00:00.000Z", customer: { firstName: "Asha", lastName: "Traveler", email: "asha@example.test", phoneNumber: "+255700000001" }, activityBookings: [{ productId: "PROD-1", title: "Stone Town Tour", rateId: "OPT-1", rateTitle: "Morning", date: "2026-12-15", startTime: "09:30", product: { id: "PROD-1", title: "Stone Town Tour" }, pricingCategoryBookings: [{ pricingCategoryId: "adult", quantity: 2, pricingCategory: { id: "adult", title: "Adult" } }] }], ...overrides });
      const imported = await service.importMappedBooking({ mapped: mapBokunBookingForImport({ bokunBooking: { booking: raw({ externalBookingReference: "VTR-9001" }) } }), source: "test" });
      assert.equal(imported.action, "imported");
      const created = await Booking.findOne({ bookingReference: "VTR-9001" }).lean();
      assert.equal(created.bookingOrigin, "BOKUN_IMPORT");
      assert.equal(created.createdByRole, "bokun_import");

      const countBefore = await Booking.countDocuments({});
      const target = b.websitePaidSupplierPending;
      const matched = await service.importMappedBooking({ mapped: mapBokunBookingForImport({ bokunBooking: { booking: raw({ bookingId: "BOKUN-5002", id: "BOKUN-5002", confirmationCode: "CONF-5002", externalBookingReference: target.bookingReference }) } }), source: "test" });
      assert.notEqual(matched.action, "imported");
      assert.equal(await Booking.countDocuments({}), countBefore, "no duplicate canonical booking");
      const merged = await Booking.findById(target._id).lean();
      assert.equal(merged.bookingOrigin, "WEBSITE", "origin preserved");
      assert.equal(merged.operationalSource, "BOKUN", "operationalSource still reflects Bókun evidence");
      assert.equal(merged.bokunBookingId, "BOKUN-5002");
      assert.equal(merged.paymentTransactionId, target.paymentTransactionId, "website payment identity preserved");
      assert.equal(resolveBookingOrigin(merged).origin, "WEBSITE");
      // A historical website booking without a recorded origin is not rewritten by the import either.
      const historicalTarget = b.historicalAgent;
      await service.importMappedBooking({ mapped: mapBokunBookingForImport({ bokunBooking: { booking: raw({ bookingId: "BOKUN-5003", id: "BOKUN-5003", confirmationCode: "CONF-5003", externalBookingReference: historicalTarget.bookingReference }) } }), source: "test" });
      const historicalMerged = await Booking.findById(historicalTarget._id).lean();
      assert.equal(historicalMerged.bookingOrigin, undefined, "no automatic historical rewrite");
      assert.equal(String(historicalMerged.agentId), String(ids.agentA), "Agent ownership preserved");
      assert.equal(resolveBookingOrigin(historicalMerged).origin, "AGENT_PORTAL");
      const list = await call("GET", `/tour-operations/bookings?search=${target.bookingReference}`, { bearer: tour });
      assert.equal(list.body.data.items[0].supplierSync.linkedToBokun, true);
      assert.equal((await call("GET", "/tour-operations/bookings?search=VTR-9001", { bearer: tour })).body.data.total, 0);
    });

    await t.test("default deny: tour_admin reaches no authenticated API route outside Tour Operations", async () => {
      const apiRouter = require("../src/routes");
      const routes = [];
      const walk = (router, prefix) => {
        for (const layer of router.stack || []) {
          if (layer.route && typeof layer.route.path === "string") {
            for (const method of Object.keys(layer.route.methods)) routes.push([method.toUpperCase(), prefix + layer.route.path]);
          } else if (layer.name === "router" && layer.handle?.stack) {
            const source = layer.regexp?.fast_slash ? "" : layer.regexp.source.replace(/^\^/, "").replace(/\\\/\?\(\?=\\\/\|\$\)$/i, "").replace(/\\\//g, "/");
            walk(layer.handle, prefix + source);
          }
        }
      };
      walk(apiRouter, "");
      assert.ok(routes.length > 200, `found ${routes.length} routes`);
      const violations = [];
      for (const [method, template] of routes) {
        if (template.startsWith("/tour-operations")) continue;
        // Every signed-in account may read its own profile.
        if (method === "GET" && template === "/auth/me") continue;
        const route = template.replace(/:[A-Za-z0-9_]+\??/g, "000000000000000000000000");
        const anonymous = await call(method, route);
        if (![401, 403].includes(anonymous.status)) continue;
        const asTourAdmin = await call(method, route, { bearer: tour });
        if (![401, 403].includes(asTourAdmin.status)) violations.push(`${method} ${template} -> ${asTourAdmin.status}`);
      }
      assert.deepEqual(violations, []);
      assert.deepEqual(outbound, []);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    if (child.exitCode === null) { child.kill(); await once(child, "exit"); }
    // Delete only the unique temporary directory created by this test.
    const resolved = fs.realpathSync(directory);
    const tempRoot = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(resolved), tempRoot);
    assert.ok(path.basename(resolved).startsWith("tour-operations-test-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

// Keep the service's documented contract visible to reviewers.
test("Tour Operations workflow never allows RECEIVED -> RESOLVED or a return to RECEIVED", () => {
  assert.ok(!tourOperations.TRANSITIONS.RECEIVED.includes("RESOLVED"));
  for (const targets of Object.values(tourOperations.TRANSITIONS)) assert.ok(!targets.includes("RECEIVED"));
});
