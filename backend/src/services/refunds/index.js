const Payment = require("../../models/Payment");
const Refund = require("../../models/Refund");
const Booking = require("../../models/Booking");
const BookingRequest = require("../../models/BookingRequest");
const AuditLog = require("../../models/AuditLog");
const AppError = require("../../utils/AppError");
const bookingsService = require("../bookings");
const paypalService = require("../payments/paypal");
const pesapalService = require("../payments/pesapal");

const PROVIDER_LABELS = {
  paypal: "PayPal",
  pesapal: "Pesapal",
  dpo: "DPO Pay",
  manual_bank_transfer: "Manual bank transfer",
  cash: "Cash",
  other: "Other"
};

const SUCCESSFUL_PAYMENT_STATUSES = new Set(["paid", "captured", "completed"]);
const FINAL_REFUND_STATUSES = ["refunded", "partially_refunded"];
const REFUNDABLE_PROVIDERS = new Set(["paypal", "pesapal", "dpo"]);

const normalizeProvider = (value = "") => {
  const provider = String(value || "").trim().toLowerCase();
  if (provider === "manual_bank") return "manual_bank_transfer";
  if (provider === "cash_on_arrival") return "cash";
  return provider;
};

const providerLabel = (provider = "") => PROVIDER_LABELS[normalizeProvider(provider)] || "Manual review";

const toMinor = (value = 0) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
};

const fromMinor = (value = 0) => Number((Math.max(0, Number(value) || 0) / 100).toFixed(2));

const normalizeCurrency = (value = "USD") => String(value || "USD").trim().toUpperCase() || "USD";

const maskReference = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= 8) return `${text.slice(0, 2)}***${text.slice(-2)}`;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
};

const extractPaymentAmount = (payment = {}) => fromMinor(toMinor(payment.amountPaid ?? payment.paidAmount ?? 0));

const paymentIdentity = (payment = {}) =>
  [
    payment.provider,
    payment.intentId,
    payment.providerTransactionId,
    payment.orderTrackingId,
    payment._id
  ].map((value) => String(value || "")).filter(Boolean).join(":");

const isSuccessfulPayment = (payment = {}) =>
  SUCCESSFUL_PAYMENT_STATUSES.has(String(payment.status || "").toLowerCase()) &&
  toMinor(payment.amountPaid ?? payment.paidAmount ?? 0) > 0;

const getPaymentResponse = (payment = {}) =>
  payment.rawResponse ||
  payment.providerResponse?.response ||
  payment.providerResponse ||
  {};

const pickNestedString = (source = {}, keys = []) => {
  for (const key of keys) {
    const value = key.split(".").reduce((current, part) => current?.[part], source);
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
};

const extractPaypalCaptureId = (payment = {}) => {
  const response = getPaymentResponse(payment);
  return String(
    payment.providerTransactionId ||
      response.captureId ||
      response.purchase_units?.[0]?.payments?.captures?.[0]?.id ||
      ""
  ).trim();
};

const extractPesapalConfirmationCode = (payment = {}) => {
  const response = getPaymentResponse(payment);
  return pickNestedString(response, [
    "confirmation_code",
    "confirmationCode",
    "payment_confirmation_code",
    "paymentConfirmationCode",
    "processor_confirmation_code",
    "processorConfirmationCode",
    "data.confirmation_code",
    "data.confirmationCode"
  ]);
};

const extractOriginalTransactionReference = (payment = {}) => {
  const provider = normalizeProvider(payment.provider);
  if (provider === "paypal") return extractPaypalCaptureId(payment) || payment.orderTrackingId || "";
  if (provider === "pesapal") return extractPesapalConfirmationCode(payment) || payment.orderTrackingId || payment.providerTransactionId || "";
  return String(payment.providerTransactionId || payment.orderTrackingId || payment.merchantReference || "").trim();
};

const isPesapalMobileMoney = (payment = {}) => {
  const response = getPaymentResponse(payment);
  const method = String(
    response.payment_method ||
      response.paymentMethod ||
      response.payment_account ||
      response.paymentAccount ||
      response.channel ||
      ""
  ).toLowerCase();
  return /mobile|m[-\s]?pesa|tigopesa|tigo|airtel|mixx|yas|wallet/.test(method);
};

const compactError = (error = null) => ({
  code: String(error?.code || "UNKNOWN_REFUND_ERROR"),
  message: String(error?.message || "Refund processing requires verification.").slice(0, 500),
  statusCode: Number(error?.statusCode || error?.details?.statusCode || 0) || null
});

const dedupeSuccessfulPayments = (payments = []) => {
  const byIdentity = new Map();
  payments.filter(isSuccessfulPayment).forEach((payment) => {
    const key = paymentIdentity(payment);
    const existing = byIdentity.get(key);
    if (!existing || toMinor(payment.amountPaid ?? payment.paidAmount ?? 0) > toMinor(existing.amountPaid ?? existing.paidAmount ?? 0)) {
      byIdentity.set(key, payment);
    }
  });
  return Array.from(byIdentity.values());
};

const getConfirmedRefundRows = async (bookingId) =>
  Refund.find({
    bookingId,
    status: { $in: FINAL_REFUND_STATUSES }
  }).lean();

const buildConfirmedRefundMaps = (refunds = []) => {
  const byPaymentId = new Map();
  let totalMinor = 0;
  refunds.forEach((refund) => {
    const amountMinor = toMinor(refund.confirmedRefundedAmount ?? refund.amount);
    totalMinor += amountMinor;
    const paymentKey = String(refund.paymentId || "");
    if (paymentKey) byPaymentId.set(paymentKey, (byPaymentId.get(paymentKey) || 0) + amountMinor);
  });
  return { byPaymentId, totalMinor };
};

const buildRefundContextFromRecords = ({
  booking,
  payments = [],
  confirmedRefunds = [],
  eligibleRefundAmount = null,
  approvedRefundAmount = null
} = {}) => {
  if (!booking?.bookingReference) {
    throw new AppError("Booking is required before calculating a refund.", 400, "BOOKING_REQUIRED");
  }

  const successfulPayments = dedupeSuccessfulPayments(payments);
  const { byPaymentId, totalMinor: previouslyRefundedMinor } = buildConfirmedRefundMaps(confirmedRefunds);
  const currencySet = new Set(successfulPayments.map((payment) => normalizeCurrency(payment.currency)));
  const providerSet = new Set(successfulPayments.map((payment) => normalizeProvider(payment.provider)).filter(Boolean));
  const totalCapturedMinor = successfulPayments.reduce((sum, payment) => sum + toMinor(extractPaymentAmount(payment)), 0);
  const remainingRefundableMinor = Math.max(0, totalCapturedMinor - previouslyRefundedMinor);
  const eligibleMinor = eligibleRefundAmount === null || eligibleRefundAmount === undefined
    ? null
    : Math.min(toMinor(eligibleRefundAmount), remainingRefundableMinor);
  const requestedMinor = approvedRefundAmount === null || approvedRefundAmount === undefined
    ? eligibleMinor
    : toMinor(approvedRefundAmount);
  const currency = currencySet.size === 1
    ? Array.from(currencySet)[0]
    : normalizeCurrency(booking.currency || booking.pricingSnapshot?.currency || "USD");

  const paymentOptions = successfulPayments.map((payment) => {
    const capturedMinor = toMinor(extractPaymentAmount(payment));
    const refundedMinor = byPaymentId.get(String(payment._id || "")) || 0;
    return {
      payment,
      provider: normalizeProvider(payment.provider),
      providerLabel: providerLabel(payment.provider),
      capturedAmount: fromMinor(capturedMinor),
      previouslyRefundedAmount: fromMinor(refundedMinor),
      remainingAmount: fromMinor(Math.max(0, capturedMinor - refundedMinor)),
      remainingMinor: Math.max(0, capturedMinor - refundedMinor),
      currency: normalizeCurrency(payment.currency),
      originalTransactionReference: extractOriginalTransactionReference(payment),
      originalTransactionReferenceMasked: maskReference(extractOriginalTransactionReference(payment))
    };
  });

  const selectedOption =
    paymentOptions.length === 1
      ? paymentOptions[0]
      : paymentOptions.find((option) => requestedMinor !== null && option.remainingMinor >= requestedMinor) || null;
  const providerKnown = providerSet.size === 1 && Boolean(selectedOption?.provider) && REFUNDABLE_PROVIDERS.has(selectedOption.provider);
  const ambiguousProvider = successfulPayments.length === 0 || providerSet.size !== 1 || currencySet.size > 1 || (paymentOptions.length > 1 && !selectedOption);
  let manualReviewReason = "";
  if (!successfulPayments.length) manualReviewReason = "No successful captured payment record was found.";
  else if (currencySet.size > 1) manualReviewReason = "Successful payments use different currencies.";
  else if (providerSet.size > 1) manualReviewReason = "Multiple successful payment providers require manual allocation.";
  else if (paymentOptions.length > 1 && !selectedOption) manualReviewReason = "Multiple successful payments require manual refund allocation.";
  else if (!providerKnown) manualReviewReason = "The original payment provider cannot be refunded automatically.";
  else if (eligibleMinor === null) manualReviewReason = "Eligible refund amount could not be calculated safely.";

  return {
    amountPaid: fromMinor(totalCapturedMinor),
    totalCapturedAmount: fromMinor(totalCapturedMinor),
    previouslyRefundedAmount: fromMinor(previouslyRefundedMinor),
    remainingRefundableAmount: fromMinor(remainingRefundableMinor),
    eligibleRefundAmount: eligibleMinor === null ? null : fromMinor(eligibleMinor),
    defaultApprovedRefundAmount: eligibleMinor === null ? null : fromMinor(eligibleMinor),
    approvedRefundAmount: requestedMinor === null ? null : fromMinor(requestedMinor),
    currency,
    provider: selectedOption?.provider || "",
    providerLabel: selectedOption?.providerLabel || "",
    providerKnown,
    providerReadOnly: providerKnown,
    requiresManualReview: Boolean(ambiguousProvider || !providerKnown || eligibleMinor === null),
    manualReviewReason,
    selectedPaymentId: selectedOption?.payment?._id || null,
    originalTransactionReferenceMasked: selectedOption?.originalTransactionReferenceMasked || "",
    paymentOptions: paymentOptions.map((option) => ({
      paymentId: option.payment._id,
      provider: option.provider,
      providerLabel: option.providerLabel,
      capturedAmount: option.capturedAmount,
      previouslyRefundedAmount: option.previouslyRefundedAmount,
      remainingAmount: option.remainingAmount,
      currency: option.currency,
      originalTransactionReferenceMasked: option.originalTransactionReferenceMasked
    }))
  };
};

const resolveRefundContext = async ({
  booking,
  eligibleRefundAmount = null,
  approvedRefundAmount = null
} = {}) => {
  if (!booking?.bookingReference) {
    throw new AppError("Booking is required before calculating a refund.", 400, "BOOKING_REQUIRED");
  }

  const [payments, confirmedRefunds] = await Promise.all([
    Payment.find({ bookingReference: booking.bookingReference }).sort({ paidAt: -1, updatedAt: -1, createdAt: -1 }).lean(),
    getConfirmedRefundRows(booking._id)
  ]);

  return buildRefundContextFromRecords({
    booking,
    payments,
    confirmedRefunds,
    eligibleRefundAmount,
    approvedRefundAmount
  });
};

const assertRefundAmountAllowed = ({ amount, context }) => {
  const amountMinor = toMinor(amount);
  if (amountMinor <= 0) {
    throw new AppError("Refund amount must be greater than zero.", 422, "REFUND_AMOUNT_REQUIRED");
  }
  if (context.eligibleRefundAmount === null || context.eligibleRefundAmount === undefined) {
    throw new AppError("Eligible refund amount could not be calculated safely.", 422, "REFUND_ELIGIBILITY_REQUIRES_REVIEW");
  }
  if (amountMinor > toMinor(context.eligibleRefundAmount)) {
    throw new AppError("Approved refund exceeds the eligible refund amount.", 422, "REFUND_EXCEEDS_ELIGIBLE_AMOUNT");
  }
  if (amountMinor > toMinor(context.remainingRefundableAmount)) {
    throw new AppError("Approved refund exceeds the remaining refundable amount.", 422, "REFUND_EXCEEDS_REMAINING_AMOUNT");
  }
};

const recordAudit = async ({ action, request, booking, auth = null, requestId = "", reason = "", before = null, after = null, metadata = {} }) =>
  AuditLog.create({
    actorId: auth?.id || null,
    actorRole: auth?.role || "system",
    action,
    entityType: "BookingRequest",
    entityId: request._id.toString(),
    reason,
    requestId,
    before,
    after,
    metadata: { bookingId: booking?._id?.toString() || "", bookingReference: booking?.bookingReference || "", ...metadata }
  });

const syncPaymentRefundedAmount = async (paymentId) => {
  if (!paymentId) return;
  const rows = await Refund.find({ paymentId, status: { $in: FINAL_REFUND_STATUSES } }).lean();
  const totalMinor = rows.reduce((sum, refund) => sum + toMinor(refund.confirmedRefundedAmount ?? refund.amount), 0);
  await Payment.findByIdAndUpdate(paymentId, { $set: { refundedAmount: fromMinor(totalMinor) } });
};

const updateRequestRefundStatus = async ({ request, refund }) => {
  request.refund = {
    ...(request.refund || {}),
    refundId: refund._id,
    status: refund.status,
    requestedAmount: refund.requestedAmount || refund.amount,
    approvedAmount: refund.amount,
    confirmedRefundedAmount: refund.confirmedRefundedAmount || 0,
    provider: refund.provider,
    providerLabel: providerLabel(refund.provider)
  };
  await request.save();
};

const canRepairProviderBeforeProcessing = (currentProvider = "", resolvedProvider = "") => {
  const current = normalizeProvider(currentProvider);
  const resolved = normalizeProvider(resolvedProvider);
  return Boolean(resolved) && (!current || current === "other" || current === "manual_review");
};

const processProviderRefund = async ({ refund, request, booking, payment, auth, traceId, notes = "" }) => {
  const amount = fromMinor(toMinor(refund.amount));
  const currency = normalizeCurrency(refund.currency);
  const provider = normalizeProvider(refund.provider);
  const idempotencyKey = refund.idempotencyKey || `${provider}-${refund.refundReference}`;

  if (provider === "paypal") {
    const captureId = extractPaypalCaptureId(payment);
    if (!captureId) {
      return {
        status: "manual_refund_required",
        providerRefundReference: "",
        confirmedAmount: 0,
        response: { reason: "PayPal capture ID is missing." }
      };
    }
    return paypalService.refundCapturedPayment({
      captureId,
      amount,
      currency,
      idempotencyKey,
      invoiceNumber: refund.refundReference,
      note: notes || refund.reason,
      requestId: traceId
    });
  }

  if (provider === "pesapal") {
    const confirmationCode = extractPesapalConfirmationCode(payment);
    if (!confirmationCode) {
      return {
        status: "manual_refund_required",
        providerRefundReference: "",
        confirmedAmount: 0,
        response: { reason: "Pesapal confirmation code is missing." }
      };
    }
    if (isPesapalMobileMoney(payment) && toMinor(amount) < toMinor(extractPaymentAmount(payment))) {
      return {
        status: "manual_refund_required",
        providerRefundReference: confirmationCode,
        confirmedAmount: 0,
        response: { reason: "Pesapal mobile-money refunds require full refund handling." }
      };
    }
    return pesapalService.requestRefund({
      confirmationCode,
      amount,
      username: auth?.name || auth?.email || auth?.role || "Riser Tours admin",
      remarks: notes || refund.reason,
      requestId: traceId
    });
  }

  return {
    status: "manual_refund_required",
    providerRefundReference: "",
    confirmedAmount: 0,
    response: { reason: "Automatic DPO/manual refund processing is not enabled for this account." }
  };
};

const processRefund = async ({ refundId, auth, traceId = "", notes = "" } = {}) => {
  const refund = await Refund.findById(refundId);
  if (!refund) throw new AppError("Refund not found", 404, "REFUND_NOT_FOUND");
  if (FINAL_REFUND_STATUSES.includes(refund.status)) {
    throw new AppError("This refund has already been completed.", 409, "REFUND_ALREADY_COMPLETED");
  }
  if (refund.status === "processing") {
    throw new AppError("This refund is already processing.", 409, "REFUND_ALREADY_PROCESSING");
  }
  if (refund.status !== "approved") {
    throw new AppError("Refund must be approved before processing.", 409, "REFUND_NOT_APPROVED");
  }

  const request = await BookingRequest.findById(refund.bookingRequestId);
  const booking = await Booking.findById(refund.bookingId);
  if (!request || !booking) throw new AppError("Refund booking context is missing.", 404, "REFUND_CONTEXT_NOT_FOUND");
  if (request.bokunSync?.status !== "synced" || booking.bookingStatus !== "cancelled") {
    throw new AppError("Bokun cancellation must be confirmed before processing a refund.", 409, "BOKUN_CANCELLATION_NOT_CONFIRMED");
  }

  const locked = await Refund.findOneAndUpdate(
    { _id: refund._id, status: refund.status },
    {
      $set: {
        status: "processing",
        processingStartedAt: new Date(),
        processedBy: auth?.id || null,
        idempotencyKey: refund.idempotencyKey || `${normalizeProvider(refund.provider)}-${refund.refundReference}`,
        "metadata.processingStartedBy": auth?.id || "",
        "metadata.processingRequestId": traceId
      }
    },
    { new: true }
  );
  if (!locked) throw new AppError("This refund changed while processing. Refresh and try again.", 409, "REFUND_STATE_CHANGED");

  const before = { status: refund.status, confirmedRefundedAmount: refund.confirmedRefundedAmount || 0 };
  try {
    const context = await resolveRefundContext({
      booking,
      eligibleRefundAmount: refund.eligibleRefundAmount ?? request.refund?.eligibleAmount ?? request.refund?.estimatedAmount,
      approvedRefundAmount: refund.amount
    });
    assertRefundAmountAllowed({ amount: refund.amount, context });
    if (context.providerKnown && context.selectedPaymentId && canRepairProviderBeforeProcessing(locked.provider, context.provider)) {
      locked.provider = context.provider;
      locked.paymentId = context.selectedPaymentId;
      locked.idempotencyKey = `${context.provider}-${locked.refundReference}`;
    }
    if (!context.providerKnown || normalizeProvider(locked.provider) !== context.provider) {
      locked.status = "manual_refund_required";
      locked.providerResponseSnapshot = { reason: context.manualReviewReason || "Original payment provider could not be verified." };
      locked.metadata = { ...(locked.metadata || {}), processing: false };
      await locked.save();
      await updateRequestRefundStatus({ request, refund: locked });
      await recordAudit({ action: "booking_request_refund_manual_required", request, booking, auth, requestId: traceId, before, after: { status: locked.status }, metadata: { refundReference: locked.refundReference, reason: context.manualReviewReason } });
      return locked;
    }

    const payment = await Payment.findById(context.selectedPaymentId);
    locked.originalTransactionReference = extractOriginalTransactionReference(payment || {});
    const result = await processProviderRefund({ refund: locked, request, booking, payment, auth, traceId, notes });
    const providerStatus = String(result.status || "").toLowerCase();
    const confirmedAmount = fromMinor(toMinor(result.confirmedAmount || 0));

    if (providerStatus === "completed") {
      const totalAfterMinor = toMinor(context.previouslyRefundedAmount) + toMinor(confirmedAmount);
      locked.status = totalAfterMinor >= toMinor(context.totalCapturedAmount) ? "refunded" : "partially_refunded";
      locked.confirmedRefundedAmount = confirmedAmount;
      locked.completedAt = new Date();
    } else if (providerStatus === "processing" || providerStatus === "pending" || providerStatus === "accepted") {
      locked.status = "processing";
      locked.confirmedRefundedAmount = 0;
    } else if (providerStatus === "manual_refund_required") {
      locked.status = "manual_refund_required";
      locked.confirmedRefundedAmount = 0;
    } else if (providerStatus === "verification_required") {
      locked.status = "verification_required";
      locked.confirmedRefundedAmount = 0;
    } else {
      locked.status = "failed";
      locked.confirmedRefundedAmount = 0;
      locked.failedAt = new Date();
      locked.failureReason = "The payment provider did not accept the refund request.";
    }

    locked.providerRefundReference = String(result.providerRefundReference || locked.providerRefundReference || "").trim();
    locked.providerRequestSnapshot = result.request || locked.providerRequestSnapshot;
    locked.providerResponseSnapshot = result.response || result.raw || result;
    locked.metadata = { ...(locked.metadata || {}), processing: false, providerStatus: result.status || "" };
    await locked.save();
    await syncPaymentRefundedAmount(locked.paymentId);
    await updateRequestRefundStatus({ request, refund: locked });
    await bookingsService.syncInvoiceForBookingReference({ bookingReference: booking.bookingReference, requestId: traceId, reason: "Refund processing updated" });
    await recordAudit({ action: "booking_request_refund_processed", request, booking, auth, requestId: traceId, before, after: { status: locked.status, confirmedRefundedAmount: locked.confirmedRefundedAmount }, metadata: { refundReference: locked.refundReference, provider: locked.provider, providerRefundReference: maskReference(locked.providerRefundReference) } });
    return locked;
  } catch (error) {
    locked.status = "verification_required";
    locked.confirmedRefundedAmount = 0;
    locked.failureReason = "Refund result requires verification before retry.";
    locked.providerResponseSnapshot = { error: compactError(error) };
    locked.metadata = { ...(locked.metadata || {}), processing: false };
    await locked.save();
    await updateRequestRefundStatus({ request, refund: locked });
    await bookingsService.syncInvoiceForBookingReference({ bookingReference: booking.bookingReference, requestId: traceId, reason: "Refund verification required" });
    await recordAudit({ action: "booking_request_refund_verification_required", request, booking, auth, requestId: traceId, before, after: { status: locked.status }, metadata: { refundReference: locked.refundReference, error: compactError(error) } });
    return locked;
  }
};

module.exports = {
  FINAL_REFUND_STATUSES,
  assertRefundAmountAllowed,
  extractOriginalTransactionReference,
  fromMinor,
  maskReference,
  normalizeProvider,
  processRefund,
  providerLabel,
  resolveRefundContext,
  toMinor,
  __testables: {
    buildRefundContextFromRecords,
    canRepairProviderBeforeProcessing,
    dedupeSuccessfulPayments,
    extractPaypalCaptureId,
    extractPesapalConfirmationCode,
    isSuccessfulPayment,
    isPesapalMobileMoney,
    maskReference,
    toMinor,
    fromMinor
  }
};
