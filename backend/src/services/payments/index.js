const { v4: uuidv4 } = require("uuid");
const Payment = require("../../models/Payment");
const Booking = require("../../models/Booking");
const Invoice = require("../../models/Invoice");
const { env, isDpoConfigured, isPesapalConfigured, isPaypalConfigured } = require("../../config/env");

const toNumber = (value = 0) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeToken = (value = "") => String(value || "").trim();

const calculateVerifiedPaidAmount = (rows = []) => {
  const paidByIntent = new Map();
  rows
    .filter((row) => row?.status === "paid")
    .forEach((row) => {
      const intentKey = String(row.intentId || row.providerTransactionId || row.orderTrackingId || row._id);
      const paid = toNumber(row.amountPaid ?? row.paidAmount);
      paidByIntent.set(intentKey, Math.max(paidByIntent.get(intentKey) || 0, paid));
    });
  return Array.from(paidByIntent.values()).reduce((total, paid) => total + paid, 0);
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
    $set.rawResponse = rawResponse;
  }
  if (providerResponse !== undefined) {
    $set.providerResponse = providerResponse;
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
    raw: ipnEvent.raw || {}
  };
};

const createPaymentIntent = async ({
  bookingReference,
  customerId,
  amount,
  currency,
  provider = "custom",
  notes = "",
  providerTransactionId = "",
  merchantReference = "",
  orderTrackingId = ""
}) => {
  return Payment.create({
    bookingReference,
    customerId,
    amount,
    currency,
    provider,
    intentId: `pay_${uuidv4()}`,
    providerTransactionId: normalizeToken(providerTransactionId || orderTrackingId),
    merchantReference: normalizeToken(merchantReference || bookingReference),
    orderTrackingId: normalizeToken(orderTrackingId || providerTransactionId),
    status: "pending",
    notes,
    providerResponse: {
      abstraction: "Payment provider integration placeholder",
      nextProviders: ["pesapal", "stripe", "manual_bank", "cash_on_arrival"]
    }
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
  notes = ""
}) => {
  const paidValue = amountPaid !== undefined ? toNumber(amountPaid) : toNumber(paidAmount);
  const update = {
    $set: {
      status,
      paidAmount: toNumber(paidAmount || paidValue),
      amountPaid: paidValue,
      refundedAmount: toNumber(refundedAmount),
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

  return Payment.findOneAndUpdate(
    { intentId },
    update,
    { new: true }
  );
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
  ipnEvent = null
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
      { providerTransactionId: normalizeToken(orderTrackingId) },
      { bookingReference: String(bookingReference || "") }
    ];
  }

  const paidValue = amountPaid !== undefined ? toNumber(amountPaid) : toNumber(paidAmount);
  const update = {
    $set: {
      status,
      paidAmount: toNumber(paidAmount || paidValue),
      amountPaid: paidValue,
      refundedAmount: toNumber(refundedAmount),
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

  return Payment.findOneAndUpdate(
    query,
    update,
    { new: true, sort: { createdAt: -1 } }
  );
};

const findPaymentByGatewayIdentifiers = async ({
  provider = "",
  bookingReference = "",
  orderTrackingId = "",
  merchantReference = ""
} = {}) => {
  const providerToken = normalizeToken(provider);
  const filters = [];

  if (bookingReference) {
    filters.push({ bookingReference: normalizeToken(bookingReference) });
  }
  if (orderTrackingId) {
    filters.push({ orderTrackingId: normalizeToken(orderTrackingId) });
    filters.push({ providerTransactionId: normalizeToken(orderTrackingId) });
  }
  if (merchantReference) {
    filters.push({ merchantReference: normalizeToken(merchantReference) });
    filters.push({ bookingReference: normalizeToken(merchantReference) });
  }

  if (!filters.length) {
    return null;
  }

  return Payment.findOne({
    ...(providerToken ? { provider: providerToken } : {}),
    $or: filters
  }).sort({ createdAt: -1 });
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
      booking?.amount ||
        booking?.pricingSnapshot?.finalPayable ||
        invoice?.total ||
        latestPayment?.amount ||
        0
    );
    const supplierStatus = booking?.bokunBookingId
      ? "confirmed"
      : booking?.paymentStatus === "paid"
        ? "pending"
        : booking?.bookingStatus || "unknown";
    const localPaymentStatus = latestPayment?.status || booking?.paymentStatus || "unknown";
    const invoiceStatus = invoice?.paymentStatus || invoiceSnapshot.paymentStatus || "missing";
    const needsAttention =
      localPaymentStatus === "paid" &&
      (invoiceStatus !== "paid" || invoicePaidAmount <= 0 || supplierStatus === "pending");

    return {
      bookingReference,
      bookingId: booking?._id || "",
      paymentId: latestPayment?._id || "",
      provider: latestPayment?.provider || booking?.paymentMethod || "pesapal",
      pesapalStatus: extractProviderStatus(latestPayment || {}),
      localPaymentStatus,
      invoiceStatus,
      bokunSupplierStatus: supplierStatus,
      bokunBookingId: booking?.bokunBookingId || "",
      expectedAmount,
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
  markPaymentReviewed,
  listPaymentReconciliation,
  listPayments,
  getPublicPaymentProviders
};
