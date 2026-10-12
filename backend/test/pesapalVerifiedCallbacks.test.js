process.env.NODE_ENV = "test";
process.env.MONGO_URI = "mongodb://127.0.0.1:1/pesapal-fixture";
process.env.JWT_SECRET = "pesapal-fixture-secret";
process.env.PESAPAL_MOCK_MODE = "false";
process.env.PESAPAL_IPN_ID = "fixture-ipn";
process.env.PESAPAL_CONSUMER_KEY = "fixture-key";
process.env.PESAPAL_CONSUMER_SECRET = "fixture-secret";
process.env.BOKUN_MOCK_MODE = "true";
const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
let providerResponse;
const originalCreate = axios.create;
axios.create = (...args) => { const client = originalCreate(...args); client.request = async ({ url }) => ({ data: /Auth/i.test(url)
  ? { token: "fixture-token", expiryDate: "2099-01-01" } : providerResponse }); return client; };
const pesapal = require("../src/services/payments/pesapal");
axios.create = originalCreate;
const Booking = require("../src/models/Booking");
const bookings = require("../src/services/bookings");
const payments = require("../src/services/payments");
const notifications = require("../src/services/notifications");
function setup(t, { paymentStatus = "paid", supplierFailure = null, finalizationStatus = "pending_retry" } = {}) {
  const booking = { _id: "fixture-booking", bookingReference: "FIXTURE-PAID", paymentTransactionId: "fixture-tracking",
    paymentStatus, bookingStatus: "pending", supplierStatus: "supplier_pending", amount: 100, currency: "USD",
    invoiceSnapshot: { paymentStatus: "paid", amountPaid: 100 },
    pendingCheckout: { pesapalMerchantReference: "FIXTURE-PAID", finalization: { status: finalizationStatus, nextRetryAt: "2000-01-01" } },
    save: async () => booking };
  const payment = { _id: "fixture-payment", status: paymentStatus, verificationStatus: paymentStatus === "paid" ? "verified" : "pending",
    orderTrackingId: "fixture-tracking", merchantReference: "FIXTURE-PAID", orderAmount: 100, orderCurrency: "USD" };
  t.mock.method(Booking, "findOne", async () => booking);
  t.mock.method(Booking, "findById", async () => booking);
  t.mock.method(Booking, "findOneAndUpdate", async () => booking);
  t.mock.method(Booking, "findByIdAndUpdate", async () => booking);
  t.mock.method(payments, "findPaymentByGatewayIdentifiers", async () => payment);
  const updates = t.mock.method(payments, "updatePaymentByBookingReference", async () => payment);
  const allocations = t.mock.method(payments, "applyVerifiedPaymentAllocation", async () => {});
  const intents = t.mock.method(payments, "createPaymentIntent", async () => { throw new Error("Unexpected payment creation"); });
  t.mock.method(bookings, "markBookingPaymentState", async ({ paymentStatus: next }) => {
    if (booking.paymentStatus !== "paid" || next === "reversed") booking.paymentStatus = next;
    return booking;
  });
  t.mock.method(bookings, "markBookingPaymentFailed", async () => { if (booking.paymentStatus !== "paid") booking.paymentStatus = "failed"; return booking; });
  t.mock.method(bookings, "reactivateFinalizationAfterPesapalVerification", async () => ({ booking }));
  const finalize = t.mock.method(bookings, "finalizePendingBookingAfterPayment", async () => {
    if (supplierFailure) throw supplierFailure;
    return { booking };
  });
  t.mock.method(notifications, "notifyPaymentFailed", async () => {});
  t.mock.method(notifications, "notifyBokunPending", async () => {});
  providerResponse = { status_code: 0, payment_status_description: "PENDING", order_tracking_id: "fixture-tracking",
    merchant_reference: "FIXTURE-PAID", amount: 100, currency: "USD" };
  const callback = () => pesapal.verifyAndProcessPesapalPayment({ orderTrackingId: "fixture-tracking", orderMerchantReference: "FIXTURE-PAID" });
  const recheck = () => pesapal.recheckPaymentByBookingReference({ bookingReference: "FIXTURE-PAID" });
  return { booking, callback, recheck, updates, allocations, intents, finalize };
}
for (const status of ["PENDING", "FAILED", "CANCELLED", "UNKNOWN"]) {
  test("verified payment survives stale " + status + " callbacks and rechecks", async (t) => {
    const h = setup(t); providerResponse.payment_status_description = status;
    const result = await h.callback();
    assert.equal(result.status, "paid_pending_finalization");
    assert.equal(result.booking.paymentStatus, "paid");
    assert.equal(result.booking.bookingStatus, "pending");
    const rechecked = await h.recheck();
    assert.equal(rechecked.paymentVerified, true);
    assert.equal(rechecked.status, result.status);
    assert.equal(h.booking.amount, 100); assert.equal(h.booking.currency, "USD");
    assert.equal(h.updates.mock.callCount(), 0); assert.equal(h.allocations.mock.callCount(), 0);
    assert.equal(h.intents.mock.callCount(), 0); assert.equal(h.finalize.mock.callCount(), 2);
  });
}
test("unverified failed payment remains failed", async (t) => {
  const h = setup(t, { paymentStatus: "pending" }); providerResponse.payment_status_description = "FAILED";
  const result = await h.recheck(); assert.equal(result.status, "failed"); assert.equal(result.paymentVerified, false);
  assert.equal(h.finalize.mock.callCount(), 0);
});
for (const status of ["REVERSED", "CHARGEBACK"]) {
  test("genuine " + status + " evidence retains reversal handling", async (t) => {
    const h = setup(t); providerResponse.payment_status_description = status;
    const result = await h.recheck(); assert.equal(result.status, "reversed"); assert.equal(result.paymentVerified, false);
    assert.equal(h.booking.paymentStatus, "reversed"); assert.equal(h.finalize.mock.callCount(), 0);
  });
}
for (const code of ["BOKUN_FINALIZATION_PENDING", "BOKUN_SUPPLIER_CONFIRMATION_REVIEW"]) {
  test("verified payment remains verified after " + code, async (t) => {
    const h = setup(t, { supplierFailure: Object.assign(new Error("Supplier fixture"), { code, statusCode: 502 }) });
    const result = await h.recheck(); assert.equal(result.paymentVerified, true);
    assert.equal(h.booking.paymentStatus, "paid"); assert.notEqual(result.booking.bookingStatus, "confirmed");
    assert.equal(h.updates.mock.callCount(), 0);
  });
}
test("supplier failure does not restart finalization on delayed callback", async (t) => {
  const h = setup(t, { finalizationStatus: "failed" });
  const result = await h.recheck(); assert.equal(result.status, "paid_manual_review"); assert.equal(result.paymentVerified, true);
  assert.equal(h.finalize.mock.callCount(), 0);
});

for(const status of ['REFUNDED','DISPUTED']) {
 test('paid '+status+' evidence requires adjustment review without supplier confirmation',async(t)=>{
  const h=setup(t);providerResponse.payment_status_description=status;
  const result=await h.recheck();
  assert.equal(result.status,'paid_manual_review');
  assert.equal(result.reconciliationRequired,true);
  assert.equal(h.finalize.mock.callCount(),0);assert.equal(h.updates.mock.callCount(),0);
  assert.equal(h.booking.paymentStatus,'paid');
 });
}
test('duplicate completed callback does not repeat allocation of verified payment',async(t)=>{
 const h=setup(t);providerResponse.status_code=1;providerResponse.payment_status_description='COMPLETED';providerResponse.confirmation_code='fixture-confirmation';
 await h.callback(); await h.callback();
 assert.equal(h.updates.mock.callCount(),0);assert.equal(h.allocations.mock.callCount(),0);assert.equal(h.intents.mock.callCount(),0);
});
