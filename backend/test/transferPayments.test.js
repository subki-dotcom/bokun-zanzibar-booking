// Transfer payments (Pesapal) end to end against a real MongoDB, using a throwaway database that is dropped
// afterwards, and a fake Pesapal: nothing here reaches the real Pesapal. Skipped when no MongoDB is reachable on
// 127.0.0.1:27017 (for example in CI). The gateway unit tests at the bottom always run.
const TEST_DB = `rt_payments_${process.pid}`;
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
const express = require("express");
const mongoose = require("mongoose");

const AppError = require("../src/utils/AppError");
const errorHandler = require("../src/middleware/errorHandler");
const { getTransferStore, closeTransferStore } = require("../src/transfers/db/connection");
const { createTransferServices, createTransferAdminApi, createTransferPublicApi } = require("../src/transfers");
const { createPesapalTransferGateway, transactionState } = require("../src/transfers/payments/pesapalGateway");

const PASSWORD = "Payments-Admin-Passw0rd";

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

// A stand-in for Pesapal: orders it opened, and what GetTransactionStatus answers for each.
const fakePesapal = () => {
  const orders = new Map();
  let count = 0;
  return {
    orders,
    submitted: [],
    down: false,
    configured: () => true,
    async submitOrder(order) {
      this.submitted.push(order);
      const orderTrackingId = `TRK-${(count += 1)}-${crypto.randomUUID().slice(0, 8)}`;
      orders.set(orderTrackingId, { state: "PENDING", status: "INVALID", statusCode: 0, merchantReference: order.merchantReference, amount: order.amount, currency: order.currency });
      return { orderTrackingId, redirectUrl: `https://pay.example.test/${orderTrackingId}` };
    },
    async transactionStatus(orderTrackingId) {
      if (this.down) throw new AppError("Pesapal could not be reached.", 502, "TRANSFER_PESAPAL_UNAVAILABLE");
      const order = orders.get(orderTrackingId);
      return { ...order, orderTrackingId, paymentMethod: order.state === "PAID" ? "Visa" : "", confirmationCode: order.state === "PAID" ? `CONF-${orderTrackingId}` : "" };
    },
    set(orderTrackingId, changes) {
      Object.assign(orders.get(orderTrackingId), changes);
    },
    pay(orderTrackingId, changes = {}) {
      this.set(orderTrackingId, { state: "PAID", status: "COMPLETED", statusCode: 1, ...changes });
    }
  };
};

test("transfer payments against a real database and a fake Pesapal", async (t) => {
  if (!(await mongoReachable())) {
    t.skip("MongoDB is not reachable on 127.0.0.1:27017");
    return;
  }
  const pesapal = fakePesapal();
  const testApp = express();
  testApp.use(express.json());
  // Generous limits for the behavioural tests; the real limits are covered by the public booking API tests.
  testApp.use("/api/transfers", createTransferPublicApi({ gateway: pesapal, limits: { locations: 1000, quote: 1000, bookings: 1000, lookup: 1000, payments: 1000 } }));
  testApp.use("/api/transfer-admin", createTransferAdminApi({ gateway: pesapal }));
  testApp.use(errorHandler);
  const server = http.createServer(testApp);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, path, { token, access, body, headers = {} } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(access ? { "X-Transfer-Access-Token": access } : {}),
        ...headers
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await response.json().catch(() => null);
    return { status: response.status, json, data: json?.data, code: json?.error?.code };
  };

  try {
    const store = await getTransferStore();
    const services = createTransferServices({ gateway: pesapal });
    await services.auth.createFirstAdmin({ name: "Admin", email: "admin@example.test", password: PASSWORD });
    const login = async (email) => (await call("POST", "/transfer-admin/auth/login", { body: { email, password: PASSWORD } })).data.token;
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
    const airport = await services.catalog.createLocation({ actor, input: { name: "Airport", type: "AIRPORT", zoneId: zoneA.id } });
    const hotel = await services.catalog.createLocation({ actor, input: { name: "Hotel", type: "HOTEL", zoneId: zoneB.id } });
    const route = await services.catalog.createRoute({ actor, input: { fromZoneId: zoneA.id, toZoneId: zoneB.id, bidirectional: true } });
    await services.catalog.createRate({ actor, input: { routeId: route.id, minPassengers: 1, maxPassengers: 5, price: "45" } });

    const book = async (overrides = {}) => {
      const result = await call("POST", "/transfers/bookings", {
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: {
          tripType: "ONE_WAY",
          pickupLocationId: airport.id,
          dropoffLocationId: hotel.id,
          travelDate: daysAhead(5),
          travelTime: "10:00",
          passengers: { adults: 2 },
          customer: { fullName: "Jane Doe", email: "jane@example.test", phone: "+255 700 000 001", whatsapp: true },
          expectedTotal: "45.00",
          ...overrides
        }
      });
      assert.equal(result.status, 201, JSON.stringify(result.json));
      const stored = await store.models.Booking.findOne({ reference: result.data.reference }).lean();
      return { reference: result.data.reference, access: result.data.accessToken, id: String(stored._id) };
    };
    const start = (booking) => call("POST", `/transfers/bookings/${booking.reference}/payments`, { access: booking.access });
    const trackingFor = async (merchantReference) => (await store.models.Payment.findOne({ merchantReference }).lean()).orderTrackingId;
    const returnPage = (trackingId, merchantReference) => call("GET", `/transfers/payments/return?OrderTrackingId=${trackingId}&OrderMerchantReference=${merchantReference}&OrderNotificationType=CALLBACKURL`);
    const ipn = (trackingId, merchantReference) => call("GET", `/transfers/payments/ipn?OrderTrackingId=${trackingId}&OrderMerchantReference=${merchantReference}&OrderNotificationType=IPNCHANGE`);
    const stored = (booking) => store.models.Booking.findById(booking.id).lean();
    const ctx = {};

    await t.test("online payment is offered when Pesapal is configured", async () => {
      const options = await call("GET", "/transfers/options");
      assert.equal(options.data.payment.onlineAvailable, true);
    });

    await t.test("a customer starts paying the exact server price with Pesapal; nothing is confirmed yet", async () => {
      ctx.booking = await book();
      assert.equal((await call("GET", `/transfers/bookings/${ctx.booking.reference}`, { access: ctx.booking.access })).data.canPay, true);
      assert.equal((await call("POST", `/transfers/bookings/${ctx.booking.reference}/payments`, { access: "wrong" })).status, 404);

      const started = await start(ctx.booking);
      assert.equal(started.status, 201);
      assert.match(started.data.redirectUrl, /^https:\/\/pay\.example\.test\//);
      assert.ok(started.data.merchantReference.startsWith(`${ctx.booking.reference}-`));
      const sent = pesapal.submitted.at(-1);
      assert.equal(sent.amount, "45.00");
      assert.equal(sent.currency, "USD");
      assert.equal(sent.customer.email, "jane@example.test");

      const payment = await store.models.Payment.findOne({ merchantReference: started.data.merchantReference }).lean();
      assert.equal(payment.status, "PENDING");
      assert.equal(Number(payment.amount.toString()), 45);
      assert.ok(payment.orderTrackingId);
      ctx.merchantReference = started.data.merchantReference;
      ctx.trackingId = payment.orderTrackingId;
      assert.equal((await stored(ctx.booking)).status, "AWAITING_PAYMENT");
    });

    await t.test("the return page before payment changes nothing: Pesapal still says not paid", async () => {
      const result = await returnPage(ctx.trackingId, ctx.merchantReference);
      assert.equal(result.status, 200);
      assert.equal(result.data.reference, ctx.booking.reference);
      assert.equal(result.data.payment.status, "PENDING");
      assert.deepEqual(result.data.booking, { status: "AWAITING_PAYMENT", paymentStatus: "UNPAID" });
    });

    await t.test("a failed attempt is recorded, and a later successful one on the same order still confirms", async () => {
      pesapal.set(ctx.trackingId, { state: "FAILED", status: "FAILED", statusCode: 2 });
      assert.equal((await returnPage(ctx.trackingId, ctx.merchantReference)).data.payment.status, "FAILED");
      assert.equal((await stored(ctx.booking)).status, "AWAITING_PAYMENT");
      pesapal.pay(ctx.trackingId);
    });

    await t.test("Pesapal's verified payment confirms the booking exactly once, from the return page and the IPN together", async () => {
      const [fromReturn, fromIpn] = await Promise.all([returnPage(ctx.trackingId, ctx.merchantReference), ipn(ctx.trackingId, ctx.merchantReference)]);
      assert.equal(fromReturn.status, 200);
      assert.deepEqual(fromReturn.data.booking, { status: "CONFIRMED", paymentStatus: "PAID" });
      assert.deepEqual(fromIpn.json, { orderNotificationType: "IPNCHANGE", orderTrackingId: ctx.trackingId, orderMerchantReference: ctx.merchantReference, status: 200 });
      await ipn(ctx.trackingId, ctx.merchantReference);

      const booking = await stored(ctx.booking);
      assert.equal(booking.status, "CONFIRMED");
      assert.equal(booking.paymentStatus, "PAID");
      assert.equal(booking.paymentAlert, "");
      assert.equal(booking.statusHistory.filter((entry) => entry.status === "CONFIRMED").length, 1);
      const payment = await store.models.Payment.findOne({ orderTrackingId: ctx.trackingId }).lean();
      assert.equal(payment.status, "PAID");
      assert.equal(payment.outcome, "APPLIED");
      assert.equal(payment.confirmationCode, `CONF-${ctx.trackingId}`);
      assert.ok(payment.checks.some((check) => check.source === "IPN"));
      assert.equal(await store.models.AuditLog.countDocuments({ action: "payment.verified", entityId: ctx.booking.id }), 1);
    });

    await t.test("a paid booking cannot be paid again", async () => {
      assert.equal((await call("GET", `/transfers/bookings/${ctx.booking.reference}`, { access: ctx.booking.access })).data.canPay, false);
      const again = await start(ctx.booking);
      assert.equal(again.status, 409);
      assert.equal(again.code, "TRANSFER_ALREADY_PAID");
    });

    await t.test("a second payment for a booking that is already paid is kept as needing a refund", async () => {
      const booking = await book();
      const first = (await start(booking)).data.merchantReference;
      const second = (await start(booking)).data.merchantReference;
      pesapal.pay(await trackingFor(first));
      pesapal.pay(await trackingFor(second));
      await returnPage(await trackingFor(first), first);
      await ipn(await trackingFor(second), second);
      const after = await stored(booking);
      assert.equal(after.status, "CONFIRMED");
      assert.equal(after.paymentAlert, "NEEDS_REFUND");
      const extra = await store.models.Payment.findOne({ merchantReference: second }).lean();
      assert.equal(extra.status, "PAID");
      assert.equal(extra.outcome, "NEEDS_REFUND");
      assert.match(extra.outcomeReason, /already paid/);
      ctx.refundBooking = booking;
    });

    await t.test("money that arrives after the booking was rejected never confirms it", async () => {
      const booking = await book();
      const merchantReference = (await start(booking)).data.merchantReference;
      const rejected = await call("POST", `/transfer-admin/bookings/${booking.id}/reject`, { token: manager, body: { reason: "No vehicle available that day" } });
      assert.equal(rejected.status, 200);
      pesapal.pay(await trackingFor(merchantReference));
      await ipn(await trackingFor(merchantReference), merchantReference);
      const after = await stored(booking);
      assert.equal(after.status, "REJECTED");
      assert.equal(after.paymentStatus, "UNPAID");
      assert.equal(after.paymentAlert, "NEEDS_REFUND");
    });

    await t.test("a different amount or currency from Pesapal is never accepted as payment of the booking", async () => {
      const booking = await book();
      const merchantReference = (await start(booking)).data.merchantReference;
      pesapal.pay(await trackingFor(merchantReference), { amount: "4.50" });
      await returnPage(await trackingFor(merchantReference), merchantReference);
      const after = await stored(booking);
      assert.equal(after.status, "AWAITING_PAYMENT");
      assert.equal(after.paymentAlert, "NEEDS_REFUND");

      const other = await book();
      const ref = (await start(other)).data.merchantReference;
      pesapal.pay(await trackingFor(ref), { currency: "TZS", amount: "45.00" });
      await returnPage(await trackingFor(ref), ref);
      assert.equal((await stored(other)).status, "AWAITING_PAYMENT");
    });

    await t.test("Pesapal reporting another order for the tracking id is refused and audited", async () => {
      const booking = await book();
      const merchantReference = (await start(booking)).data.merchantReference;
      const trackingId = await trackingFor(merchantReference);
      pesapal.pay(trackingId, { merchantReference: "TRF-OTHER-123" });
      const result = await returnPage(trackingId, merchantReference);
      assert.equal(result.status, 409);
      assert.equal(result.code, "TRANSFER_PAYMENT_MISMATCH");
      assert.equal((await stored(booking)).status, "AWAITING_PAYMENT");
      assert.equal(await store.models.AuditLog.countDocuments({ action: "payment.reference_mismatch", entityId: booking.id }), 1);
    });

    await t.test("unknown orders and wrong references are not found; the IPN asks Pesapal to retry only on errors", async () => {
      assert.equal((await returnPage("TRK-UNKNOWN", "X")).status, 404);
      assert.equal((await returnPage(ctx.trackingId, "TRF-WRONG-REF")).status, 404);
      assert.equal((await ipn("TRK-UNKNOWN", "X")).json.status, 200);
      pesapal.down = true;
      assert.equal((await ipn(ctx.trackingId, ctx.merchantReference)).json.status, 500);
      pesapal.down = false;
    });

    await t.test("payment is refused once the pickup time has passed, and before a quote request is priced", async () => {
      const late = await book();
      await store.models.Booking.collection.updateOne({ _id: new mongoose.Types.ObjectId(late.id) }, { $set: { "legs.0.pickupAt": new Date(Date.now() - 60000) } });
      const closed = await start(late);
      assert.equal(closed.status, 409);
      assert.equal(closed.code, "TRANSFER_PAYMENT_CLOSED");

      const quote = await book({ passengers: { adults: 9 }, expectedTotal: null });
      const unpriced = await start(quote);
      assert.equal(unpriced.status, 409);
      assert.equal(unpriced.code, "TRANSFER_NOT_PRICED");
      assert.equal(await store.models.Payment.countDocuments({ bookingReference: { $in: [late.reference, quote.reference] } }), 0);
    });

    await t.test("a quote request priced by staff is then paid online and confirmed", async () => {
      const quote = await book({ passengers: { adults: 9 }, expectedTotal: null });
      const priced = await call("POST", `/transfer-admin/bookings/${quote.id}/quote`, { token: manager, body: { legs: [{ direction: "OUTBOUND", price: "120" }], reason: "Minibus for nine" } });
      assert.equal(priced.status, 200);
      const merchantReference = (await start(quote)).data.merchantReference;
      assert.equal(pesapal.submitted.at(-1).amount, "120.00");
      pesapal.pay(await trackingFor(merchantReference), { amount: 120 });
      await returnPage(await trackingFor(merchantReference), merchantReference);
      const after = await stored(quote);
      assert.equal(after.status, "CONFIRMED");
      assert.equal(after.paymentStatus, "PAID");
    });

    await t.test("Pesapal start failures are recorded and leave the booking unpaid", async () => {
      const booking = await book();
      const original = pesapal.submitOrder;
      pesapal.submitOrder = async () => {
        throw new AppError("Pesapal could not be reached.", 502, "TRANSFER_PESAPAL_UNAVAILABLE");
      };
      const failed = await start(booking);
      pesapal.submitOrder = original;
      assert.equal(failed.status, 502);
      const payment = await store.models.Payment.findOne({ bookingReference: booking.reference }).lean();
      assert.equal(payment.status, "FAILED");
      assert.equal((await stored(booking)).status, "AWAITING_PAYMENT");
    });

    await t.test("Transfer Admin shows payments to roles that may see them, flags refunds, and can only re-ask Pesapal", async () => {
      const booking = ctx.refundBooking;
      assert.equal((await call("GET", `/transfer-admin/bookings/${booking.id}/payments`, { token: dispatcher })).status, 403);
      assert.equal((await call("GET", `/transfer-admin/bookings/${booking.id}/payments`, { token: manager })).status, 403);
      const list = await call("GET", `/transfer-admin/bookings/${booking.id}/payments`, { token: accountant });
      assert.equal(list.status, 200);
      assert.equal(list.data.length, 2);
      assert.deepEqual(list.data.map((payment) => payment.outcome).sort(), ["APPLIED", "NEEDS_REFUND"]);

      const detail = await call("GET", `/transfer-admin/bookings/${booking.id}`, { token: manager });
      assert.equal(detail.data.paymentAlert, "NEEDS_REFUND");
      const flagged = await call("GET", "/transfer-admin/bookings?paymentAlert=any", { token: manager });
      assert.ok(flagged.data.items.every((item) => item.paymentAlert));
      assert.ok(flagged.data.items.some((item) => item.id === booking.id));
      const dashboard = await call("GET", "/transfer-admin/dashboard", { token: manager });
      assert.equal(dashboard.data.paymentAlerts, flagged.data.pagination.total);

      const pending = await book();
      await start(pending);
      const paymentId = (await call("GET", `/transfer-admin/bookings/${pending.id}/payments`, { token: admin })).data[0].id;
      assert.equal((await call("POST", `/transfer-admin/bookings/${pending.id}/payments/${paymentId}/recheck`, { token: manager })).status, 403);
      const rechecked = await call("POST", `/transfer-admin/bookings/${pending.id}/payments/${paymentId}/recheck`, { token: accountant });
      assert.equal(rechecked.status, 200);
      assert.equal(rechecked.data.status, "PENDING");
      assert.equal(rechecked.data.checks.at(-1).source, "ADMIN");
      assert.equal((await stored(pending)).status, "AWAITING_PAYMENT");
    });

    await t.test("a payment reversed by Pesapal after confirmation is flagged; the booking record is not rewritten", async () => {
      pesapal.set(ctx.trackingId, { state: "REVERSED", status: "REVERSED", statusCode: 3 });
      await ipn(ctx.trackingId, ctx.merchantReference);
      const booking = await stored(ctx.booking);
      assert.equal(booking.status, "CONFIRMED");
      assert.equal(booking.paymentAlert, "PAYMENT_REVERSED");
      assert.equal((await store.models.Payment.findOne({ orderTrackingId: ctx.trackingId }).lean()).status, "REVERSED");
    });

    await t.test("bookings still cannot be confirmed or marked paid without a verified payment", async () => {
      const booking = await book();
      await assert.rejects(store.models.Booking.updateOne({ _id: booking.id }, { $set: { status: "CONFIRMED" } }), { code: "TRANSFER_PAYMENT_RULE" });
      await assert.rejects(store.models.Booking.updateOne({ _id: booking.id }, { $set: { paymentStatus: "PAID" } }), { code: "TRANSFER_PAYMENT_RULE" });
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    const store = await getTransferStore().catch(() => null);
    if (store) await store.connection.dropDatabase().catch(() => {});
    await closeTransferStore();
    await mongoose.disconnect().catch(() => {});
  }
});

test("Pesapal answers map to transfer payment states; only a completed status_code 1 is paid", () => {
  assert.equal(transactionState({ status_code: 1 }, "COMPLETED"), "PAID");
  assert.equal(transactionState({ status_code: 0 }, "COMPLETED"), "PENDING");
  assert.equal(transactionState({ status_code: 0 }, "INVALID"), "PENDING");
  assert.equal(transactionState({ status_code: 2 }, "FAILED"), "FAILED");
  assert.equal(transactionState({ status_code: 3 }, "REVERSED"), "REVERSED");
  assert.equal(transactionState({}, "CANCELLED"), "CANCELLED");
  assert.equal(transactionState({}, "PENDING"), "PENDING");
});

test("the transfer Pesapal client sends the transfer return page and IPN, and registers the IPN only once", async () => {
  const calls = [];
  const http = {
    request: async (options) => {
      calls.push(options);
      if (options.url === "/auth") return { data: { token: "T1", expiryDate: new Date(Date.now() + 300000).toISOString() } };
      if (options.url === "/ipn") return { data: { ipn_id: "IPN-TRANSFER" } };
      if (options.url === "/order") return { data: { order_tracking_id: `TRK-${calls.length}`, merchant_reference: options.data.id, redirect_url: "https://pay.example.test/x" } };
      if (options.url === "/status") return { data: { status_code: 1, payment_status_description: "Completed", amount: 45, currency: "usd", merchant_reference: "TRF-1", confirmation_code: "ABC", payment_method: "Visa" } };
      throw new Error(`unexpected ${options.url}`);
    }
  };
  const settings = {
    authPath: "/auth", submitOrderPath: "/order", statusPath: "/status", registerIpnPath: "/ipn",
    consumerKey: "key", consumerSecret: "secret", ipnId: "", ipnUrl: "https://api.example.test/api/transfers/payments/ipn",
    returnUrl: "https://site.example.test/transfers/payment/return"
  };
  const gateway = createPesapalTransferGateway({ settings: () => settings, http });
  assert.equal(gateway.configured(), true);
  assert.equal(createPesapalTransferGateway({ settings: () => ({ ...settings, ipnUrl: "" }), http }).configured(), false);

  const customer = { fullName: "Jane Van Doe", email: "jane@example.test", phone: "+255700000001" };
  await gateway.submitOrder({ merchantReference: "TRF-1-AB", amount: "45.00", currency: "USD", description: "Zanzibar transfer TRF-1", customer });
  await gateway.submitOrder({ merchantReference: "TRF-1-CD", amount: "45.00", currency: "USD", description: "Zanzibar transfer TRF-1", customer });
  assert.equal(calls.filter((call) => call.url === "/auth").length, 1);
  assert.equal(calls.filter((call) => call.url === "/ipn").length, 1);
  const order = calls.find((call) => call.url === "/order").data;
  assert.equal(order.callback_url, settings.returnUrl);
  assert.equal(order.notification_id, "IPN-TRANSFER");
  assert.equal(order.amount, 45);
  assert.deepEqual(order.billing_address, { email_address: "jane@example.test", phone_number: "+255700000001", first_name: "Jane", last_name: "Van Doe" });
  assert.equal(calls.find((call) => call.url === "/order").headers.Authorization, "Bearer T1");

  const status = await gateway.transactionStatus("TRK-9");
  assert.equal(status.state, "PAID");
  assert.equal(status.currency, "USD");
  assert.equal(status.amount, "45");
  assert.equal(status.merchantReference, "TRF-1");
});

test("transfer payments work from the existing Pesapal settings: own IPN path on the same backend, return page on the website", () => {
  const { gatewaySettings } = require("../src/transfers/payments/pesapalGateway");
  const existing = { PESAPAL_IPN_URL: "https://api.example.test/api/payments/pesapal/ipn", FRONTEND_URL: "http://localhost:5173,https://site.example.test" };
  const settings = gatewaySettings(existing);
  assert.equal(settings.ipnUrl, "https://api.example.test/api/transfers/payments/ipn");
  assert.equal(settings.returnUrl, "http://localhost:5173/transfers/payment/return");
  assert.equal(gatewaySettings({ ...existing, TRANSFER_PESAPAL_IPN_URL: "https://other.example.test/ipn" }).ipnUrl, "https://other.example.test/ipn");
  assert.equal(gatewaySettings({ ...existing, PESAPAL_IPN_URL: "not a url" }).ipnUrl, "");
});
