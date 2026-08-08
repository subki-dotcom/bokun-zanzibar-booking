const { v4: uuidv4 } = require("uuid");
const Payment = require("../../models/Payment");
const PaymentAllocation = require("../../models/PaymentAllocation");
const Booking = require("../../models/Booking");
const Invoice = require("../../models/Invoice");
const { env, isDpoConfigured, isPesapalConfigured, isPaypalConfigured } = require("../../config/env");
const AppError = require("../../utils/AppError");
const {
  Decimal,
  decimalOrNull,
  decimalString,
  decimalToApi,
  divide,
  normalizeCurrency,
  requireCurrency,
  toDecimal
} = require("../../utils/money");

const toNumber = (value = 0) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeToken = (value = "") => String(value || "").trim();

const SENSITIVE_PROVIDER_KEY = /(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|consumer[_-]?secret|company[_-]?token|authorization|password|passcode|card[_-]?(?:number|pan)|cvv|cvc|payment[_-]?account|email[_-]?address)/i;

const maskSensitiveDigits = (value) => String(value).replace(/\b\d{12,19}\b/g, (digits) => `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`);

const sanitizeProviderPayload = (value, depth = 0) => {
  if (value === null || value === undefined) return value;
  if (depth > 7) return "[truncated]";
  if (typeof value === "string") return maskSensitiveDigits(value).slice(0, 5000);
  if (["number", "boolean"].includes(typeof value)) return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeProviderPayload(item, depth + 1));
  if (typeof value !== "object") return String(value).slice(0, 5000);

  return Object.entries(value).slice(0, 200).reduce((safe, [key, item]) => {
    safe[key] = SENSITIVE_PROVIDER_KEY.test(key)
      ? "[redacted]"
      : sanitizeProviderPayload(item, depth + 1);
    return safe;
  }, {});
};

const toLegacyNumber = (value = 0) => {
  try {
    return Number(decimalString(value));
  } catch (error) {
    return 0;
  }
};

const hasCanonicalMoney = (payment = {}) =>
  payment?.orderAmount !== null && payment?.orderAmount !== undefined && Boolean(payment?.orderCurrency);

const isCanonicallyAllocated = (payment = {}) =>
  hasCanonicalMoney(payment) &&
  payment?.verificationStatus === "verified" &&
  payment?.accountingAllocationStatus === "applied";

const accountingValue = (payment = {}) => {
  if (isCanonicallyAllocated(payment)) {
    return decimalToApi(payment.accountingAmount, "0") || "0";
  }
  if (!hasCanonicalMoney(payment)) {
    return decimalString(payment.amountPaid ?? payment.paidAmount ?? 0);
  }
  return "0";
};

const calculateVerifiedPaidAmount = (rows = []) => {
  const paidByIntent = new Map();
  rows
    .filter((row) => row?.status === "paid")
    .forEach((row) => {
      const intentKey = String(row.intentId || row.providerTransactionId || row.orderTrackingId || row._id);
      const paid = accountingValue(row);
      const existing = paidByIntent.get(intentKey) || "0";
      paidByIntent.set(intentKey, toDecimal(paid).greaterThan(toDecimal(existing)) ? paid : existing);
    });
  return Number(
    Array.from(paidByIntent.values())
      .reduce((total, paid) => total.plus(toDecimal(paid)), new Decimal(0))
      .toFixed()
  );
};

const buildCanonicalSet = ({
  orderAmount = undefined,
  orderCurrency = undefined,
  chargedAmount = undefined,
  chargedCurrency = undefined,
  accountingAmount = undefined,
  accountingCurrency = undefined,
  settlementAmount = undefined,
  settlementCurrency = undefined,
  providerFeeAmount = undefined,
  providerFeeCurrency = undefined,
  settledAt = undefined,
  fxRate = undefined,
  fxSourceCurrency = undefined,
  fxTargetCurrency = undefined,
  fxSource = undefined,
  fxQuotedAt = undefined,
  fxExpiresAt = undefined,
  settlementFx = undefined,
  paymentMethod = undefined,
  confirmationCode = undefined,
  paypalOrderId = undefined,
  paypalCaptureId = undefined,
  dpoTransactionToken = undefined,
  dpoTransactionRef = undefined,
  providerStatus = undefined,
  paymentStatus = undefined,
  verificationStatus = undefined,
  verificationReason = undefined,
  accountingAllocationStatus = undefined,
  accountingAllocatedAt = undefined,
  invoiceStatus = undefined,
  refundStatus = undefined,
  bokunSyncStatus = undefined,
  anomaly = undefined
} = {}) => {
  const $set = {};
  const moneyFields = {
    orderAmount,
    chargedAmount,
    accountingAmount,
    settlementAmount,
    providerFeeAmount,
    fxRate
  };
  Object.entries(moneyFields).forEach(([key, value]) => {
    if (value !== undefined) $set[key] = decimalOrNull(value, { allowNegative: false, field: key });
  });

  const currencyFields = {
    orderCurrency,
    chargedCurrency,
    accountingCurrency,
    settlementCurrency,
    providerFeeCurrency,
    fxSourceCurrency,
    fxTargetCurrency
  };
  Object.entries(currencyFields).forEach(([key, value]) => {
    if (value !== undefined) $set[key] = value ? requireCurrency(value) : "";
  });

  const stringFields = {
    fxSource,
    paymentMethod,
    confirmationCode,
    paypalOrderId,
    paypalCaptureId,
    dpoTransactionToken,
    dpoTransactionRef,
    providerStatus,
    paymentStatus,
    verificationStatus,
    verificationReason,
    accountingAllocationStatus,
    invoiceStatus,
    refundStatus,
    bokunSyncStatus
  };
  Object.entries(stringFields).forEach(([key, value]) => {
    if (value !== undefined) $set[key] = normalizeToken(value);
  });

  const dateFields = { settledAt, fxQuotedAt, fxExpiresAt, accountingAllocatedAt };
  Object.entries(dateFields).forEach(([key, value]) => {
    if (value !== undefined) $set[key] = value ? new Date(value) : null;
  });
  if (anomaly !== undefined) $set.anomaly = anomaly || { flagged: false, code: "", message: "" };
  if (settlementFx !== undefined) {
    const rate = settlementFx?.rate;
    $set.settlementFx = {
      rate: rate === null || rate === undefined || rate === "" ? null : decimalOrNull(rate, { allowNegative: false, field: "settlementFx.rate" }),
      sourceCurrency: settlementFx?.sourceCurrency ? requireCurrency(settlementFx.sourceCurrency) : "",
      targetCurrency: settlementFx?.targetCurrency ? requireCurrency(settlementFx.targetCurrency) : "",
      source: normalizeToken(settlementFx?.source || "")
    };
  }
  return $set;
};

const buildGatewaySet = ({
  providerTransactionId = undefined,
  merchantReference = undefined,
  orderTrackingId = undefined,
  paidAt = undefined,
  lastVerifiedAt = undefined,
  rawResponse = undefined,
  providerResponse = undefined,
  notes = ""
} = {}) => {
  const $set = {};

  if (providerTransactionId !== undefined) {
    $set.providerTransactionId = normalizeToken(providerTransactionId);
  }
  if (merchantReference !== undefined) {
    $set.merchantReference = normalizeToken(merchantReference);
  }
  if (orderTrackingId !== undefined) {
    $set.orderTrackingId = normalizeToken(orderTrackingId);
  }
  if (paidAt !== undefined) {
    $set.paidAt = paidAt ? new Date(paidAt) : null;
  }
  if (lastVerifiedAt !== undefined) {
    $set.lastVerifiedAt = lastVerifiedAt ? new Date(lastVerifiedAt) : null;
  }
  if (rawResponse !== undefined) {
    $set.rawResponse = sanitizeProviderPayload(rawResponse);
  }
  if (providerResponse !== undefined) {
    $set.providerResponse = sanitizeProviderPayload(providerResponse);
  }
  if (notes) {
    $set.notes = notes;
  }

  return $set;
};

const buildIpnPush = (ipnEvent = null) => {
  if (!ipnEvent) {
    return null;
  }

  return {
    receivedAt: ipnEvent.receivedAt ? new Date(ipnEvent.receivedAt) : new Date(),
    source: ipnEvent.source || "callback",
    orderTrackingId: normalizeToken(ipnEvent.orderTrackingId),
    merchantReference: normalizeToken(ipnEvent.merchantReference),
    status: normalizeToken(ipnEvent.status),
    raw: sanitizeProviderPayload(ipnEvent.raw || {})
  };
};

const buildTransactionHistoryPush = ({
  event = "status_updated",
  status = "",
  source = "system",
  description = "",
  metadata = {}
} = {}) => ({
  occurredAt: new Date(),
  event: normalizeToken(event) || "status_updated",
  status: normalizeToken(status),
  source: normalizeToken(source) || "system",
  description: String(description || "").slice(0, 500),
  metadata: sanitizeProviderPayload(metadata || {})
});

const canReplacePaidStatus = (nextStatus = "") =>
  ["reversed"].includes(normalizeToken(nextStatus));

const appendPaymentEvent = (update, event) => {
  update.$push = {
    ...(update.$push || {}),
    transactionHistory: buildTransactionHistoryPush(event)
  };
  return update;
};

const createPaymentIntent = async ({
  bookingReference,
  customerId,
  amount,
  currency,
  orderAmount = undefined,
  orderCurrency = undefined,
  provider = "custom",
  notes = "",
  providerTransactionId = "",
  merchantReference = "",
  orderTrackingId = "",
  expiresAt = null
}) => {
  const canonicalAmount = decimalString(orderAmount ?? amount, { allowNegative: false, field: "orderAmount" });
  const canonicalCurrency = requireCurrency(orderCurrency || currency);
  const intentId = `pay_${uuidv4()}`;
  const createdAt = new Date();
  return Payment.create({
    bookingReference,
    customerId,
    amount: toLegacyNumber(canonicalAmount),
    currency: canonicalCurrency,
    orderAmount: decimalOrNull(canonicalAmount),
    orderCurrency: canonicalCurrency,
    provider,
    intentId,
    attemptId: intentId,
    providerTransactionId: normalizeToken(providerTransactionId || orderTrackingId),
    merchantReference: normalizeToken(merchantReference || bookingReference),
    orderTrackingId: normalizeToken(orderTrackingId || providerTransactionId),
    status: "initiated",
    paymentStatus: "initiated",
    providerStatus: "ORDER_CREATED",
    verificationStatus: "pending",
    verificationReason: "Awaiting server-side provider verification",
    accountingAllocationStatus: "pending",
    bokunSyncStatus: "not_started",
    attemptSnapshot: {
      attemptId: intentId,
      merchantReference: normalizeToken(merchantReference || bookingReference),
      provider,
      orderAmount: decimalOrNull(canonicalAmount),
      orderCurrency: canonicalCurrency,
      createdAt,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      status: "initiated"
    },
    notes,
    providerResponse: {
      abstraction: "Payment provider integration placeholder",
      nextProviders: ["pesapal", "stripe", "manual_bank", "cash_on_arrival"]
    },
    transactionHistory: [
      buildTransactionHistoryPush({
        event: "payment_initiated",
        status: "initiated",
        source: "checkout",
        description: "Payment intent created before gateway redirect"
      })
    ]
  });
};

const updatePaymentStatus = async ({
  intentId,
  status,
  paidAmount = 0,
  amountPaid = undefined,
  refundedAmount = 0,
  providerResponse = {},
  providerTransactionId = undefined,
  merchantReference = undefined,
  orderTrackingId = undefined,
  paidAt = undefined,
  lastVerifiedAt = undefined,
  rawResponse = undefined,
  ipnEvent = null,
  notes = "",
  event = "status_updated",
  eventSource = "system",
  eventDescription = "",
  eventMetadata = {},
  ...canonical
}) => {
  const paidValue = amountPaid !== undefined ? toNumber(amountPaid) : toNumber(paidAmount);
  const update = {
    $set: {
      status,
      paidAmount: toNumber(paidAmount || paidValue),
      amountPaid: paidValue,
      refundedAmount: toNumber(refundedAmount),
      paymentStatus: status,
      ...buildCanonicalSet(canonical),
      ...buildGatewaySet({
        providerTransactionId,
        merchantReference,
        orderTrackingId,
        paidAt,
        lastVerifiedAt,
        rawResponse,
        providerResponse,
        notes
      })
    }
  };
  const ipnPush = buildIpnPush(ipnEvent);
  if (ipnPush) {
    update.$push = { ipnEvents: ipnPush };
  }

  appendPaymentEvent(update, {
    event,
    status,
    source: eventSource,
    description: eventDescription,
    metadata: eventMetadata
  });

  const query = { intentId };
  if (status !== "paid" && !canReplacePaidStatus(status)) {
    query.status = { $ne: "paid" };
  }

  const updated = await Payment.findOneAndUpdate(query, update, { new: true });
  return updated || Payment.findOne({ intentId });
};

const findLatestPaymentByBookingReference = async ({ bookingReference, provider = "" }) => {
  const query = {
    bookingReference: String(bookingReference || "")
  };

  if (provider) {
    query.provider = String(provider || "");
  }

  return Payment.findOne(query).sort({ createdAt: -1 });
};

const updatePaymentByBookingReference = async ({
  bookingReference,
  provider = "",
  status,
  paidAmount = 0,
  amountPaid = undefined,
  refundedAmount = 0,
  providerResponse = {},
  notes = "",
  providerTransactionId = undefined,
  merchantReference = undefined,
  orderTrackingId = undefined,
  paidAt = undefined,
  lastVerifiedAt = undefined,
  rawResponse = undefined,
  ipnEvent = null,
  event = "status_updated",
  eventSource = "system",
  eventDescription = "",
  eventMetadata = {},
  ...canonical
}) => {
  const query = {
    bookingReference: String(bookingReference || "")
  };

  if (provider) {
    query.provider = String(provider || "");
  }

  if (orderTrackingId) {
    query.$or = [
      { orderTrackingId: normalizeToken(orderTrackingId) },
      { providerTransactionId: normalizeToken(orderTrackingId) }
    ];
  }

  const paidValue = amountPaid !== undefined ? toNumber(amountPaid) : toNumber(paidAmount);
  const update = {
    $set: {
      status,
      paidAmount: toNumber(paidAmount || paidValue),
      amountPaid: paidValue,
      refundedAmount: toNumber(refundedAmount),
      paymentStatus: status,
      ...buildCanonicalSet(canonical),
      ...buildGatewaySet({
        providerTransactionId,
        merchantReference,
        orderTrackingId,
        paidAt,
        lastVerifiedAt,
        rawResponse,
        providerResponse,
        notes
      })
    }
  };
  const ipnPush = buildIpnPush(ipnEvent);
  if (ipnPush) {
    update.$push = { ipnEvents: ipnPush };
  }

  appendPaymentEvent(update, {
    event,
    status,
    source: eventSource,
    description: eventDescription,
    metadata: eventMetadata
  });

  const protectedQuery = { ...query };
  if (status !== "paid" && !canReplacePaidStatus(status)) {
    protectedQuery.status = { $ne: "paid" };
  }

  const updated = await Payment.findOneAndUpdate(
    protectedQuery,
    update,
    { new: true, sort: { createdAt: -1 } }
  );

  return updated || Payment.findOne(query).sort({ createdAt: -1 });
};

const findPaymentByGatewayIdentifiers = async ({
  provider = "",
  bookingReference = "",
  orderTrackingId = "",
  merchantReference = ""
} = {}) => {
  const providerToken = normalizeToken(provider);
  const query = providerToken ? { provider: providerToken } : {};
  if (bookingReference) query.bookingReference = normalizeToken(bookingReference);
  if (orderTrackingId) {
    query.$or = [
      { orderTrackingId: normalizeToken(orderTrackingId) },
      { providerTransactionId: normalizeToken(orderTrackingId) }
    ];
  }
  if (merchantReference) {
    query.merchantReference = normalizeToken(merchantReference);
  }
  if (!bookingReference && !orderTrackingId && !merchantReference) {
    return null;
  }
  return Payment.findOne(query).sort({ createdAt: -1 });
};

const getVerifiedPaidAmountByBookingReference = async ({ bookingReference, provider = "" } = {}) => {
  const query = {
    bookingReference: normalizeToken(bookingReference),
    status: "paid"
  };

  if (provider) {
    query.provider = normalizeToken(provider);
  }

  const rows = await Payment.find(query)
    .sort({ lastVerifiedAt: -1, updatedAt: -1 })
    .lean();

  // A booking may have a verified original payment and one or more verified
  // adjustments. Each intent is counted once, even if its webhook was retried.
  return calculateVerifiedPaidAmount(rows);
};

const getVerifiedAccountingSummary = async ({ bookingReference, provider = "", fallbackCurrency = "" } = {}) => {
  const query = { bookingReference: normalizeToken(bookingReference), status: "paid" };
  if (provider) query.provider = normalizeToken(provider);
  const rows = await Payment.find(query).sort({ lastVerifiedAt: -1, updatedAt: -1 }).lean();
  const byIntent = new Map();

  rows.forEach((row) => {
    const canonical = hasCanonicalMoney(row);
    if (canonical && !isCanonicallyAllocated(row)) return;
    const amount = canonical
      ? decimalToApi(row.accountingAmount, "0")
      : decimalString(row.amountPaid ?? row.paidAmount ?? 0);
    if (!toDecimal(amount).greaterThan(0)) return;
    const currency = normalizeCurrency(
      canonical ? row.accountingCurrency : row.currency || fallbackCurrency
    );
    if (!currency) {
      throw new AppError("Paid payment has no valid accounting currency", 409, "ACCOUNTING_CURRENCY_INVALID");
    }
    const key = String(row.intentId || row.providerTransactionId || row.orderTrackingId || row._id);
    const existing = byIntent.get(key);
    if (!existing || toDecimal(amount).greaterThan(toDecimal(existing.amount))) {
      byIntent.set(key, { amount, currency });
    }
  });

  const currencies = new Set(Array.from(byIntent.values()).map((entry) => entry.currency));
  if (currencies.size > 1) {
    throw new AppError("Payments cannot be combined across accounting currencies", 409, "ACCOUNTING_CURRENCY_CONFLICT");
  }
  const amount = Array.from(byIntent.values())
    .reduce((sum, entry) => sum.plus(toDecimal(entry.amount)), new Decimal(0))
    .toFixed();
  return {
    amount,
    currency: Array.from(currencies)[0] || normalizeCurrency(fallbackCurrency) || "",
    paymentCount: byIntent.size
  };
};

const applyVerifiedPaymentAllocation = async ({ paymentId, bookingReference = "", metadata = {} } = {}) => {
  const payment = paymentId
    ? await Payment.findById(paymentId)
    : await Payment.findOne({
        bookingReference: normalizeToken(bookingReference),
        status: "paid",
        verificationStatus: "verified"
      }).sort({ lastVerifiedAt: -1, updatedAt: -1 });

  if (!payment) {
    throw new AppError("Verified payment record is required before invoice allocation", 409, "PAYMENT_VERIFICATION_REQUIRED");
  }
  if (payment.status !== "paid" || payment.verificationStatus !== "verified") {
    throw new AppError("Payment cannot be allocated before provider verification", 409, "PAYMENT_NOT_VERIFIED_FOR_ALLOCATION");
  }

  const amount = decimalToApi(payment.accountingAmount);
  const currency = normalizeCurrency(payment.accountingCurrency);
  const orderCurrency = normalizeCurrency(payment.orderCurrency);
  if (!amount || !toDecimal(amount).greaterThan(0) || !currency || currency !== orderCurrency) {
    await Payment.findByIdAndUpdate(payment._id, {
      $set: {
        accountingAllocationStatus: "blocked",
        verificationReason: "Accounting amount or currency does not match the immutable order"
      }
    });
    throw new AppError("Payment accounting allocation requires review", 409, "PAYMENT_ALLOCATION_BLOCKED");
  }

  const allocationKey = `payment:${payment._id}:invoice:${payment.bookingReference}`;
  const idempotencyKey = `allocation-${payment.intentId || payment._id}`;
  const allocation = await PaymentAllocation.findOneAndUpdate(
    { allocationKey },
    {
      $setOnInsert: {
        allocationKey,
        paymentId: payment._id,
        bookingReference: payment.bookingReference,
        amount: decimalOrNull(amount),
        currency,
        chargedAmount: decimalOrNull(payment.chargedAmount),
        chargedCurrency: normalizeCurrency(payment.chargedCurrency),
        historicalFxRate: decimalOrNull(payment.fxRate),
        status: "pending",
        idempotencyKey,
        metadata
      }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  if (
    decimalToApi(allocation.amount) !== amount ||
    normalizeCurrency(allocation.currency) !== currency ||
    String(allocation.paymentId) !== String(payment._id)
  ) {
    await Payment.findByIdAndUpdate(payment._id, {
      $set: {
        accountingAllocationStatus: "blocked",
        verificationReason: "Existing invoice allocation does not match this payment"
      }
    });
    throw new AppError("Existing payment allocation does not match", 409, "PAYMENT_ALLOCATION_CONFLICT");
  }

  const appliedAt = allocation.appliedAt || new Date();
  await PaymentAllocation.updateOne(
    { _id: allocation._id, status: { $in: ["pending", "applied"] } },
    { $set: { status: "applied", appliedAt } }
  );
  await Payment.updateOne(
    { _id: payment._id, verificationStatus: "verified", status: "paid" },
    {
      $set: {
        accountingAllocationStatus: "applied",
        accountingAllocatedAt: appliedAt,
        invoiceStatus: "allocated"
      }
    }
  );

  return Payment.findById(payment._id);
};

const blockPaymentAllocation = async ({ paymentId, verificationStatus, reason = "" } = {}) =>
  Payment.findByIdAndUpdate(
    paymentId,
    {
      $set: {
        verificationStatus,
        verificationReason: String(reason || "").slice(0, 500),
        accountingAllocationStatus: "blocked",
        bokunSyncStatus: "not_started"
      }
    },
    { new: true }
  );

const assertBokunFinalizationEligibility = async ({ bookingReference } = {}) => {
  const rows = await Payment.find({
    bookingReference: normalizeToken(bookingReference),
    status: "paid"
  }).lean();
  const canonicalRows = rows.filter(hasCanonicalMoney);
  if (!canonicalRows.length) {
    const legacyAmount = calculateVerifiedPaidAmount(rows);
    if (legacyAmount <= 0) {
      throw new AppError("Verified payment record is required before Bokun finalization", 409, "PAYMENT_RECORD_NOT_VERIFIED_FOR_FINALIZATION");
    }
    return { amount: String(legacyAmount), legacy: true, payments: rows };
  }

  const eligibleRows = canonicalRows.filter(isCanonicallyAllocated);
  if (!eligibleRows.length) {
    throw new AppError(
      "Provider verification and invoice allocation must complete before Bokun finalization",
      409,
      "PAYMENT_ALLOCATION_NOT_VERIFIED_FOR_FINALIZATION"
    );
  }
  const currencies = new Set(eligibleRows.map((row) => normalizeCurrency(row.accountingCurrency)).filter(Boolean));
  if (currencies.size !== 1) {
    throw new AppError("Allocated payments use conflicting accounting currencies", 409, "PAYMENT_ALLOCATION_CURRENCY_CONFLICT");
  }
  const total = eligibleRows
    .reduce((sum, row) => sum.plus(toDecimal(decimalToApi(row.accountingAmount, "0"))), new Decimal(0))
    .toFixed();
  if (!toDecimal(total).greaterThan(0)) {
    throw new AppError("Allocated payment amount must be positive", 409, "PAYMENT_ALLOCATION_AMOUNT_INVALID");
  }
  return { amount: total, currency: Array.from(currencies)[0], legacy: false, payments: eligibleRows };
};

const updatePaymentBokunSyncStatus = async ({ bookingReference, status }) =>
  Payment.updateMany(
    {
      bookingReference: normalizeToken(bookingReference),
      status: "paid",
      verificationStatus: "verified",
      accountingAllocationStatus: "applied"
    },
    { $set: { bokunSyncStatus: normalizeToken(status) } }
  );

const linkAllocationsToInvoice = async ({ bookingReference, invoiceId }) => {
  if (!invoiceId) return;
  await PaymentAllocation.updateMany(
    { bookingReference: normalizeToken(bookingReference), status: "applied" },
    { $set: { invoiceId } }
  );
};

const markPaymentReviewed = async ({ bookingReference, reviewedBy = "", reviewNote = "" } = {}) =>
  Payment.findOneAndUpdate(
    { bookingReference: normalizeToken(bookingReference) },
    {
      $set: {
        "reconciliation.reviewed": true,
        "reconciliation.reviewedAt": new Date(),
        "reconciliation.reviewedBy": normalizeToken(reviewedBy),
        "reconciliation.reviewNote": String(reviewNote || "")
      }
    },
    { new: true, sort: { createdAt: -1 } }
  );

const extractProviderStatus = (payment = {}) => {
  const response = payment.rawResponse || payment.providerResponse?.response || {};
  return normalizeToken(
    response.payment_status_description ||
      response.payment_status ||
      response.status_description ||
      response.status ||
      payment.providerResponse?.stage ||
      payment.status ||
      ""
  );
};

const extractProviderAmount = (payment = {}) => {
  const response = payment.rawResponse || payment.providerResponse?.response || {};
  return toNumber(
    response.amount_paid ??
      response.amount ??
      response.payment_amount ??
      response.paymentAmount ??
      response.total_amount ??
      0
  );
};

const extractProviderCurrency = (payment = {}) => {
  const response = payment.rawResponse || payment.providerResponse?.response || {};
  return normalizeToken(response.currency || response.currency_code || payment.currency || "USD") || "USD";
};

const listPaymentReconciliation = async ({ limit = 100 } = {}) => {
  const safeLimit = Math.max(1, Math.min(200, Number(limit || 100)));
  const payments = await Payment.find({})
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(safeLimit)
    .lean();

  const paymentRefs = payments
    .map((payment) => normalizeToken(payment.bookingReference))
    .filter(Boolean);

  const bookings = await Booking.find({
    $or: [
      { bookingReference: { $in: paymentRefs.length ? paymentRefs : ["__none__"] } },
      {
        paymentStatus: "paid",
        $or: [{ bokunBookingId: { $exists: false } }, { bokunBookingId: "" }]
      },
      {
        paymentStatus: "paid",
        "invoiceSnapshot.amountPaid": { $lte: 0 }
      }
    ]
  })
    .sort({ updatedAt: -1 })
    .limit(safeLimit)
    .lean();

  const refs = Array.from(
    new Set([
      ...paymentRefs,
      ...bookings.map((booking) => normalizeToken(booking.bookingReference)).filter(Boolean)
    ])
  );

  const invoices = refs.length
    ? await Invoice.find({ bookingReference: { $in: refs } }).lean()
    : [];

  const paymentsByRef = payments.reduce((map, payment) => {
    const ref = normalizeToken(payment.bookingReference);
    if (!ref) return map;
    if (!map.has(ref)) map.set(ref, []);
    map.get(ref).push(payment);
    return map;
  }, new Map());
  const bookingsByRef = new Map(bookings.map((booking) => [normalizeToken(booking.bookingReference), booking]));
  const invoicesByRef = new Map(invoices.map((invoice) => [normalizeToken(invoice.bookingReference), invoice]));

  return refs.map((bookingReference) => {
    const refPayments = paymentsByRef.get(bookingReference) || [];
    const latestPayment = refPayments[0] || null;
    const booking = bookingsByRef.get(bookingReference) || null;
    const invoice = invoicesByRef.get(bookingReference) || null;
    const invoiceSnapshot = booking?.invoiceSnapshot || {};
    const verifiedPaidAmount = calculateVerifiedPaidAmount(refPayments);
    const invoicePaidAmount = toNumber(invoice?.amountPaid ?? invoiceSnapshot.amountPaid);
    const expectedAmount = toNumber(
      decimalToApi(latestPayment?.orderAmount) ||
        booking?.amount ||
        booking?.pricingSnapshot?.finalPayable ||
        invoice?.total ||
        latestPayment?.amount ||
        0
    );
    const supplierStatus = booking?.bokunBookingId
      ? "confirmed"
      : booking?.supplierStatus ||
        (booking?.paymentStatus === "paid"
          ? "supplier_pending"
          : "awaiting_payment");
    const bokunLastError = booking?.pendingCheckout?.finalization?.lastError || {};
    const localPaymentStatus = latestPayment?.status || booking?.paymentStatus || "unknown";
    const invoiceStatus = invoice?.paymentStatus || invoiceSnapshot.paymentStatus || "missing";
    const needsAttention =
      localPaymentStatus === "paid" &&
      (invoiceStatus !== "paid" || invoicePaidAmount <= 0 || supplierStatus !== "confirmed");

    return {
      bookingReference,
      bookingId: booking?._id || "",
      paymentId: latestPayment?._id || "",
      provider: latestPayment?.provider || booking?.paymentMethod || "pesapal",
      paymentMethod: latestPayment?.paymentMethod || booking?.paymentMethod || "",
      pesapalStatus: extractProviderStatus(latestPayment || {}),
      providerStatus: latestPayment?.providerStatus || extractProviderStatus(latestPayment || {}),
      localPaymentStatus,
      verificationStatus: latestPayment?.verificationStatus || (latestPayment?.status === "paid" ? "legacy_verified" : "pending"),
      verificationReason: latestPayment?.verificationReason || "",
      accountingAllocationStatus: latestPayment?.accountingAllocationStatus || (latestPayment?.status === "paid" ? "legacy" : "pending"),
      invoiceStatus,
      bokunSupplierStatus: supplierStatus,
      bokunBookingId: booking?.bokunBookingId || "",
      bokunFailureCode: String(bokunLastError?.code || booking?.pendingCheckout?.finalizationErrorCode || ""),
      bokunFailureReason: String(
        bokunLastError?.message || booking?.supplierFailureReason || booking?.pendingCheckout?.finalizationError || ""
      ),
      bokunMissingQuestions: Array.isArray(bokunLastError?.missingQuestions)
        ? bokunLastError.missingQuestions
        : [],
      expectedAmount,
      orderAmount: decimalToApi(latestPayment?.orderAmount, String(expectedAmount)),
      orderCurrency: latestPayment?.orderCurrency || booking?.currency || latestPayment?.currency || "USD",
      chargedAmount: decimalToApi(latestPayment?.chargedAmount, String(extractProviderAmount(latestPayment || {}))),
      chargedCurrency: latestPayment?.chargedCurrency || extractProviderCurrency(latestPayment || {}),
      accountingAmount: decimalToApi(latestPayment?.accountingAmount, String(verifiedPaidAmount || invoicePaidAmount || 0)),
      accountingCurrency: latestPayment?.accountingCurrency || booking?.currency || latestPayment?.currency || "USD",
      settlementAmount: decimalToApi(latestPayment?.settlementAmount),
      settlementCurrency: latestPayment?.settlementCurrency || "",
      providerFeeAmount: decimalToApi(latestPayment?.providerFeeAmount),
      providerFeeCurrency: latestPayment?.providerFeeCurrency || "",
      fxRate: decimalToApi(latestPayment?.fxRate),
      fxSourceCurrency: latestPayment?.fxSourceCurrency || "",
      fxTargetCurrency: latestPayment?.fxTargetCurrency || "",
      fxSource: latestPayment?.fxSource || "none",
      gatewayVerifiedAmount: decimalToApi(latestPayment?.chargedAmount, String(extractProviderAmount(latestPayment || {}))),
      gatewayVerifiedCurrency: latestPayment?.chargedCurrency || extractProviderCurrency(latestPayment || {}),
      paidAmount: verifiedPaidAmount || invoicePaidAmount || toNumber(latestPayment?.amountPaid || latestPayment?.paidAmount),
      currency: booking?.currency || invoice?.currency || latestPayment?.currency || "USD",
      lastVerifiedAt: latestPayment?.lastVerifiedAt || latestPayment?.updatedAt || "",
      orderTrackingId: latestPayment?.orderTrackingId || latestPayment?.providerTransactionId || booking?.paymentTransactionId || "",
      merchantReference: latestPayment?.merchantReference || bookingReference,
      productTitle: booking?.productTitle || invoice?.tourName || "",
      travelDate: booking?.travelDate || invoice?.tourDate || "",
      reviewed: Boolean(latestPayment?.reconciliation?.reviewed),
      reviewedAt: latestPayment?.reconciliation?.reviewedAt || "",
      reviewNote: latestPayment?.reconciliation?.reviewNote || "",
      refundStatus: latestPayment?.refundStatus || "not_required",
      anomaly: latestPayment?.anomaly || { flagged: false },
      needsAttention
    };
  });
};

const listPayments = async () => {
  return Payment.find({}).sort({ createdAt: -1 }).lean();
};

const getPublicPaymentProviders = () => [
  {
    id: "pesapal",
    enabled: Boolean(isPesapalConfigured || env.PESAPAL_MOCK_MODE),
    mode: env.PESAPAL_MOCK_MODE ? "test" : isPesapalConfigured ? "live" : "unavailable",
    unavailableReason: "Pesapal is not configured yet."
  },
  {
    id: "dpo",
    enabled: Boolean(isDpoConfigured || env.DPO_MOCK_MODE),
    mode: env.DPO_MOCK_MODE ? "test" : isDpoConfigured ? "live" : "unavailable",
    unavailableReason: "DPO is not configured yet."
  },
  {
    id: "paypal",
    enabled: Boolean(isPaypalConfigured || env.PAYPAL_MOCK_MODE),
    mode: env.PAYPAL_MOCK_MODE ? "test" : isPaypalConfigured ? "live" : "unavailable",
    unavailableReason: "PayPal is not configured yet."
  }
];

module.exports = {
  createPaymentIntent,
  updatePaymentStatus,
  findLatestPaymentByBookingReference,
  updatePaymentByBookingReference,
  findPaymentByGatewayIdentifiers,
  getVerifiedPaidAmountByBookingReference,
  getVerifiedAccountingSummary,
  applyVerifiedPaymentAllocation,
  assertBokunFinalizationEligibility,
  blockPaymentAllocation,
  updatePaymentBokunSyncStatus,
  linkAllocationsToInvoice,
  sanitizeProviderPayload,
  markPaymentReviewed,
  listPaymentReconciliation,
  listPayments,
  getPublicPaymentProviders,
  __testables: {
    calculateVerifiedPaidAmount,
    canReplacePaidStatus,
    hasCanonicalMoney,
    isCanonicallyAllocated,
    accountingValue,
    buildCanonicalSet
  }
};
