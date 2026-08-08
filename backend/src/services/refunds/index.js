const Payment = require("../../models/Payment");
const Refund = require("../../models/Refund");
const Booking = require("../../models/Booking");
const BookingRequest = require("../../models/BookingRequest");
const AuditLog = require("../../models/AuditLog");
const AppError = require("../../utils/AppError");
const bookingsService = require("../bookings");
const paymentsService = require("../payments");
const paypalService = require("../payments/paypal");
const pesapalService = require("../payments/pesapal");
const {
  normalizePesapalStatus,
  resolvePesapalPaymentState,
  resolveMerchantReference,
  resolveOrderTrackingId
} = require("../../integrations/pesapal/pesapal.utils");
const {
  Decimal,
  compare,
  decimalOrNull,
  decimalString,
  decimalToApi,
  divide,
  multiply,
  normalizeCurrency,
  toDecimal
} = require("../../utils/money");

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
const FINAL_PROVIDER_REFUND_STATUSES = new Set(["completed", "refunded", "partially_refunded"]);
const PESAPAL_ACCEPTED_REFUND_STATUSES = new Set(["awaiting_merchant_approval", "accepted", "processing", "pending"]);
const PENDING_PROVIDER_REFUND_STATUSES = new Set(["awaiting_merchant_approval", "processing", "pending", "accepted"]);
const FAILED_PROVIDER_REFUND_STATUSES = new Set(["failed", "cancelled", "canceled", "denied"]);
const INTERMEDIATE_REFUND_STATUSES = ["requested", "approved", "awaiting_merchant_approval", "processing", "verification_required"];
const RECONCILABLE_REFUND_STATUSES = ["approved", "awaiting_merchant_approval", "processing", "verification_required"];

const normalizeProvider = (value = "") => {
  const provider = String(value || "").trim().toLowerCase();
  if (provider === "manual_bank") return "manual_bank_transfer";
  if (provider === "cash_on_arrival") return "cash";
  return provider;
};

const providerLabel = (provider = "") => PROVIDER_LABELS[normalizeProvider(provider)] || "Manual review";

const toMinor = (value = 0) => Number(toDecimal(value).times(100).toDecimalPlaces(0).toFixed(0));

const fromMinor = (value = 0) => Number((Math.max(0, Number(value) || 0) / 100).toFixed(2));

const maskReference = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= 8) return `${text.slice(0, 2)}***${text.slice(-2)}`;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
};

const isFinalRefundStatus = (status = "") => FINAL_REFUND_STATUSES.includes(String(status || "").toLowerCase());

const normalizeProviderRefundReferences = ({ provider = "", status = "", refund = null, payment = null } = {}) => {
  const normalizedProvider = normalizeProvider(provider || refund?.provider || payment?.provider || "");
  const requestReference = String(refund?.providerRefundRequestReference || "").trim();
  const finalReference = String(refund?.providerRefundReference || "").trim();
  if (normalizedProvider !== "pesapal" || !finalReference || requestReference) {
    return {
      providerRefundRequestReference: requestReference,
      providerRefundReference: finalReference
    };
  }

  const originalReference = String(refund?.originalTransactionReference || "").trim();
  const confirmationCode = String(payment?.confirmationCode || "").trim();
  const looksLikeRequestReference =
    !isFinalRefundStatus(status) ||
    (confirmationCode && finalReference === confirmationCode) ||
    (originalReference && finalReference === originalReference);

  return {
    providerRefundRequestReference: looksLikeRequestReference ? finalReference : "",
    providerRefundReference: looksLikeRequestReference ? "" : finalReference
  };
};

const isCanonicalPayment = (payment = {}) =>
  payment?.orderAmount !== null && payment?.orderAmount !== undefined && Boolean(payment?.orderCurrency);

const extractPaymentAmountString = (payment = {}) =>
  isCanonicalPayment(payment)
    ? decimalToApi(payment.accountingAmount, "0")
    : decimalString(payment.amountPaid ?? payment.paidAmount ?? 0);

const extractPaymentAmount = (payment = {}) => Number(toDecimal(extractPaymentAmountString(payment)).toFixed(2));

const extractPaymentCurrency = (payment = {}) =>
  normalizeCurrency(isCanonicalPayment(payment) ? payment.accountingCurrency : payment.currency);

const extractChargedAmountString = (payment = {}) =>
  decimalToApi(payment.chargedAmount) || extractPaymentAmountString(payment);

const extractChargedCurrency = (payment = {}) =>
  normalizeCurrency(payment.chargedCurrency || payment.currency);

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
  (!isCanonicalPayment(payment) || (
    payment.verificationStatus === "verified" && payment.accountingAllocationStatus === "applied"
  )) &&
  toDecimal(extractPaymentAmountString(payment)).greaterThan(0);

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
    payment.paypalCaptureId ||
      payment.providerTransactionId ||
      response.captureId ||
      response.purchase_units?.[0]?.payments?.captures?.[0]?.id ||
      ""
  ).trim();
};

const extractPesapalConfirmationCode = (payment = {}) => {
  if (payment.confirmationCode) return String(payment.confirmationCode).trim();
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

const extractPesapalOrderTrackingId = ({ booking = {}, payment = {}, refund = {} } = {}) =>
  String(
    refund.originalProviderTransactionId ||
      payment.orderTrackingId ||
      payment.providerTransactionId ||
      booking.paymentTransactionId ||
      booking.dpoTransactionToken ||
      ""
  ).trim();

const extractPesapalMerchantReference = ({ booking = {}, payment = {}, verification = {} } = {}) =>
  String(
    payment.merchantReference ||
      booking.pendingCheckout?.pesapalMerchantReference ||
      verification.merchantReference ||
      buildPesapalBookingReferenceFallback(booking) ||
      ""
  ).trim();

const buildPesapalBookingReferenceFallback = (booking = {}) =>
  String(booking.bookingReference || "").trim();

const extractOriginalTransactionReference = (payment = {}) => {
  const provider = normalizeProvider(payment.provider);
  if (provider === "paypal") return extractPaypalCaptureId(payment) || payment.orderTrackingId || "";
  if (provider === "pesapal") return extractPesapalConfirmationCode(payment) || payment.orderTrackingId || payment.providerTransactionId || "";
  return String(payment.providerTransactionId || payment.orderTrackingId || payment.merchantReference || "").trim();
};

const isPesapalMobileMoney = (payment = {}) => {
  const response = getPaymentResponse(payment);
  const method = String(
    payment.paymentMethod ||
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

const safeProviderSnapshot = (value) => paymentsService.sanitizeProviderPayload(value || {});

const refundStatusFromTotals = ({ totalRefunded = 0, amountPaid = 0 } = {}) => {
  const refunded = toDecimal(totalRefunded);
  const paid = toDecimal(amountPaid);
  if (!refunded.greaterThan(0)) return "not_required";
  return refunded.greaterThanOrEqualTo(paid) && paid.greaterThan(0)
    ? "refunded"
    : "partially_refunded";
};

const sumSuccessfulRefunds = async ({ bookingId = null, paymentId = null, excludeRefundId = null } = {}) => {
  const query = { status: { $in: FINAL_REFUND_STATUSES } };
  if (paymentId) query.paymentId = paymentId;
  else if (bookingId) query.bookingId = bookingId;
  else return "0";
  if (excludeRefundId) query._id = { $ne: excludeRefundId };

  const rows = await Refund.find(query).lean();
  return rows
    .reduce((sum, refund) => {
      const amount =
        decimalToApi(refund.confirmedAccountingRefundedAmount) ||
        decimalString(refund.confirmedRefundedAmount ?? refund.amount ?? 0);
      return sum.plus(toDecimal(amount));
    }, new Decimal(0))
    .toFixed();
};

const assertProviderRefundReferenceAvailable = async ({
  provider = "",
  providerRefundReference = "",
  refundId = null
} = {}) => {
  const reference = String(providerRefundReference || "").trim();
  if (!reference) return;
  const query = {
    provider: normalizeProvider(provider),
    providerRefundReference: reference
  };
  if (refundId) query._id = { $ne: refundId };
  const duplicate = await Refund.findOne(query).select("_id refundReference").lean();
  if (duplicate) {
    throw new AppError(
      "Provider refund reference is already linked to another refund.",
      409,
      "PROVIDER_REFUND_REFERENCE_DUPLICATE",
      {
        refundId: String(duplicate._id),
        refundReference: duplicate.refundReference
      }
    );
  }
};

const normalizeRefundResult = ({ booking, payment, refund, totalRefunded = 0, currency = "" } = {}) => {
  const amountPaid = Number(toDecimal(payment ? extractPaymentAmountString(payment) : 0).toFixed(2));
  const amountRefunded = Number(toDecimal(totalRefunded).toFixed(2));
  const workflowStatus = refund?.status || refundStatusFromTotals({ totalRefunded, amountPaid });
  const provider = normalizeProvider(refund?.provider || payment?.provider || "");
  const providerReferences = normalizeProviderRefundReferences({ provider, status: workflowStatus, refund, payment });
  const normalizedStatus =
    provider === "pesapal" &&
    workflowStatus === "processing" &&
    amountRefunded <= 0 &&
    providerReferences.providerRefundRequestReference &&
    !providerReferences.providerRefundReference
      ? "awaiting_merchant_approval"
      : workflowStatus;
  return {
    status: normalizedStatus === "not_required" ? "not_requested" : normalizedStatus,
    amountPaid,
    requestedAmount: Number(toDecimal(refund?.amount || 0).toFixed(2)),
    amountRefunded,
    confirmedRefundedAmount: amountRefunded,
    refundableBalance: Number(Decimal.max(0, toDecimal(amountPaid).minus(toDecimal(amountRefunded))).toFixed(2)),
    currency: normalizeCurrency(currency || refund?.accountingRefundCurrency || refund?.currency || extractPaymentCurrency(payment || {}) || booking?.currency || "USD"),
    provider,
    providerRefundRequestReference: providerReferences.providerRefundRequestReference,
    providerRefundReference: providerReferences.providerRefundReference,
    refundedAt: refund?.completedAt || payment?.refundedAt || null,
    lastVerifiedAt: refund?.lastRefundSyncAt || null,
    requiresMerchantApproval: normalizeProvider(refund?.provider || payment?.provider || "") === "pesapal" &&
      ["awaiting_merchant_approval", "processing", "verification_required"].includes(String(normalizedStatus || "")),
    canVerify: Boolean(refund?._id) && (
      normalizeProvider(refund?.provider || payment?.provider || "") === "pesapal" ||
      Boolean(refund?.providerRefundReference)
    ) && !FINAL_REFUND_STATUSES.includes(String(normalizedStatus || "")),
    providerMessage: refund?.metadata?.providerMessage || "",
    bookingStatus: booking?.bookingStatus || "",
    paymentStatus: payment?.status || payment?.paymentStatus || "",
    refundReference: refund?.refundReference || "",
    refundId: refund?._id || null
  };
};

const buildRefundSummaryFromRecords = ({ booking, payments = [], invoice = null, refund = null, refundContext = null, request = null } = {}) => {
  const refundRecord = refund?.toObject ? refund.toObject() : refund;
  const successfulPayments = dedupeSuccessfulPayments(payments || []);
  const payment =
    successfulPayments.find((row) => String(row._id || "") === String(refundRecord?.paymentId || "")) ||
    successfulPayments[0] ||
    null;
  const amountPaid = Number(toDecimal(
    payment
      ? extractPaymentAmountString(payment)
      : refundContext?.amountPaid ?? invoice?.amountPaid ?? booking?.invoiceSnapshot?.amountPaid ?? 0
  ).toFixed(2));
  const confirmedAmount = FINAL_REFUND_STATUSES.includes(String(refundRecord?.status || "").toLowerCase())
    ? refundRecord?.confirmedAccountingRefundedAmount
      ? decimalToApi(refundRecord.confirmedAccountingRefundedAmount)
      : refundRecord?.confirmedRefundedAmount ?? refundRecord?.amount ?? 0
    : 0;
  const amountRefunded = Number(toDecimal(
    refundContext?.previouslyRefundedAmount ??
      invoice?.amountRefunded ??
      booking?.amountRefunded ??
      confirmedAmount
  ).toFixed(2));
  const provider = normalizeProvider(refundRecord?.provider || payment?.provider || request?.refund?.provider || "");
  const workflowStatus = refundRecord?.status || request?.refund?.status || booking?.refundStatus || "not_requested";
  const providerReferences = normalizeProviderRefundReferences({ provider, status: workflowStatus, refund: refundRecord, payment });
  const accountingStatus = amountRefunded > 0
    ? refundStatusFromTotals({ totalRefunded: amountRefunded, amountPaid })
    : workflowStatus;
  const normalizedAccountingStatus =
    provider === "pesapal" &&
    accountingStatus === "processing" &&
    amountRefunded <= 0 &&
    providerReferences.providerRefundRequestReference &&
    !providerReferences.providerRefundReference
      ? "awaiting_merchant_approval"
      : accountingStatus;
  const status = normalizedAccountingStatus === "not_required" ? "not_requested" : normalizedAccountingStatus;
  const warnings = [];
  const bookingRefundStatus = String(booking?.refundStatus || "").trim();
  if (bookingRefundStatus && bookingRefundStatus !== "not_requested" && bookingRefundStatus !== status) {
    warnings.push({
      code: "BOOKING_REFUND_STATUS_MISMATCH",
      bookingRefundStatus,
      accountingRefundStatus: status
    });
  }
  return {
    status,
    amountPaid,
    requestedAmount: Number(toDecimal(refundRecord?.amount ?? request?.refund?.approvedAmount ?? 0).toFixed(2)),
    amountRefunded,
    confirmedRefundedAmount: amountRefunded,
    refundableBalance: Number(Decimal.max(0, toDecimal(amountPaid).minus(toDecimal(amountRefunded))).toFixed(2)),
    currency: normalizeCurrency(
      refundRecord?.accountingRefundCurrency ||
        refundRecord?.currency ||
        payment?.accountingCurrency ||
        payment?.currency ||
        refundContext?.currency ||
        invoice?.accountingCurrency ||
        booking?.currency ||
        "USD"
    ),
    provider,
    providerRefundRequestReference: providerReferences.providerRefundRequestReference,
    providerRefundReference: providerReferences.providerRefundReference,
    refundedAt: refundRecord?.completedAt || payment?.refundedAt || booking?.refundedAt || null,
    lastVerifiedAt: refundRecord?.lastRefundSyncAt || null,
    requiresMerchantApproval: provider === "pesapal" &&
      ["awaiting_merchant_approval", "processing", "verification_required"].includes(String(status || "")),
    canVerify: Boolean(refundRecord?._id) && (
      provider === "pesapal" ||
      Boolean(providerReferences.providerRefundReference)
    ) && !FINAL_REFUND_STATUSES.includes(String(status || "")),
    providerMessage: refundRecord?.metadata?.providerMessage ||
      (provider === "pesapal" && status === "awaiting_merchant_approval"
        ? "Pesapal accepted the refund request. Merchant confirmation is required before final completion."
        : ""),
    paymentStatus: payment?.status || booking?.paymentStatus || "",
    bookingStatus: booking?.bookingStatus || "",
    refundReference: refundRecord?.refundReference || "",
    refundId: refundRecord?._id || null,
    warnings
  };
};

const dedupeSuccessfulPayments = (payments = []) => {
  const byIdentity = new Map();
  payments.filter(isSuccessfulPayment).forEach((payment) => {
    const key = paymentIdentity(payment);
    const existing = byIdentity.get(key);
    if (!existing || compare(extractPaymentAmountString(payment), extractPaymentAmountString(existing)) > 0) {
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
  const providerByPaymentId = new Map();
  let total = new Decimal(0);
  refunds.forEach((refund) => {
    const amount = decimalToApi(refund.confirmedAccountingRefundedAmount) || decimalString(refund.confirmedRefundedAmount ?? refund.amount ?? 0);
    total = total.plus(toDecimal(amount));
    const paymentKey = String(refund.paymentId || "");
    if (paymentKey) {
      byPaymentId.set(paymentKey, toDecimal(byPaymentId.get(paymentKey) || 0).plus(toDecimal(amount)).toFixed());
      const providerAmount = decimalToApi(refund.confirmedProviderRefundedAmount, "0");
      providerByPaymentId.set(
        paymentKey,
        toDecimal(providerByPaymentId.get(paymentKey) || 0).plus(toDecimal(providerAmount)).toFixed()
      );
    }
  });
  return { byPaymentId, providerByPaymentId, total: total.toFixed() };
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
  const { byPaymentId, providerByPaymentId, total: previouslyRefunded } = buildConfirmedRefundMaps(confirmedRefunds);
  const currencySet = new Set(successfulPayments.map(extractPaymentCurrency).filter(Boolean));
  const providerSet = new Set(successfulPayments.map((payment) => normalizeProvider(payment.provider)).filter(Boolean));
  const totalCaptured = successfulPayments.reduce(
    (sum, payment) => sum.plus(toDecimal(extractPaymentAmountString(payment))),
    new Decimal(0)
  );
  const remainingRefundable = Decimal.max(0, totalCaptured.minus(toDecimal(previouslyRefunded)));
  const eligible = eligibleRefundAmount === null || eligibleRefundAmount === undefined
    ? null
    : Decimal.min(toDecimal(eligibleRefundAmount), remainingRefundable);
  const requested = approvedRefundAmount === null || approvedRefundAmount === undefined
    ? eligible
    : toDecimal(approvedRefundAmount);
  const currency = currencySet.size === 1
    ? Array.from(currencySet)[0]
    : normalizeCurrency(booking.currency || booking.pricingSnapshot?.currency || "USD");

  const paymentOptions = successfulPayments.map((payment) => {
    const captured = toDecimal(extractPaymentAmountString(payment));
    const refunded = toDecimal(byPaymentId.get(String(payment._id || "")) || 0);
    const remaining = Decimal.max(0, captured.minus(refunded));
    const charged = toDecimal(extractChargedAmountString(payment));
    const chargedRefunded = toDecimal(providerByPaymentId.get(String(payment._id || "")) || 0);
    const chargedRemaining = Decimal.max(0, charged.minus(chargedRefunded));
    return {
      payment,
      provider: normalizeProvider(payment.provider),
      providerLabel: providerLabel(payment.provider),
      capturedAmount: Number(captured.toFixed(2)),
      capturedAmountDecimal: captured.toFixed(),
      previouslyRefundedAmount: Number(refunded.toFixed(2)),
      remainingAmount: Number(remaining.toFixed(2)),
      remainingAmountDecimal: remaining.toFixed(),
      currency: extractPaymentCurrency(payment),
      chargedAmount: charged.toFixed(),
      chargedCurrency: extractChargedCurrency(payment),
      chargedRemainingAmount: chargedRemaining.toFixed(),
      fxRate: decimalToApi(payment.fxRate) || (extractChargedCurrency(payment) !== extractPaymentCurrency(payment)
        ? divide(charged.toFixed(), captured.toFixed())
        : null),
      originalTransactionReference: extractOriginalTransactionReference(payment),
      originalTransactionReferenceMasked: maskReference(extractOriginalTransactionReference(payment))
    };
  });

  const selectedOption =
    paymentOptions.length === 1
      ? paymentOptions[0]
      : paymentOptions.find((option) => requested !== null && toDecimal(option.remainingAmountDecimal).greaterThanOrEqualTo(requested)) || null;
  const providerKnown = providerSet.size === 1 && Boolean(selectedOption?.provider) && REFUNDABLE_PROVIDERS.has(selectedOption.provider);
  const ambiguousProvider = successfulPayments.length === 0 || providerSet.size !== 1 || currencySet.size > 1 || (paymentOptions.length > 1 && !selectedOption);
  let manualReviewReason = "";
  if (!successfulPayments.length) manualReviewReason = "No successful captured payment record was found.";
  else if (currencySet.size > 1) manualReviewReason = "Successful payments use different currencies.";
  else if (providerSet.size > 1) manualReviewReason = "Multiple successful payment providers require manual allocation.";
  else if (paymentOptions.length > 1 && !selectedOption) manualReviewReason = "Multiple successful payments require manual refund allocation.";
  else if (!providerKnown) manualReviewReason = "The original payment provider cannot be refunded automatically.";
  else if (eligible === null) manualReviewReason = "Eligible refund amount could not be calculated safely.";

  let providerRefundAmount = null;
  let providerRefundCurrency = selectedOption?.chargedCurrency || "";
  if (selectedOption && requested !== null && requested.greaterThan(0)) {
    const remainingAccounting = toDecimal(selectedOption.remainingAmountDecimal);
    const remainingCharged = toDecimal(selectedOption.chargedRemainingAmount);
    providerRefundAmount = requested.greaterThanOrEqualTo(remainingAccounting)
      ? remainingCharged.toFixed()
      : selectedOption.fxRate
        ? toDecimal(multiply(requested.toFixed(), selectedOption.fxRate)).toDecimalPlaces(2).toFixed()
        : requested.toDecimalPlaces(2).toFixed();
  }

  return {
    amountPaid: Number(totalCaptured.toFixed(2)),
    totalCapturedAmount: Number(totalCaptured.toFixed(2)),
    previouslyRefundedAmount: Number(toDecimal(previouslyRefunded).toFixed(2)),
    remainingRefundableAmount: Number(remainingRefundable.toFixed(2)),
    eligibleRefundAmount: eligible === null ? null : Number(eligible.toFixed(2)),
    defaultApprovedRefundAmount: eligible === null ? null : Number(eligible.toFixed(2)),
    approvedRefundAmount: requested === null ? null : Number(requested.toFixed(2)),
    providerRefundAmount,
    providerRefundCurrency,
    originalChargedAmount: selectedOption?.chargedAmount || null,
    originalChargedCurrency: selectedOption?.chargedCurrency || "",
    historicalFxRate: selectedOption?.fxRate || null,
    currency,
    provider: selectedOption?.provider || "",
    providerLabel: selectedOption?.providerLabel || "",
    providerKnown,
    providerReadOnly: providerKnown,
    requiresManualReview: Boolean(ambiguousProvider || !providerKnown || eligible === null),
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
      chargedAmount: option.chargedAmount,
      chargedCurrency: option.chargedCurrency,
      fxRate: option.fxRate,
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
  const requested = toDecimal(amount);
  if (!requested.greaterThan(0)) {
    throw new AppError("Refund amount must be greater than zero.", 422, "REFUND_AMOUNT_REQUIRED");
  }
  if (context.eligibleRefundAmount === null || context.eligibleRefundAmount === undefined) {
    throw new AppError("Eligible refund amount could not be calculated safely.", 422, "REFUND_ELIGIBILITY_REQUIRES_REVIEW");
  }
  if (requested.greaterThan(toDecimal(context.eligibleRefundAmount))) {
    throw new AppError("Approved refund exceeds the eligible refund amount.", 422, "REFUND_EXCEEDS_ELIGIBLE_AMOUNT");
  }
  if (requested.greaterThan(toDecimal(context.remainingRefundableAmount))) {
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
  const [rows, pendingRows] = await Promise.all([
    Refund.find({ paymentId, status: { $in: FINAL_REFUND_STATUSES } }).lean(),
    Refund.find({ paymentId, status: { $in: INTERMEDIATE_REFUND_STATUSES } }).select("_id").lean()
  ]);
  const totalMinor = rows.reduce((sum, refund) => sum + toMinor(refund.confirmedRefundedAmount ?? refund.amount), 0);
  const payment = await Payment.findById(paymentId).lean();
  const accountingAmount = payment ? toDecimal(extractPaymentAmountString(payment)) : new Decimal(0);
  const refunded = toDecimal(fromMinor(totalMinor));
  const refundStatus = refunded.greaterThanOrEqualTo(accountingAmount) && accountingAmount.greaterThan(0)
    ? "refunded"
    : refunded.greaterThan(0)
      ? "partially_refunded"
      : pendingRows.length
        ? "processing"
        : "not_required";
  await Payment.findByIdAndUpdate(paymentId, {
    $set: {
      refundedAmount: Number(refunded.toFixed(2)),
      refundStatus,
      refundedAt: refundStatus === "refunded" ? new Date() : payment?.refundedAt || null
    }
  });
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
    providerLabel: providerLabel(refund.provider),
    providerRefundRequestReference: refund.providerRefundRequestReference || "",
    providerRefundReference: refund.providerRefundReference || ""
  };
  await request.save();
};

const finalizeSuccessfulRefund = async ({
  bookingId = null,
  paymentId = null,
  refundId = null,
  refundAmount = undefined,
  refundCurrency = "",
  provider = "",
  providerRefundRequestReference = "",
  providerRefundReference = "",
  providerTransactionId = "",
  refundedAt = null,
  rawProviderResponse = null,
  auth = null,
  requestId = "",
  source = "refund_finalization",
  reason = "Provider confirmed refund completion",
  markBookingCancelled = false
} = {}) => {
  const refund = refundId
    ? await Refund.findById(refundId)
    : providerRefundReference
      ? await Refund.findOne({ providerRefundReference: String(providerRefundReference).trim() })
      : null;

  if (!refund) {
    throw new AppError("Refund record is required before successful refund finalization.", 404, "REFUND_NOT_FOUND");
  }

  const booking = bookingId
    ? await Booking.findById(bookingId)
    : await Booking.findById(refund.bookingId);
  if (!booking) {
    throw new AppError("Refund booking context is missing.", 404, "REFUND_CONTEXT_NOT_FOUND");
  }

  const request = refund.bookingRequestId
    ? await BookingRequest.findById(refund.bookingRequestId)
    : await BookingRequest.findOne({ booking: booking._id, type: "cancel_booking" }).sort({ createdAt: -1 });

  const payment = paymentId
    ? await Payment.findById(paymentId)
    : refund.paymentId
      ? await Payment.findById(refund.paymentId)
      : await Payment.findOne({ bookingReference: booking.bookingReference, status: "paid" }).sort({ paidAt: -1, updatedAt: -1, createdAt: -1 });
  if (!payment) {
    throw new AppError("Successful payment record is required before finalizing a refund.", 409, "REFUND_PAYMENT_NOT_FOUND");
  }
  if (!isSuccessfulPayment(payment)) {
    throw new AppError("Refund can only be finalized against a verified paid payment.", 409, "REFUND_PAYMENT_NOT_VERIFIED");
  }

  const normalizedProvider = normalizeProvider(provider || refund.provider || payment.provider);
  const reference = String(providerRefundReference || refund.providerRefundReference || "").trim();
  const requestReference = String(
    providerRefundRequestReference ||
      refund.providerRefundRequestReference ||
      (normalizedProvider === "pesapal" ? refund.originalTransactionReference || extractPesapalConfirmationCode(payment) : "") ||
      ""
  ).trim();
  const pesapalEvidenceReference = String(
    providerTransactionId ||
      refund.originalProviderTransactionId ||
      extractPesapalOrderTrackingId({ booking, payment, refund }) ||
      requestReference ||
      ""
  ).trim();
  if (!reference && normalizedProvider !== "pesapal") {
    throw new AppError("Provider refund reference is required before marking a refund as completed.", 422, "PROVIDER_REFUND_REFERENCE_REQUIRED");
  }
  if (!reference && normalizedProvider === "pesapal" && !pesapalEvidenceReference) {
    throw new AppError(
      "Pesapal refund completion requires provider transaction evidence before finalization.",
      422,
      "PESAPAL_REFUND_EVIDENCE_REQUIRED"
    );
  }
  if (reference) {
    await assertProviderRefundReferenceAvailable({
      provider: normalizedProvider,
      providerRefundReference: reference,
      refundId: refund._id
    });
  }

  const accountingCurrency = normalizeCurrency(
    refundCurrency ||
      refund.accountingRefundCurrency ||
      refund.currency ||
      extractPaymentCurrency(payment)
  );
  const paymentCurrency = extractPaymentCurrency(payment);
  if (!accountingCurrency || accountingCurrency !== paymentCurrency) {
    throw new AppError(
      "Refund currency does not match the paid accounting currency.",
      409,
      "REFUND_CURRENCY_MISMATCH",
      { refundCurrency: accountingCurrency, paymentCurrency }
    );
  }

  const requestedAmount =
    refundAmount !== undefined && refundAmount !== null && refundAmount !== ""
      ? decimalString(refundAmount)
      : decimalToApi(refund.accountingRefundAmount) || decimalString(refund.amount || 0);
  if (!toDecimal(requestedAmount).greaterThan(0)) {
    throw new AppError("Confirmed refund amount must be greater than zero.", 422, "REFUND_AMOUNT_REQUIRED");
  }

  const amountPaid = decimalString(extractPaymentAmountString(payment));
  const previousRefunded = await sumSuccessfulRefunds({
    paymentId: payment._id,
    bookingId: booking._id,
    excludeRefundId: refund._id
  });
  const totalRefunded = toDecimal(previousRefunded).plus(toDecimal(requestedAmount)).toFixed();
  if (toDecimal(totalRefunded).greaterThan(toDecimal(amountPaid).plus(0.009))) {
    throw new AppError(
      "Completed refunds cannot exceed the verified amount paid.",
      422,
      "REFUND_EXCEEDS_PAID_AMOUNT",
      { amountPaid, totalRefunded }
    );
  }

  const finalStatus = refundStatusFromTotals({ totalRefunded, amountPaid });
  const completedAt = refundedAt ? new Date(refundedAt) : (refund.completedAt || new Date());
  const before = {
    refundStatus: refund.status,
    confirmedRefundedAmount: refund.confirmedRefundedAmount || 0,
    paymentRefundStatus: payment.refundStatus || "",
    paymentRefundedAmount: payment.refundedAmount || 0,
    bookingStatus: booking.bookingStatus
  };

  const providerReferences = normalizeProviderRefundReferences({
    provider: normalizedProvider,
    status: refund.status,
    refund,
    payment
  });

  refund.paymentId = payment._id;
  refund.provider = normalizedProvider || refund.provider;
  refund.providerRefundRequestReference = requestReference || providerReferences.providerRefundRequestReference || refund.providerRefundRequestReference;
  refund.providerRefundReference = reference || providerReferences.providerRefundReference || "";
  refund.originalTransactionReference = refund.originalTransactionReference || extractOriginalTransactionReference(payment);
  refund.originalProviderTransactionId = providerTransactionId || refund.originalProviderTransactionId || String(payment.providerTransactionId || payment.orderTrackingId || "");
  refund.requestedRefundAmount = refund.requestedRefundAmount || decimalOrNull(requestedAmount);
  refund.requestedRefundCurrency = refund.requestedRefundCurrency || accountingCurrency;
  refund.accountingRefundAmount = decimalOrNull(requestedAmount);
  refund.accountingRefundCurrency = accountingCurrency;
  refund.confirmedRefundedAmount = Number(toDecimal(requestedAmount).toFixed(2));
  refund.confirmedAccountingRefundedAmount = decimalOrNull(requestedAmount);
  refund.confirmedProviderRefundedAmount = decimalOrNull(refund.confirmedProviderRefundedAmount || requestedAmount);
  refund.providerRefundStatus = "COMPLETED";
  refund.status = finalStatus;
  refund.completedAt = completedAt;
  refund.lastRefundSyncAt = new Date();
  refund.failureReason = "";
  refund.rawProviderResponse = rawProviderResponse ? safeProviderSnapshot(rawProviderResponse) : refund.rawProviderResponse;
  refund.providerResponseSnapshot = rawProviderResponse ? safeProviderSnapshot(rawProviderResponse) : refund.providerResponseSnapshot;
  refund.metadata = {
    ...(refund.metadata || {}),
    lastFinalizedBy: auth?.id || auth?.email || auth?.role || "system",
    lastFinalizedSource: source,
    lastFinalizedAt: new Date().toISOString()
  };
  await refund.save();

  const paymentUpdate = {
    $set: {
      refundedAmount: Number(toDecimal(totalRefunded).toFixed(2)),
      refundStatus: finalStatus,
      refundedAt: finalStatus === "refunded" ? completedAt : payment.refundedAt || null
    }
  };
  const hasFinalizationHistory = (payment.transactionHistory || []).some((event) =>
    event.event === "refund_finalized" &&
    (
      String(event.metadata?.refundId || "") === String(refund._id) ||
      (reference && String(event.metadata?.providerRefundReference || "") === reference)
    )
  );
  if (!hasFinalizationHistory) {
    paymentUpdate.$push = {
      transactionHistory: {
        occurredAt: new Date(),
        event: "refund_finalized",
        status: finalStatus,
        source,
        description: reason,
        metadata: safeProviderSnapshot({
          refundReference: refund.refundReference,
          refundId: String(refund._id),
          provider: normalizedProvider,
          providerRefundRequestReference: requestReference,
          providerRefundReference: reference,
          refundAmount: requestedAmount,
          totalRefunded
        })
      }
    };
  }

  await Payment.updateOne(
    { _id: payment._id, status: "paid" },
    paymentUpdate
  );

  if (request) {
    await updateRequestRefundStatus({ request, refund });
  }

  booking.refundStatus = finalStatus;
  booking.amountRefunded = Number(toDecimal(totalRefunded).toFixed(2));
  booking.refundedAt = finalStatus === "refunded" ? completedAt : booking.refundedAt || null;
  if (markBookingCancelled || request?.type === "cancel_booking") {
    booking.bookingStatus = "cancelled";
    booking.cancellation = {
      ...(booking.cancellation || {}),
      reason: booking.cancellation?.reason || reason || "Refund finalized after cancellation",
      cancelledAt: booking.cancellation?.cancelledAt || completedAt,
      cancelledBy: booking.cancellation?.cancelledBy || auth?.role || "system"
    };
  }
  await booking.save();

  let invoiceSync = null;
  try {
    invoiceSync = await bookingsService.syncInvoiceForBookingReference({
      bookingReference: booking.bookingReference,
      auth,
      requestId,
      reason: "Successful refund finalized"
    });
  } catch (error) {
    await recordAudit({
      action: "booking_request_refund_invoice_sync_failed",
      request: request || { _id: refund.bookingRequestId || refund._id },
      booking,
      auth,
      requestId,
      reason: error.message,
      before,
      after: { refundStatus: finalStatus, totalRefunded },
      metadata: { refundReference: refund.refundReference, error: compactError(error) }
    }).catch(() => {});
    throw error;
  }

  const refreshedPayment = await Payment.findById(payment._id).lean();
  const refreshedBooking = await Booking.findById(booking._id).lean();
  const refreshedRefund = await Refund.findById(refund._id).lean();
  const result = normalizeRefundResult({
    booking: refreshedBooking,
    payment: refreshedPayment,
    refund: refreshedRefund,
    totalRefunded,
    currency: accountingCurrency
  });

  await recordAudit({
    action: "booking_request_refund_finalized",
    request: request || { _id: refund.bookingRequestId || refund._id },
    booking,
    auth,
    requestId,
    reason,
    before,
    after: result,
    metadata: {
      refundReference: refund.refundReference,
      provider: normalizedProvider,
      providerRefundRequestReference: maskReference(requestReference),
      providerRefundReference: maskReference(reference),
      invoiceNumber: invoiceSync?.invoice?.invoiceNumber || ""
    }
  });

  return result;
};

const canRepairProviderBeforeProcessing = (currentProvider = "", resolvedProvider = "") => {
  const current = normalizeProvider(currentProvider);
  const resolved = normalizeProvider(resolvedProvider);
  return Boolean(resolved) && (!current || current === "other" || current === "manual_review");
};

const assertNoDuplicatePesapalRefundRequest = async ({ paymentId = null, refundId = null, orderTrackingId = "" } = {}) => {
  const query = {
    provider: "pesapal",
    status: { $in: [...INTERMEDIATE_REFUND_STATUSES, ...FINAL_REFUND_STATUSES] }
  };
  if (paymentId) query.paymentId = paymentId;
  else if (orderTrackingId) query.originalProviderTransactionId = orderTrackingId;
  else return;
  if (refundId) query._id = { $ne: refundId };

  const duplicate = await Refund.findOne(query).select("_id refundReference status").lean();
  if (duplicate) {
    throw new AppError(
      "Pesapal only allows one refund request against a payment. Existing refund request must be resolved first.",
      409,
      "PESAPAL_REFUND_REQUEST_DUPLICATE",
      {
        refundId: String(duplicate._id),
        refundReference: duplicate.refundReference,
        status: duplicate.status
      }
    );
  }
};

const assertPesapalRefundTransactionMatches = ({ booking, payment, refund, verification } = {}) => {
  const expectedTrackingId = extractPesapalOrderTrackingId({ booking, payment, refund });
  const returnedTrackingId = String(verification?.providerOrderTrackingId || verification?.orderTrackingId || resolveOrderTrackingId(verification?.raw || {}) || "").trim();
  if (!expectedTrackingId) {
    throw new AppError("Pesapal order tracking ID is required before refund verification.", 409, "PESAPAL_ORDER_TRACKING_MISSING");
  }
  if (returnedTrackingId && returnedTrackingId !== expectedTrackingId) {
    throw new AppError("Pesapal returned a different order tracking ID for this refund.", 409, "PESAPAL_REFUND_TRACKING_MISMATCH");
  }

  const expectedMerchantReference = extractPesapalMerchantReference({ booking, payment, verification });
  const returnedMerchantReference = String(verification?.merchantReference || resolveMerchantReference(verification?.raw || "") || "").trim();
  if (expectedMerchantReference && returnedMerchantReference && returnedMerchantReference !== expectedMerchantReference) {
    throw new AppError("Pesapal returned a different merchant reference for this refund.", 409, "PESAPAL_REFUND_MERCHANT_REFERENCE_MISMATCH");
  }

  const providerCurrency = normalizeCurrency(
    refund?.requestedRefundCurrency ||
      refund?.originalChargedCurrency ||
      extractChargedCurrency(payment || {})
  );
  const returnedCurrency = normalizeCurrency(verification?.currency || verification?.raw?.currency || "");
  if (returnedCurrency && providerCurrency && returnedCurrency !== providerCurrency) {
    throw new AppError(
      "Pesapal refund verification currency does not match the original transaction currency.",
      409,
      "PESAPAL_REFUND_CURRENCY_MISMATCH",
      { providerCurrency, returnedCurrency }
    );
  }

  const transactionAmount = verification?.amount ?? verification?.raw?.amount ?? "";
  if (!toDecimal(transactionAmount || 0).greaterThan(0)) {
    throw new AppError("Pesapal did not return a positive original transaction amount.", 409, "PESAPAL_REFUND_TRANSACTION_AMOUNT_MISSING");
  }
  const expectedChargedAmount = toDecimal(extractChargedAmountString(payment || {}));
  if (expectedChargedAmount.greaterThan(0) && toDecimal(transactionAmount).minus(expectedChargedAmount).abs().greaterThan(0.009)) {
    throw new AppError(
      "Pesapal refund verification amount does not match the original transaction amount.",
      409,
      "PESAPAL_REFUND_AMOUNT_MISMATCH",
      {
        providerAmount: decimalString(transactionAmount),
        expectedChargedAmount: expectedChargedAmount.toFixed(),
        providerCurrency: returnedCurrency || providerCurrency
      }
    );
  }

  return {
    expectedTrackingId,
    returnedTrackingId,
    expectedMerchantReference,
    returnedMerchantReference,
    transactionAmount: decimalString(transactionAmount),
    transactionCurrency: returnedCurrency || providerCurrency,
    confirmationCode: String(verification?.confirmationCode || verification?.raw?.confirmation_code || "").trim()
  };
};

const determinePesapalRefundVerification = ({ booking, payment, refund, verification } = {}) => {
  const evidence = assertPesapalRefundTransactionMatches({ booking, payment, refund, verification });
  const state = resolvePesapalPaymentState(
    verification?.raw || { status_code: verification?.statusCode },
    verification?.status || verification?.statusDescription
  );
  const amountPaid = toDecimal(extractPaymentAmountString(payment || {}));
  const requestedAccountingAmount = toDecimal(decimalToApi(refund?.accountingRefundAmount) || refund?.amount || 0);
  const fullAccountingRefund = requestedAccountingAmount.greaterThan(0) &&
    amountPaid.greaterThan(0) &&
    requestedAccountingAmount.greaterThanOrEqualTo(amountPaid.minus(0.009));

  if (state === "reversed" && fullAccountingRefund) {
    return {
      finalizable: true,
      status: "refunded",
      refundAmount: requestedAccountingAmount.toFixed(),
      refundCurrency: refund?.accountingRefundCurrency || extractPaymentCurrency(payment || {}) || booking?.currency,
      providerRefundRequestReference: refund?.providerRefundRequestReference || evidence.confirmationCode,
      providerRefundReference: refund?.providerRefundReference || "",
      providerMessage: "Pesapal reports the original transaction as reversed and the requested refund covers the full paid amount.",
      evidence
    };
  }

  if (state === "reversed") {
    return {
      finalizable: false,
      status: "processing",
      providerMessage: "Pesapal reports the transaction as reversed, but the public status response does not prove this partial refund amount was effected.",
      evidence
    };
  }

  if (state === "paid") {
    return {
      finalizable: false,
      status: "awaiting_merchant_approval",
      providerMessage: "Pesapal refund request was accepted but final refund completion has not yet been verified. Confirm the merchant approval email and verify again later.",
      evidence
    };
  }

  if (state === "processing") {
    return {
      finalizable: false,
      status: "processing",
      providerMessage: "Pesapal still reports the original transaction as processing. Verify again later.",
      evidence
    };
  }

  return {
    finalizable: false,
    status: "verification_required",
    providerMessage: `Pesapal returned ${normalizePesapalStatus(verification?.status || verification?.statusDescription || state || "unknown")} and the refund cannot be finalized safely.`,
    evidence
  };
};

const processProviderRefund = async ({ refund, request, booking, payment, auth, traceId, notes = "" }) => {
  const amount = decimalToApi(refund.requestedRefundAmount) || decimalString(refund.amount);
  const currency = normalizeCurrency(refund.requestedRefundCurrency || refund.originalChargedCurrency || refund.currency);
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
    const orderTrackingId = extractPesapalOrderTrackingId({ booking, payment, refund });
    await assertNoDuplicatePesapalRefundRequest({
      paymentId: payment?._id || refund.paymentId,
      refundId: refund._id,
      orderTrackingId
    });
    const transactionStatus = await pesapalService.getTransactionStatus({
      orderTrackingId,
      booking,
      orderMerchantReference: extractPesapalMerchantReference({ booking, payment }),
      requestId: traceId
    });
    const evidence = assertPesapalRefundTransactionMatches({ booking, payment, refund, verification: transactionStatus });
    const providerState = resolvePesapalPaymentState(transactionStatus.raw || { status_code: transactionStatus.statusCode }, transactionStatus.status);
    if (providerState !== "paid") {
      return {
        status: "verification_required",
        providerRefundRequestReference: refund.providerRefundRequestReference || evidence.confirmationCode,
        providerRefundReference: "",
        confirmedAmount: 0,
        response: {
          reason: "Pesapal transaction is not completed, so a refund request cannot be initiated safely.",
          transactionStatus
        }
      };
    }
    const confirmationCode = String(transactionStatus.confirmationCode || evidence.confirmationCode || extractPesapalConfirmationCode(payment)).trim();
    if (!confirmationCode) {
      return {
        status: "manual_refund_required",
        providerRefundReference: "",
        confirmedAmount: 0,
        response: { reason: "Pesapal confirmation code is missing." }
      };
    }
    if (isPesapalMobileMoney(payment) && compare(amount, extractChargedAmountString(payment)) < 0) {
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
    }).then((result) => ({
      ...result,
      providerRefundRequestReference: result.providerRefundRequestReference || confirmationCode,
      transactionVerification: transactionStatus,
      response: {
        refundRequest: result.response,
        transactionStatus
      }
    }));
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
  if (["processing", "awaiting_merchant_approval"].includes(refund.status)) {
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
    locked.originalProviderTransactionId = String(payment?.providerTransactionId || "");
    locked.originalChargedAmount = decimalOrNull(extractChargedAmountString(payment || {}));
    locked.originalChargedCurrency = extractChargedCurrency(payment || {});
    locked.requestedRefundAmount = decimalOrNull(context.providerRefundAmount);
    locked.requestedRefundCurrency = context.providerRefundCurrency;
    locked.accountingRefundAmount = decimalOrNull(refund.amount);
    locked.accountingRefundCurrency = context.currency;
    locked.historicalFxRate = decimalOrNull(payment?.fxRate);
    const result = await processProviderRefund({ refund: locked, request, booking, payment, auth, traceId, notes });
    const providerStatus = String(result.status || "").toLowerCase();
    const confirmedProviderAmount = decimalString(result.confirmedAmount || 0);
    locked.providerRefundStatus = String(result.status || "").toUpperCase();

    if (providerStatus === "completed") {
      const totalAfter = toDecimal(context.previouslyRefundedAmount).plus(toDecimal(refund.amount));
      locked.status = totalAfter.greaterThanOrEqualTo(toDecimal(context.totalCapturedAmount)) ? "refunded" : "partially_refunded";
      locked.confirmedProviderRefundedAmount = decimalOrNull(confirmedProviderAmount);
      locked.confirmedAccountingRefundedAmount = decimalOrNull(refund.amount);
      locked.confirmedRefundedAmount = Number(toDecimal(refund.amount).toFixed(2));
      locked.completedAt = new Date();
    } else if (PESAPAL_ACCEPTED_REFUND_STATUSES.has(providerStatus)) {
      locked.status = normalizeProvider(locked.provider) === "pesapal" ? "awaiting_merchant_approval" : "processing";
      locked.confirmedRefundedAmount = 0;
      locked.confirmedProviderRefundedAmount = null;
      locked.confirmedAccountingRefundedAmount = null;
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

    locked.providerRefundRequestReference = String(result.providerRefundRequestReference || locked.providerRefundRequestReference || "").trim();
    locked.providerRefundReference = String(result.providerRefundReference || locked.providerRefundReference || "").trim();
    locked.providerRequestSnapshot = result.request || locked.providerRequestSnapshot;
    locked.providerResponseSnapshot = result.response || result.raw || result;
    locked.rawProviderResponse = result.response || result.raw || result;
    locked.lastRefundSyncAt = new Date();
    locked.metadata = {
      ...(locked.metadata || {}),
      processing: false,
      providerStatus: result.status || "",
      providerMessage: result.providerMessage || locked.metadata?.providerMessage || "",
      requiresMerchantApproval: Boolean(result.requiresMerchantApproval)
    };
    await locked.save();

    if (FINAL_REFUND_STATUSES.includes(locked.status)) {
      return finalizeSuccessfulRefund({
        bookingId: booking._id,
        paymentId: locked.paymentId,
        refundId: locked._id,
        refundAmount: refund.amount,
        refundCurrency: context.currency,
        provider: locked.provider,
        providerRefundReference: locked.providerRefundReference,
        providerTransactionId: locked.originalProviderTransactionId,
        refundedAt: locked.completedAt,
        rawProviderResponse: result.response || result.raw || result,
        auth,
        requestId: traceId,
        source: "provider_refund",
        reason: "Payment provider confirmed refund completion",
        markBookingCancelled: true
      });
    }

    await syncPaymentRefundedAmount(locked.paymentId);
    await updateRequestRefundStatus({ request, refund: locked });
    booking.refundStatus = locked.status;
    booking.amountRefunded = Number(toDecimal(await sumSuccessfulRefunds({ bookingId: booking._id, paymentId: locked.paymentId })).toFixed(2));
    await booking.save();
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
    await syncPaymentRefundedAmount(locked.paymentId);
    booking.refundStatus = locked.status;
    booking.amountRefunded = Number(toDecimal(await sumSuccessfulRefunds({ bookingId: booking._id, paymentId: locked.paymentId })).toFixed(2));
    await booking.save();
    await bookingsService.syncInvoiceForBookingReference({ bookingReference: booking.bookingReference, requestId: traceId, reason: "Refund verification required" });
    await recordAudit({ action: "booking_request_refund_verification_required", request, booking, auth, requestId: traceId, before, after: { status: locked.status }, metadata: { refundReference: locked.refundReference, error: compactError(error) } });
    return locked;
  }
};

const updateRefundProviderState = async ({ refund, request, booking, status, failureReason = "", providerMessage = "", auth, traceId = "", providerResponse = null } = {}) => {
  refund.status = status;
  refund.providerRefundStatus = String(status || "").toUpperCase();
  refund.lastRefundSyncAt = new Date();
  refund.failureReason = ["failed", "verification_required"].includes(status) ? failureReason : "";
  refund.metadata = {
    ...(refund.metadata || {}),
    providerMessage: providerMessage || failureReason || refund.metadata?.providerMessage || ""
  };
  if (providerResponse) {
    refund.providerResponseSnapshot = safeProviderSnapshot(providerResponse);
    refund.rawProviderResponse = safeProviderSnapshot(providerResponse);
  }
  if (status === "processing") refund.processingStartedAt = refund.processingStartedAt || new Date();
  if (status === "failed") refund.failedAt = new Date();
  await refund.save();
  if (request) await updateRequestRefundStatus({ request, refund });
  const paymentId = refund.paymentId || null;
  const totalRefunded = await sumSuccessfulRefunds({ bookingId: booking?._id, paymentId });
  if (paymentId) {
    const paymentRefundStatus = FINAL_REFUND_STATUSES.includes(status)
      ? status
      : ["awaiting_merchant_approval", "processing", "verification_required", "approved", "requested"].includes(status)
        ? "processing"
        : status === "failed"
          ? "failed"
          : toDecimal(totalRefunded).greaterThan(0)
            ? "partially_refunded"
            : "not_required";
    await Payment.findByIdAndUpdate(paymentId, {
      $set: {
        refundedAmount: Number(toDecimal(totalRefunded).toFixed(2)),
        refundStatus: paymentRefundStatus
      }
    });
  }
  if (booking?._id) {
    booking.refundStatus = status;
    booking.amountRefunded = Number(toDecimal(totalRefunded).toFixed(2));
    if (FINAL_REFUND_STATUSES.includes(status)) booking.refundedAt = refund.completedAt || new Date();
    await booking.save();
  }
  await recordAudit({
    action: "booking_request_refund_provider_state_synced",
    request: request || { _id: refund.bookingRequestId || refund._id },
    booking,
    auth,
    requestId: traceId,
    reason: providerMessage || failureReason || "Refund provider state synced",
    metadata: {
      refundReference: refund.refundReference,
      provider: refund.provider,
      status
    }
  });
  return normalizeRefundResult({
    booking,
    payment: refund.paymentId ? await Payment.findById(refund.paymentId).lean() : null,
    refund: refund.toObject ? refund.toObject() : refund,
    totalRefunded
  });
};

const verifyRefundStatus = async ({ refundId, auth, traceId = "" } = {}) => {
  const refund = await Refund.findById(refundId);
  if (!refund) throw new AppError("Refund not found", 404, "REFUND_NOT_FOUND");
  const booking = await Booking.findById(refund.bookingId);
  const request = await BookingRequest.findById(refund.bookingRequestId);
  if (!booking) throw new AppError("Refund booking context is missing.", 404, "REFUND_CONTEXT_NOT_FOUND");

  const provider = normalizeProvider(refund.provider);
  const reference = String(refund.providerRefundReference || "").trim();

  if (provider === "pesapal") {
    const payment = refund.paymentId
      ? await Payment.findById(refund.paymentId)
      : await Payment.findOne({ bookingReference: booking.bookingReference, provider: "pesapal", status: "paid" }).sort({ paidAt: -1, updatedAt: -1, createdAt: -1 });
    if (!payment) throw new AppError("Pesapal refund verification requires the original paid payment record.", 409, "REFUND_PAYMENT_NOT_FOUND");

    const orderTrackingId = extractPesapalOrderTrackingId({ booking, payment, refund });
    const verification = await pesapalService.getTransactionStatus({
      orderTrackingId,
      booking,
      orderMerchantReference: extractPesapalMerchantReference({ booking, payment }),
      requestId: traceId
    });
    const decision = determinePesapalRefundVerification({ booking, payment, refund, verification });
    refund.providerRefundRequestReference = refund.providerRefundRequestReference || decision.providerRefundRequestReference || decision.evidence?.confirmationCode || "";
    refund.originalProviderTransactionId = refund.originalProviderTransactionId || orderTrackingId;
    refund.lastRefundSyncAt = new Date();
    refund.metadata = {
      ...(refund.metadata || {}),
      providerMessage: decision.providerMessage,
      lastPesapalVerificationAt: new Date().toISOString(),
      pesapalVerificationState: decision.status
    };
    refund.providerResponseSnapshot = safeProviderSnapshot({
      ...(refund.providerResponseSnapshot || {}),
      lastVerification: verification.raw || verification
    });
    refund.rawProviderResponse = safeProviderSnapshot({
      ...(refund.rawProviderResponse || {}),
      lastVerification: verification.raw || verification
    });
    await refund.save();

    if (decision.finalizable) {
      return finalizeSuccessfulRefund({
        bookingId: booking._id,
        paymentId: payment._id,
        refundId: refund._id,
        refundAmount: decision.refundAmount,
        refundCurrency: decision.refundCurrency,
        provider,
        providerRefundRequestReference: decision.providerRefundRequestReference,
        providerRefundReference: decision.providerRefundReference,
        providerTransactionId: orderTrackingId,
        refundedAt: new Date(),
        rawProviderResponse: {
          source: "pesapal_get_transaction_status",
          verification: verification.raw || verification,
          decision
        },
        auth,
        requestId: traceId,
        source: "admin_provider_verify",
        reason: "Admin verified completed Pesapal refund from transaction reversal evidence",
        markBookingCancelled: request?.type === "cancel_booking"
      });
    }

    return updateRefundProviderState({
      refund,
      request,
      booking,
      status: decision.status,
      failureReason: decision.status === "verification_required" ? decision.providerMessage : "",
      providerMessage: decision.providerMessage,
      auth,
      traceId,
      providerResponse: {
        source: "pesapal_get_transaction_status",
        verification: verification.raw || verification,
        decision
      }
    });
  }

  if (!reference) {
    throw new AppError("Provider refund reference is required before verification.", 422, "PROVIDER_REFUND_REFERENCE_REQUIRED");
  }

  if (provider === "paypal") {
    const result = await paypalService.getRefundDetails({
      refundId: reference,
      requestId: traceId
    });
    const providerStatus = String(result.status || "").toLowerCase();
    if (FINAL_PROVIDER_REFUND_STATUSES.has(providerStatus)) {
      return finalizeSuccessfulRefund({
        bookingId: booking._id,
        paymentId: refund.paymentId,
        refundId: refund._id,
        refundAmount: result.confirmedAmount || refund.amount,
        refundCurrency: result.currency || refund.currency,
        provider,
        providerRefundReference: reference,
        refundedAt: result.refundedAt || new Date(),
        rawProviderResponse: result.raw,
        auth,
        requestId: traceId,
        source: "admin_provider_verify",
        reason: "Admin verified completed refund with PayPal",
        markBookingCancelled: request?.type === "cancel_booking"
      });
    }
    if (PENDING_PROVIDER_REFUND_STATUSES.has(providerStatus)) {
      return updateRefundProviderState({
        refund,
        request,
        booking,
        status: "processing",
        auth,
        traceId,
        providerResponse: result.raw
      });
    }
    if (FAILED_PROVIDER_REFUND_STATUSES.has(providerStatus)) {
      return updateRefundProviderState({
        refund,
        request,
        booking,
        status: "failed",
        failureReason: result.failureReason || "PayPal reported refund failure.",
        auth,
        traceId,
        providerResponse: result.raw
      });
    }
    return updateRefundProviderState({
      refund,
      request,
      booking,
      status: "verification_required",
      failureReason: `PayPal returned refund status ${result.status || "unknown"}.`,
      auth,
      traceId,
      providerResponse: result.raw
    });
  }

  if (provider === "pesapal") {
    throw new AppError(
      "Pesapal API 3.0 does not expose a public completed-refund status lookup. Confirm the refund in Pesapal, then record the provider reference and amount.",
      409,
      "REFUND_PROVIDER_VERIFICATION_UNAVAILABLE",
      { provider }
    );
  }

  throw new AppError(
    "Automatic refund status verification is not configured for this provider.",
    409,
    "REFUND_PROVIDER_VERIFICATION_UNAVAILABLE",
    { provider }
  );
};

const reconcilePendingRefunds = async ({
  limit = 20,
  minAgeMs = 5 * 60 * 1000,
  maxRetries = 8,
  requestId = "",
  source = "system_refund_reconciliation"
} = {}) => {
  const cutoff = new Date(Date.now() - Math.max(0, Number(minAgeMs) || 0));
  const rows = await Refund.find({
    status: { $in: RECONCILABLE_REFUND_STATUSES },
    "metadata.reconciliationDisabled": { $ne: true },
    $and: [
      {
        $or: [
          { provider: "pesapal" },
          { providerRefundReference: { $type: "string", $gt: "" } }
        ]
      },
      {
        $or: [
          { lastRefundSyncAt: null },
          { lastRefundSyncAt: { $exists: false } },
          { lastRefundSyncAt: { $lte: cutoff } }
        ]
      }
    ]
  }).sort({ lastRefundSyncAt: 1, updatedAt: 1 }).limit(Math.min(Math.max(Number(limit) || 20, 1), 100));

  const summary = {
    scanned: rows.length,
    finalized: 0,
    processing: 0,
    failed: 0,
    verificationRequired: 0,
    manualReview: 0,
    retryLimitReached: 0,
    errors: 0
  };
  const results = [];

  for (const refund of rows) {
    const retryCount = Number(refund.metadata?.reconciliationRetryCount || 0);
    try {
      const result = await verifyRefundStatus({
        refundId: refund._id,
        auth: { role: "system" },
        traceId: `${requestId || source}-${refund._id}`
      });
      if (FINAL_REFUND_STATUSES.includes(result?.status)) summary.finalized += 1;
      else if (result?.status === "processing") summary.processing += 1;
      else if (result?.status === "failed") summary.failed += 1;
      else summary.verificationRequired += 1;
      results.push({ refundId: refund._id, status: result?.status || "" });
    } catch (error) {
      const refreshed = await Refund.findById(refund._id);
      if (!refreshed) continue;
      const nextRetryCount = retryCount + 1;
      const providerVerificationUnavailable = error.code === "REFUND_PROVIDER_VERIFICATION_UNAVAILABLE";
      const retryLimitReached = nextRetryCount >= Number(maxRetries || 8);
      refreshed.lastRefundSyncAt = new Date();
      refreshed.failureReason = String(error.message || "Refund verification failed.").slice(0, 1000);
      refreshed.metadata = {
        ...(refreshed.metadata || {}),
        reconciliationRetryCount: nextRetryCount,
        lastReconciliationSource: source,
        lastReconciliationError: compactError(error),
        reconciliationDisabled: providerVerificationUnavailable || retryLimitReached
      };
      await refreshed.save();
      if (providerVerificationUnavailable) summary.manualReview += 1;
      else if (retryLimitReached) summary.retryLimitReached += 1;
      else summary.errors += 1;
      results.push({ refundId: refund._id, status: refreshed.status, error: compactError(error) });
    }
  }

  return { summary, results };
};

module.exports = {
  FINAL_REFUND_STATUSES,
  RECONCILABLE_REFUND_STATUSES,
  assertRefundAmountAllowed,
  buildRefundSummaryFromRecords,
  extractOriginalTransactionReference,
  finalizeSuccessfulRefund,
  fromMinor,
  maskReference,
  normalizeProvider,
  normalizeRefundResult,
  processRefund,
  providerLabel,
  reconcilePendingRefunds,
  resolveRefundContext,
  toMinor,
  verifyRefundStatus,
  __testables: {
    buildRefundSummaryFromRecords,
    buildRefundContextFromRecords,
    canRepairProviderBeforeProcessing,
    dedupeSuccessfulPayments,
    determinePesapalRefundVerification,
    extractPaypalCaptureId,
    extractPesapalConfirmationCode,
    extractPesapalOrderTrackingId,
    isSuccessfulPayment,
    isPesapalMobileMoney,
    maskReference,
    normalizeRefundResult,
    refundStatusFromTotals,
    sumSuccessfulRefunds,
    toMinor,
    fromMinor
  }
};
