process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/refund-workflow-test";
process.env.JWT_SECRET ||= "refund-workflow-test-secret";
process.env.PESAPAL_MOCK_MODE ||= "true";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const refundsService = require("../src/services/refunds");
const bookingRequestsService = require("../src/services/bookingRequests");
const invoicesService = require("../src/services/invoices");
const paymentsService = require("../src/services/payments");
const pesapalService = require("../src/services/payments/pesapal");
const BookingRequest = require("../src/models/BookingRequest");
const {
  buildRefundContextFromRecords,
  buildRefundSummaryFromRecords,
  canRepairProviderBeforeProcessing,
  determinePesapalRefundVerification,
  extractPesapalConfirmationCode,
  normalizeRefundResult,
  refundStatusFromTotals
} = refundsService.__testables;
const { resolveInvoiceAccounting } = invoicesService.__testables;
const { canReplacePaidStatus } = paymentsService.__testables;
const {
  ensureRequestWorkflowDefaults,
  resolveRequestEligibleRefundAmount,
  isBokunAlreadyCancelledError,
  isBokunNotConfirmedCancellationError,
  isBokunCancellationConfirmed
} = bookingRequestsService.__testables;

const booking = {
  _id: "booking-1",
  bookingReference: "ZNZ-REFUND-1",
  currency: "USD"
};

test("Pesapal RefundRequest 200 stays awaiting merchant approval instead of refunded", async () => {
  const result = await pesapalService.requestRefund({
    confirmationCode: "PESA-CONF-123",
    amount: 1,
    username: "Admin",
    remarks: "Cancellation refund",
    requestId: "test-pesapal-refund"
  });

  assert.equal(result.status, "AWAITING_MERCHANT_APPROVAL");
  assert.equal(result.providerRefundRequestReference, "PESA-CONF-123");
  assert.equal(result.providerRefundReference, "");
  assert.equal(result.confirmedAmount, 0);
  assert.equal(result.requiresMerchantApproval, true);
});

test("admin refund eligibility prefers policy amount over stale zero request defaults", () => {
  const request = {
    type: "cancel_booking",
    cancellationPolicySnapshot: { estimatedRefundAmount: 1, requiresManualReview: false },
    refund: { status: "manual_review", estimatedAmount: 0, eligibleAmount: 0 }
  };

  assert.equal(resolveRequestEligibleRefundAmount(request), 1);
});

test("admin refund eligibility does not show stale zero when policy requires review", () => {
  const request = {
    type: "cancel_booking",
    cancellationPolicySnapshot: { estimatedRefundAmount: null, requiresManualReview: true },
    refund: { status: "manual_review", estimatedAmount: 0, eligibleAmount: 0 }
  };

  assert.equal(resolveRequestEligibleRefundAmount(request), null);
});

test("admin refund eligibility uses approved refund over stale zero on processing requests", () => {
  const request = {
    type: "cancel_booking",
    cancellationPolicySnapshot: { estimatedRefundAmount: null, requiresManualReview: true },
    refund: { status: "processing", estimatedAmount: 0, eligibleAmount: 0, approvedAmount: 1 }
  };

  assert.equal(resolveRequestEligibleRefundAmount(request), 1);
});

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

test("classifies refund totals as none, partial and full without changing paid amount", () => {
  assert.equal(refundStatusFromTotals({ totalRefunded: 0, amountPaid: 100 }), "not_required");
  assert.equal(refundStatusFromTotals({ totalRefunded: 40, amountPaid: 100 }), "partially_refunded");
  assert.equal(refundStatusFromTotals({ totalRefunded: 100, amountPaid: 100 }), "refunded");

  const result = normalizeRefundResult({
    booking: { bookingStatus: "cancelled", currency: "USD" },
    payment: { status: "paid", amountPaid: 100, paidAmount: 100, currency: "USD" },
    refund: { status: "refunded", provider: "paypal", providerRefundReference: "RFD-123", completedAt: "2026-08-04T08:00:00.000Z" },
    totalRefunded: 100,
    currency: "USD"
  });

  assert.equal(result.status, "refunded");
  assert.equal(result.paymentStatus, "paid");
  assert.equal(result.bookingStatus, "cancelled");
  assert.equal(result.amountPaid, 100);
  assert.equal(result.amountRefunded, 100);
  assert.equal(result.refundableBalance, 0);
  assert.equal(result.providerRefundReference, "RFD-123");
});

test("admin refund summary prefers confirmed refund accounting over stale request status", () => {
  const summary = buildRefundSummaryFromRecords({
    booking: {
      bookingReference: "ZNZ-SUMMARY-1",
      bookingStatus: "cancelled",
      paymentStatus: "paid",
      refundStatus: "processing",
      amountRefunded: 0,
      currency: "USD"
    },
    payments: [
      { _id: "payment-1", provider: "paypal", status: "paid", amountPaid: 100, paidAmount: 100, currency: "USD" }
    ],
    invoice: { amountPaid: 100, amountRefunded: 100, accountingCurrency: "USD" },
    refund: {
      _id: "refund-1",
      paymentId: "payment-1",
      refundReference: "RFD-SUMMARY-1",
      status: "refunded",
      confirmedRefundedAmount: 100,
      currency: "USD",
      provider: "paypal",
      providerRefundReference: "PAYPAL-RFD-1"
    },
    request: { refund: { status: "processing" } }
  });

  assert.equal(summary.status, "refunded");
  assert.equal(summary.amountPaid, 100);
  assert.equal(summary.amountRefunded, 100);
  assert.equal(summary.refundableBalance, 0);
  assert.equal(summary.paymentStatus, "paid");
  assert.equal(summary.providerRefundReference, "PAYPAL-RFD-1");
  assert.equal(summary.warnings.length, 1);
});

test("admin refund summary treats legacy Pesapal confirmation code as request reference", () => {
  const summary = buildRefundSummaryFromRecords({
    booking: { bookingReference: "ZNZ-PESA-LEGACY", bookingStatus: "cancelled", paymentStatus: "paid", currency: "USD" },
    payments: [
      {
        _id: "payment-pesa-legacy",
        provider: "pesapal",
        status: "paid",
        amountPaid: 1,
        paidAmount: 1,
        currency: "USD",
        confirmationCode: "26607935178085"
      }
    ],
    invoice: { amountPaid: 1, amountRefunded: 0, accountingCurrency: "USD" },
    refund: {
      _id: "refund-pesa-legacy",
      paymentId: "payment-pesa-legacy",
      provider: "pesapal",
      status: "processing",
      amount: 1,
      currency: "USD",
      providerRefundRequestReference: "",
      providerRefundReference: "26607935178085",
      originalTransactionReference: "26607935178085"
    }
  });

  assert.equal(summary.status, "awaiting_merchant_approval");
  assert.equal(summary.providerRefundRequestReference, "26607935178085");
  assert.equal(summary.providerRefundReference, "");
  assert.equal(summary.amountRefunded, 0);
  assert.equal(summary.requiresMerchantApproval, true);
  assert.equal(summary.canVerify, true);
});

test("Pesapal completed transaction verification remains awaiting merchant approval", () => {
  const decision = determinePesapalRefundVerification({
    booking: { bookingReference: "ZNZ-PESA-1", paymentTransactionId: "TRACK-1", currency: "USD" },
    payment: {
      _id: "payment-pesa-1",
      provider: "pesapal",
      status: "paid",
      amountPaid: 1,
      paidAmount: 1,
      currency: "USD",
      orderTrackingId: "TRACK-1",
      merchantReference: "ZNZ-PESA-1"
    },
    refund: {
      amount: 1,
      currency: "USD",
      accountingRefundAmount: mongoose.Types.Decimal128.fromString("1.00"),
      accountingRefundCurrency: "USD",
      requestedRefundCurrency: "USD",
      providerRefundRequestReference: "PESA-CONF-1"
    },
    verification: {
      providerOrderTrackingId: "TRACK-1",
      merchantReference: "ZNZ-PESA-1",
      status: "COMPLETED",
      statusCode: 1,
      amount: 1,
      currency: "USD",
      confirmationCode: "PESA-CONF-1",
      raw: { status_code: 1, payment_status_description: "COMPLETED", amount: 1, currency: "USD" }
    }
  });

  assert.equal(decision.finalizable, false);
  assert.equal(decision.status, "awaiting_merchant_approval");
});

test("Pesapal verification rejects original transaction amount mismatches", () => {
  assert.throws(
    () => determinePesapalRefundVerification({
      booking: { bookingReference: "ZNZ-PESA-AMT", paymentTransactionId: "TRACK-AMT", currency: "USD" },
      payment: {
        _id: "payment-pesa-amt",
        provider: "pesapal",
        status: "paid",
        amountPaid: 1,
        paidAmount: 1,
        currency: "USD",
        orderTrackingId: "TRACK-AMT",
        merchantReference: "ZNZ-PESA-AMT"
      },
      refund: {
        amount: 1,
        currency: "USD",
        accountingRefundAmount: mongoose.Types.Decimal128.fromString("1.00"),
        accountingRefundCurrency: "USD",
        requestedRefundCurrency: "USD"
      },
      verification: {
        providerOrderTrackingId: "TRACK-AMT",
        merchantReference: "ZNZ-PESA-AMT",
        status: "REVERSED",
        statusCode: 3,
        amount: 2643,
        currency: "USD",
        confirmationCode: "PESA-CONF-AMT",
        raw: { status_code: 3, payment_status_description: "REVERSED", amount: 2643, currency: "USD" }
      }
    }),
    (error) => error.code === "PESAPAL_REFUND_AMOUNT_MISMATCH"
  );
});

test("Pesapal full reversal can finalize but partial reversal remains conservative", () => {
  const base = {
    booking: { bookingReference: "ZNZ-PESA-2", paymentTransactionId: "TRACK-2", currency: "USD" },
    payment: {
      _id: "payment-pesa-2",
      provider: "pesapal",
      status: "paid",
      amountPaid: 1,
      paidAmount: 1,
      currency: "USD",
      orderTrackingId: "TRACK-2",
      merchantReference: "ZNZ-PESA-2"
    },
    verification: {
      providerOrderTrackingId: "TRACK-2",
      merchantReference: "ZNZ-PESA-2",
      status: "REVERSED",
      statusCode: 3,
      amount: 1,
      currency: "USD",
      confirmationCode: "PESA-CONF-2",
      raw: { status_code: 3, payment_status_description: "REVERSED", amount: 1, currency: "USD" }
    }
  };

  const full = determinePesapalRefundVerification({
    ...base,
    refund: {
      amount: 1,
      currency: "USD",
      accountingRefundAmount: mongoose.Types.Decimal128.fromString("1.00"),
      accountingRefundCurrency: "USD",
      requestedRefundCurrency: "USD"
    }
  });
  const partial = determinePesapalRefundVerification({
    ...base,
    refund: {
      amount: 0.5,
      currency: "USD",
      accountingRefundAmount: mongoose.Types.Decimal128.fromString("0.50"),
      accountingRefundCurrency: "USD",
      requestedRefundCurrency: "USD"
    }
  });

  assert.equal(full.finalizable, true);
  assert.equal(full.status, "refunded");
  assert.equal(partial.finalizable, false);
  assert.equal(partial.status, "processing");
});

test("Pesapal awaiting merchant approval can be verified without final provider refund reference", () => {
  const summary = buildRefundSummaryFromRecords({
    booking: { bookingReference: "ZNZ-PESA-3", bookingStatus: "cancelled", paymentStatus: "paid", currency: "USD" },
    payments: [
      { _id: "payment-pesa-3", provider: "pesapal", status: "paid", amountPaid: 1, paidAmount: 1, currency: "USD" }
    ],
    invoice: { amountPaid: 1, amountRefunded: 0, accountingCurrency: "USD" },
    refund: {
      _id: "refund-pesa-3",
      paymentId: "payment-pesa-3",
      provider: "pesapal",
      status: "awaiting_merchant_approval",
      amount: 1,
      currency: "USD",
      providerRefundRequestReference: "PESA-CONF-3",
      providerRefundReference: "",
      metadata: {
        providerMessage: "Pesapal accepted the refund request. Merchant confirmation is required before final completion."
      }
    }
  });

  assert.equal(summary.status, "awaiting_merchant_approval");
  assert.equal(summary.amountRefunded, 0);
  assert.equal(summary.confirmedRefundedAmount, 0);
  assert.equal(summary.requiresMerchantApproval, true);
  assert.equal(summary.canVerify, true);
  assert.equal(summary.providerRefundReference, "");
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
