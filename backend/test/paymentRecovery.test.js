const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET ||= "test-secret";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:9/test";

const {
  paymentAccessKey,
  hasPaymentAccess,
  maskEmail,
  currentPesapalSession,
  customerPaymentStatus,
  cancellationDeadline,
  travelDatePassed
} = require("../src/services/payments/paymentRecoveryCore");

const SECRET = "unit-secret";
const now = Date.parse("2026-10-22T10:00:00Z");
const booking = (overrides = {}) => ({
  _id: "6710aa00bb11cc22dd33ee44",
  bookingReference: "ZNZ-20261022-ABC123",
  paymentStatus: "initiated",
  bookingStatus: "pending",
  paymentMethod: "pesapal",
  paymentTransactionId: "track-current-0001",
  travelDate: "2026-11-10",
  startTime: "07:00",
  pendingCheckout: {
    pesapalOrderTrackingId: "track-current-0001",
    pesapalInitializedAt: "2026-10-22T09:40:00Z",
    pesapalCreateOrderResult: { redirect_url: "https://pay.pesapal.com/iframe/abc" },
    pesapalOrderHistory: [{ orderTrackingId: "track-old-0000" }]
  },
  ...overrides
});

test("the payment link key is signed per booking and the reference alone never opens it", () => {
  const key = paymentAccessKey(booking(), SECRET);
  assert.equal(key.length, 32);
  assert.equal(hasPaymentAccess(booking(), key, SECRET), true);
  assert.equal(hasPaymentAccess(booking(), "ZNZ-20261022-ABC123", SECRET), false);
  assert.equal(hasPaymentAccess(booking(), "", SECRET), false);
  assert.equal(hasPaymentAccess(booking({ _id: "other" }), key, SECRET), false);
  assert.notEqual(paymentAccessKey(booking(), "another-secret"), key);
});

test("older links keyed by a provider order id still open the booking", () => {
  assert.equal(hasPaymentAccess(booking(), "track-current-0001", SECRET), true);
  assert.equal(hasPaymentAccess(booking(), "track-old-0000", SECRET), true);
  assert.equal(hasPaymentAccess(booking(), "track-unknown-9", SECRET), false);
});

test("emails are masked for the payment pages", () => {
  assert.equal(maskEmail("amina.smith@example.com"), "a******@example.com");
  assert.equal(maskEmail("jo@x.io"), "j***@x.io");
  assert.equal(maskEmail("not-an-email"), "");
});

test("a saved Pesapal page is offered again only while it is recent", () => {
  const session = currentPesapalSession(booking(), { now });
  assert.equal(session.redirectUrl, "https://pay.pesapal.com/iframe/abc");
  assert.equal(session.expired, false);
  assert.equal(currentPesapalSession(booking(), { now: now + 2 * 3600 * 1000 }).expired, true);
  assert.equal(currentPesapalSession(booking({ pendingCheckout: {} }), { now }), null);
});

test("the booking maps to one customer screen", () => {
  assert.equal(customerPaymentStatus(booking(), { now }), "awaiting_payment");
  assert.equal(customerPaymentStatus(booking(), { now: now + 2 * 3600 * 1000 }), "expired");
  assert.equal(customerPaymentStatus(booking({ pendingCheckout: {} }), { now }), "expired");
  assert.equal(customerPaymentStatus(booking({ paymentStatus: "processing" }), { now }), "processing");
  assert.equal(customerPaymentStatus(booking({ paymentStatus: "failed", bookingStatus: "failed" }), { now }), "failed");
  assert.equal(customerPaymentStatus(booking({ paymentStatus: "paid" }), { now }), "paid");
  assert.equal(customerPaymentStatus(booking({ bookingStatus: "confirmed" }), { now }), "paid");
  assert.equal(customerPaymentStatus(booking({ bookingStatus: "cancelled" }), { now }), "cancelled");
  assert.equal(customerPaymentStatus(booking({ paymentMethod: "dpo" }), { now }), "expired");
});

test("the free-cancellation deadline comes from the saved policy", () => {
  assert.equal(cancellationDeadline(booking({ cancellationPolicySnapshot: { deadline: "2026-11-09T07:00:00+03:00" } })), "2026-11-09T04:00:00.000Z");
  assert.equal(cancellationDeadline(booking({ cancellationPolicySnapshot: { freeCancellationCutoffValue: 24, freeCancellationCutoffUnit: "hours" } })), "2026-11-09T04:00:00.000Z");
  assert.equal(cancellationDeadline(booking({ cancellationPolicySnapshot: {} })), "");
});

test("a tour day in the past is detected in Zanzibar time", () => {
  assert.equal(travelDatePassed(booking({ travelDate: "2026-10-21" }), now), true);
  assert.equal(travelDatePassed(booking({ travelDate: "2026-10-22" }), now), false);
  // 22:30 UTC is already the 23rd in Zanzibar.
  assert.equal(travelDatePassed(booking({ travelDate: "2026-10-22" }), Date.parse("2026-10-22T22:30:00Z")), true);
});

test("a payment on a replaced Pesapal order is matched to that order", () => {
  const { __testables } = require("../src/services/payments/pesapal");
  const replacedBooking = booking({
    amount: 300,
    currency: "USD",
    pendingCheckout: {
      ...booking().pendingCheckout,
      pesapalMerchantReference: "ZNZ-20261022-ABC123-new",
      pesapalRequestedAmount: "300.00",
      pesapalRequestedCurrency: "USD",
      pesapalOrderHistory: [{ orderTrackingId: "track-old-0000", merchantReference: "ZNZ-20261022-ABC123-old", amount: "300.00", currency: "USD" }]
    }
  });
  assert.equal(__testables.findReplacedPesapalOrder(replacedBooking, "track-old-0000").merchantReference, "ZNZ-20261022-ABC123-old");
  const verification = {
    isPaid: true,
    status: "COMPLETED",
    orderTrackingId: "track-old-0000",
    providerOrderTrackingId: "track-old-0000",
    merchantReference: "ZNZ-20261022-ABC123-old",
    amount: 300,
    currency: "USD",
    raw: { payment_status_description: "Completed", amount: 300, currency: "USD", order_tracking_id: "track-old-0000", merchant_reference: "ZNZ-20261022-ABC123-old", status_code: 1 }
  };
  assert.doesNotThrow(() => __testables.validatePesapalVerification({ booking: replacedBooking, verification, orderTrackingId: "track-old-0000" }));
  assert.throws(
    () => __testables.validatePesapalVerification({ booking: replacedBooking, verification: { ...verification, merchantReference: "someone-else" }, orderTrackingId: "track-old-0000" }),
    /merchant reference/i
  );
});
