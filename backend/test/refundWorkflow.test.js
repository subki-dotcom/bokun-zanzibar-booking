process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/refund-workflow-test";
process.env.JWT_SECRET ||= "refund-workflow-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const refundsService = require("../src/services/refunds");
const {
  buildRefundContextFromRecords,
  extractPesapalConfirmationCode
} = refundsService.__testables;

const booking = {
  _id: "booking-1",
  bookingReference: "ZNZ-REFUND-1",
  currency: "USD"
};

test("selects the successful PayPal capture and ignores initiated Pesapal attempts", () => {
  const context = buildRefundContextFromRecords({
    booking,
    eligibleRefundAmount: 1,
    payments: [
      {
        _id: "pay-pesapal-initiated",
        provider: "pesapal",
        status: "initiated",
        amountPaid: 0,
        currency: "USD",
        orderTrackingId: "PESA-PENDING"
      },
      {
        _id: "pay-paypal-paid",
        provider: "paypal",
        status: "paid",
        amountPaid: 1,
        paidAmount: 1,
        currency: "USD",
        providerTransactionId: "PAYPAL-CAPTURE-1234",
        orderTrackingId: "PAYPAL-ORDER-1234"
      }
    ],
    confirmedRefunds: []
  });

  assert.equal(context.provider, "paypal");
  assert.equal(context.providerLabel, "PayPal");
  assert.equal(context.providerKnown, true);
  assert.equal(context.amountPaid, 1);
  assert.equal(context.eligibleRefundAmount, 1);
  assert.equal(context.defaultApprovedRefundAmount, 1);
  assert.equal(context.remainingRefundableAmount, 1);
  assert.equal(context.originalTransactionReferenceMasked, "PAYP...1234");
});

test("requires manual review when multiple successful payment providers contributed", () => {
  const context = buildRefundContextFromRecords({
    booking,
    eligibleRefundAmount: 1,
    payments: [
      { _id: "pay-paypal", provider: "paypal", status: "paid", amountPaid: 0.5, currency: "USD", providerTransactionId: "CAPTURE-1" },
      { _id: "pay-dpo", provider: "dpo", status: "paid", amountPaid: 0.5, currency: "USD", providerTransactionId: "DPO-1" }
    ],
    confirmedRefunds: []
  });

  assert.equal(context.providerKnown, false);
  assert.equal(context.requiresManualReview, true);
  assert.match(context.manualReviewReason, /Multiple successful payment providers/i);
});

test("rejects approved refund amounts above eligibility or remaining captured amount", () => {
  const context = buildRefundContextFromRecords({
    booking,
    eligibleRefundAmount: 1,
    payments: [
      { _id: "pay-paypal", provider: "paypal", status: "paid", amountPaid: 1, currency: "USD", providerTransactionId: "CAPTURE-1" }
    ],
    confirmedRefunds: []
  });

  assert.throws(
    () => refundsService.assertRefundAmountAllowed({ amount: 1.01, context }),
    (error) => error.code === "REFUND_EXCEEDS_ELIGIBLE_AMOUNT"
  );
});

test("extracts Pesapal confirmation code required by refund request", () => {
  const code = extractPesapalConfirmationCode({
    provider: "pesapal",
    rawResponse: {
      confirmation_code: "PESA-CONF-123"
    }
  });

  assert.equal(code, "PESA-CONF-123");
});
