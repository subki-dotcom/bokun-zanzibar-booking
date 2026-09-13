const test = require("node:test");
const assert = require("node:assert/strict");
const { mapBokunPaymentStatus: map } = require("../src/integrations/bokun/bookingPayment.mapper");

test("persisted Bókun PAID_IN_FULL and NOT_PAID fields are mapped independently of channel", () => {
  for (const channel of ["GetYourGuide", "Viator", "Direct", "Unknown"]) {
    assert.equal(map({ channel, totalPrice: 100, totalPaid: 100, paymentType: "PAID_IN_FULL", currency: "USD" }).status, "PAID");
    assert.equal(map({ channel, totalPrice: 100, totalPaid: 0, paymentType: "NOT_PAID", currency: "USD" }).status, "UNPAID");
    assert.equal(map({ channel }).status, "UNKNOWN");
  }
});
test("real monetary evidence distinguishes zero from absent, partial and full payments", () => {
  assert.equal(map({ totalPrice: 100 }).status, "UNKNOWN");
  assert.equal(map({ totalPrice: 100, totalPaid: 0 }).status, "UNPAID");
  assert.equal(map({ totalPrice: 100, totalPaid: 35 }).status, "PARTIALLY_PAID");
  assert.equal(map({ totalPrice: 100, totalPaid: 100 }).status, "PAID");
  assert.equal(map({ totalPrice: 0, totalPaid: 0 }).status, "UNKNOWN");
  assert.equal(map({ totalPaid: 35 }).status, "UNKNOWN");
});
test("cancelled bookings and negative due do not invent refunds", () => {
  assert.equal(map({ status: "CANCELLED", totalPrice: 0, totalPaid: 170, totalDue: -170, paymentType: "PAID_IN_FULL" }).status, "PAID");
  assert.equal(map({ status: "REFUNDED" }).status, "UNKNOWN");
  assert.equal(map({ paymentStatus: "REFUNDED", totalPrice: 100, totalPaid: 100 }).status, "REFUNDED");
});
test("conflicting statuses, invalid amounts, and currency disagreements require review", () => {
  for (const payload of [
    { paymentType: "PAID_IN_FULL", totalPrice: 100, totalPaid: 0 },
    { paymentType: "NOT_PAID", paymentStatus: "PAID" },
    { totalPrice: 100, totalPaid: false }, { totalPrice: 100, totalPaid: " " },
    { totalPrice: 100, totalPaid: -10 }, { totalPrice: 100, totalPaid: 10, paidAmount: 20 },
    { currency: "USD", totalPrice: 100, paidAmountAsMoney: { amount: 100, currency: "EUR" }, invoice: { currency: "USD", totalAsMoney: { amount: 100, currency: "EUR" } } },
    { paymentType: "NEW_UPSTREAM_STATUS", totalPrice: 100, totalPaid: 100 }
  ]) assert.equal(map(payload).status, "UNKNOWN");
});
test("wrapper extraction, monetary object fields, stable sanitized evidence and missing currency", () => {
  const payload = { raw: { booking: { customer: { email: "private@example.com" },
    paidAmountAsMoney: { amount: "50", currency: "USD" }, invoice: { totalAsMoney: { amount: 100, currency: "USD" } }
  } } };
  const result = map(payload);
  assert.equal(result.status, "PARTIALLY_PAID");
  assert.equal(result.reportedPaidAmount, 50);
  assert.equal(result.currency, "USD");
  assert.equal(result.source, "BOKUN");
  assert.deepEqual(result, map(payload));
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(map({ paymentType: "PAID_IN_FULL" }).reportedPaidAmount, null);
  assert.equal(map({ paymentType: "PAID_IN_FULL" }).currency, null);
});
