process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/channel-aware-guest-payment-test";
process.env.JWT_SECRET ||= "channel-aware-guest-payment-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveGuestPaymentPolicy } = require("../src/services/bookingPayment/policy");
const { __testables } = require("../src/services/invoices");

const accounting = ({ booking, total = 22, verifiedPaidAmount = 0, refunded = 0 }) => {
  const policy = resolveGuestPaymentPolicy({ booking, total, verifiedPaidAmount });
  return { policy, invoice: __testables.resolveInvoiceAccounting({ bookingStatus: booking.bookingStatus, bookingPaymentStatus: booking.paymentStatus, total, verifiedPaidAmount: policy.amountPaid, confirmedRefundedAmount: refunded }) };
};

test("confirmed GetYourGuide and Viator bookings are guest-paid without local gateway payments", () => {
  for (const [channel, collector] of [["GYG", "GetYourGuide"], ["VIATOR", "Viator"]]) {
    const { policy, invoice } = accounting({ booking: { salesChannel: channel, bookingStatus: "confirmed" } });
    assert.equal(policy.collector, collector);
    assert.equal(invoice.paymentStatus, "paid");
    assert.equal(invoice.amountPaid, 22);
    assert.equal(invoice.balanceDue, 0);
  }
});

test("Bokun Marketplace requires Bokun payment evidence while Bokun Direct does not become paid from confirmation", () => {
  const marketplace = accounting({ booking: { salesChannel: "MARKETPLACE", bookingStatus: "confirmed", bookingPaymentStatusSource: "BOKUN", bookingPaymentStatus: "PAID" } });
  assert.equal(marketplace.policy.collector, "Bokun Marketplace");
  assert.equal(marketplace.invoice.balanceDue, 0);
  const direct = accounting({ booking: { salesChannel: "BOKUN_DIRECT", bookingStatus: "confirmed", paymentMethod: "pay_on_arrival" }, total: 50 });
  assert.equal(direct.invoice.paymentStatus, "pending");
  assert.equal(direct.invoice.amountPaid, 0);
  assert.equal(direct.invoice.balanceDue, 50);
});

test("gateway, payment-link, and pay-on-arrival bookings use only verified local payment totals", () => {
  for (const paymentMethod of ["pesapal", "paypal", "dpo", "payment_link", "cash_on_arrival"]) {
    const pending = accounting({ booking: { salesChannel: "DIRECT_WEBSITE", bookingStatus: "confirmed", paymentMethod }, total: 50 });
    assert.equal(pending.invoice.paymentStatus, "pending");
    const partial = accounting({ booking: { salesChannel: "DIRECT_WEBSITE", bookingStatus: "confirmed", paymentMethod }, total: 50, verifiedPaidAmount: 20 });
    assert.equal(partial.invoice.paymentStatus, "partial");
    assert.equal(partial.invoice.balanceDue, 30);
    const paid = accounting({ booking: { salesChannel: "DIRECT_WEBSITE", bookingStatus: "confirmed", paymentMethod }, total: 50, verifiedPaidAmount: 50 });
    assert.equal(paid.invoice.paymentStatus, "paid");
  }
});

test("OTA payout status and refunds do not double-count the guest payment", () => {
  const { invoice } = accounting({ booking: { salesChannel: "GETYOURGUIDE", bookingStatus: "confirmed", settlement: { status: "PENDING" } }, total: 22, refunded: 5 });
  assert.equal(invoice.amountPaid, 22);
  assert.equal(invoice.amountRefunded, 5);
  assert.equal(invoice.netAmountPaid, 17);
  assert.equal(invoice.balanceDue, 5);
});