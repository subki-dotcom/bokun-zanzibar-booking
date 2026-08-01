process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/refund-workflow-test";
process.env.JWT_SECRET ||= "refund-workflow-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const refundsService = require("../src/services/refunds");
const bookingRequestsService = require("../src/services/bookingRequests");
const invoicesService = require("../src/services/invoices");
const paymentsService = require("../src/services/payments");
const BookingRequest = require("../src/models/BookingRequest");
const {
  buildRefundContextFromRecords,
  canRepairProviderBeforeProcessing,
  extractPesapalConfirmationCode
} = refundsService.__testables;
const { resolveInvoiceAccounting } = invoicesService.__testables;
const { canReplacePaidStatus } = paymentsService.__testables;
const {
  ensureRequestWorkflowDefaults,
  isBokunAlreadyCancelledError,
  isBokunNotConfirmedCancellationError,
  isBokunCancellationConfirmed
} = bookingRequestsService.__testables;

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

test("keeps invoice payment status paid while tracking confirmed refunds separately", () => {
  const accounting = resolveInvoiceAccounting({
    bookingStatus: "cancelled",
    bookingPaymentStatus: "paid",
    total: 1,
    verifiedPaidAmount: 1,
    confirmedRefundedAmount: 1
  });

  assert.equal(accounting.paymentStatus, "paid");
  assert.equal(accounting.amountPaid, 1);
  assert.equal(accounting.amountRefunded, 1);
  assert.equal(accounting.netAmountPaid, 0);
  assert.equal(accounting.balanceDue, 0);
});

test("does not let refund statuses replace a permanent paid payment status", () => {
  assert.equal(canReplacePaidStatus("refunded"), false);
  assert.equal(canReplacePaidStatus("partially_refunded"), false);
  assert.equal(canReplacePaidStatus("reversed"), true);
});

test("allows stale other refund provider to be repaired before provider processing", () => {
  assert.equal(canRepairProviderBeforeProcessing("other", "paypal"), true);
  assert.equal(canRepairProviderBeforeProcessing("", "paypal"), true);
  assert.equal(canRepairProviderBeforeProcessing("pesapal", "paypal"), false);
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

test("backfills cancellation workflow defaults for older booking requests", () => {
  const legacyRequest = {
    type: "cancel_booking",
    status: "submitted",
    originalSnapshot: { totalAmount: 1, currency: "USD" }
  };

  ensureRequestWorkflowDefaults(legacyRequest, {
    amount: 1,
    currency: "USD",
    bokunBookingId: "BOKUN-123",
    bokunConfirmationCode: "CONF-123"
  });

  assert.equal(legacyRequest.bokunSync.status, "pending");
  assert.equal(legacyRequest.bokunSync.bokunBookingId, "BOKUN-123");
  assert.equal(legacyRequest.bokunSync.bokunConfirmationCode, "CONF-123");
  assert.match(legacyRequest.bokunSync.idempotencyKey, /^[0-9a-f-]{36}$/i);
  assert.equal(legacyRequest.refund.status, "not_required");
  assert.equal(legacyRequest.refund.confirmedRefundedAmount, 0);
  assert.equal(legacyRequest.priceAdjustment.type, "unknown");
  assert.equal(legacyRequest.additionalPayment.status, "not_required");
});

test("backfilled legacy cancellation requests pass model validation", () => {
  const legacyRequest = new BookingRequest({
    requestReference: "BRQ-LEGACY-VALIDATION",
    booking: new mongoose.Types.ObjectId(),
    type: "cancel_booking"
  });

  ensureRequestWorkflowDefaults(legacyRequest, {
    amount: 1,
    currency: "USD",
    bokunBookingId: "BOKUN-123",
    bokunConfirmationCode: "CONF-123"
  });

  assert.equal(legacyRequest.customerReason, "Customer requested cancellation");
  assert.ifError(legacyRequest.validateSync());
});

test("recognizes safe Bokun cancellation confirmation variants", () => {
  assert.equal(isBokunCancellationConfirmed(null), true);
  assert.equal(isBokunCancellationConfirmed({ cancelled: true }), true);
  assert.equal(isBokunCancellationConfirmed({ booking: { state: "VOIDED" } }), true);
  assert.equal(isBokunCancellationConfirmed({ message: "Booking already cancelled" }), true);
});

test("detects already-cancelled Bokun errors for idempotent retry recovery", () => {
  assert.equal(
    isBokunAlreadyCancelledError({ details: { message: "This booking is already cancelled" } }),
    true
  );
});

test("detects Bokun not-confirmed cancellation errors for manual supplier review", () => {
  assert.equal(
    isBokunNotConfirmedCancellationError({ details: { message: "Booking is not confirmed." } }),
    true
  );
});
