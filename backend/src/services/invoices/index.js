const dayjs = require("dayjs");
const Booking = require("../../models/Booking");
const Invoice = require("../../models/Invoice");
const Refund = require("../../models/Refund");
const { env } = require("../../config/env");
const paymentsService = require("../payments");
const logger = require("../../config/logger");
const { Decimal, decimalString, normalizeCurrency, toDecimal } = require("../../utils/money");
const { resolveGuestPaymentPolicy } = require("../bookingPayment/policy");
const { bookingStatusClearsBalance } = require("../../accounting/salesPolicy");
const bookingAccess = require("../../security/bookingAccess");

const roundMoney = (value = 0) => Number(toDecimal(value).toDecimalPlaces(2).toFixed(2));

const resolveInvoiceAccounting = ({
  bookingStatus = "",
  bookingPaymentStatus = "",
  total = 0,
  verifiedPaidAmount = 0,
  confirmedRefundedAmount = 0
} = {}) => {
  const zero = new Decimal(0);
  const amountPaidDecimal = Decimal.max(zero, toDecimal(verifiedPaidAmount)).toDecimalPlaces(2);
  const amountRefundedDecimal = Decimal.min(
    amountPaidDecimal,
    Decimal.max(zero, toDecimal(confirmedRefundedAmount))
  ).toDecimalPlaces(2);
  const netAmountPaidDecimal = Decimal.max(zero, amountPaidDecimal.minus(amountRefundedDecimal)).toDecimalPlaces(2);
  const invoiceTotalDecimal = Decimal.max(zero, toDecimal(total)).toDecimalPlaces(2);
  const amountPaid = Number(amountPaidDecimal.toFixed(2));
  const amountRefunded = Number(amountRefundedDecimal.toFixed(2));
  const netAmountPaid = Number(netAmountPaidDecimal.toFixed(2));
  const invoiceTotal = Number(invoiceTotalDecimal.toFixed(2));
  // Cancelled and failed bookings are not sales, so the customer owes nothing on them.
  const clearsBalance = bookingStatusClearsBalance(bookingStatus);
  const normalizedBookingPaymentStatus = String(bookingPaymentStatus || "").toLowerCase();
  const balanceDueDecimal = clearsBalance
    ? zero
    : Decimal.max(zero, invoiceTotalDecimal.minus(netAmountPaidDecimal)).toDecimalPlaces(2);
  const balanceDue = Number(balanceDueDecimal.toFixed(2));
  const paymentStatus =
    amountPaid <= 0
      ? (normalizedBookingPaymentStatus === "failed" ? "failed" : "pending")
      : amountPaid > invoiceTotal + 0.009
        ? "overpaid"
        : amountPaid + 0.009 >= invoiceTotal
          ? "paid"
          : "partial";

  return {
    paymentStatus,
    amountPaid,
    amountRefunded,
    netAmountPaid,
    balanceDue,
    canonical: {
      totalAmount: invoiceTotalDecimal.toFixed(2),
      paidAccountingAmount: amountPaidDecimal.toFixed(2),
      refundedAccountingAmount: amountRefundedDecimal.toFixed(2),
      netAccountingAmount: netAmountPaidDecimal.toFixed(2),
      balanceDueAmount: balanceDueDecimal.toFixed(2)
    }
  };
};

const nextInvoiceNumber = async () => {
  const datePart = dayjs().format("YYYYMMDD");
  const prefix = `INV-${datePart}`;
  const countToday = await Invoice.countDocuments({ invoiceNumber: { $regex: `^${prefix}` } });
  return `${prefix}-${String(countToday + 1).padStart(4, "0")}`;
};

const buildInvoiceSnapshot = async ({ booking, productSnapshot }) => {
  const existingInvoice = await Invoice.findOne({ bookingReference: booking.bookingReference })
    .select("invoiceNumber")
    .lean();
  const invoiceNumber = existingInvoice?.invoiceNumber || (booking.invoiceSnapshot?.invoiceNumber) || await nextInvoiceNumber();
  const subtotalDecimal = toDecimal(booking.pricingSnapshot.grossAmount || 0);
  const discountDecimal = toDecimal(booking.pricingSnapshot.discountAmount || 0);
  const taxDecimal = subtotalDecimal
    .minus(discountDecimal)
    .times(toDecimal(env.TAX_PERCENT || 0))
    .dividedBy(100);
  const totalDecimal = subtotalDecimal.minus(discountDecimal).plus(taxDecimal).toDecimalPlaces(2);
  const subtotal = Number(subtotalDecimal.toFixed(2));
  const discount = Number(discountDecimal.toFixed(2));
  const tax = Number(taxDecimal.toFixed(2));
  const total = Number(totalDecimal.toFixed(2));
  const invoiceCurrency = normalizeCurrency(
    booking.transactionCurrency || booking.currency || booking.pricingSnapshot?.currency || "USD"
  );
  const paidSummary = await paymentsService.getVerifiedAccountingSummary({
    bookingReference: booking.bookingReference,
    fallbackCurrency: invoiceCurrency
  });
  if (paidSummary.currency && paidSummary.currency !== invoiceCurrency) {
    const error = new Error("Verified payment accounting currency does not match the invoice");
    error.code = "INVOICE_ACCOUNTING_CURRENCY_MISMATCH";
    throw error;
  }
  const verifiedPaidAmount = paidSummary.amount;
  const guestPayment = resolveGuestPaymentPolicy({
    booking,
    total,
    verifiedPaidAmount
  });
  const refundRows = await Refund.aggregate([
    {
      $match: {
        bookingId: booking._id,
        status: { $in: ["refunded", "partially_refunded"] }
      }
    },
    { $group: { _id: null, amount: { $sum: { $ifNull: ["$confirmedRefundedAmount", "$amount"] } } } }
  ]);
  const {
    paymentStatus,
    amountPaid,
    amountRefunded,
    netAmountPaid,
    balanceDue,
    canonical
  } = resolveInvoiceAccounting({
    bookingStatus: booking.bookingStatus,
    bookingPaymentStatus: booking.paymentStatus,
    total,
    verifiedPaidAmount: guestPayment.amountPaid,
    confirmedRefundedAmount: Number(refundRows[0]?.amount || 0)
  });

  const snapshot = {
    invoiceNumber,
    bookingReference: booking.bookingReference,
    issueDate: new Date(),
    paymentStatus,
    bookingStatus: booking.bookingStatus,
    clientName: booking.customer?.firstName
      ? `${booking.customer.firstName} ${booking.customer.lastName || ""}`.trim()
      : "",
    clientPhone: booking.customer?.phone || "",
    clientEmail: booking.customer?.email || "",
    clientCountry: booking.customer?.country || "",
    hotelName: booking.customer?.hotelName || "",
    tourName: booking.productTitle,
    bookedOption: booking.optionTitle,
    tourDate: booking.travelDate,
    pickupTime: booking.startTime,
    pickupLocation: booking.customer?.hotelName || booking.bookingQuestionsSnapshot?.find((q) => q.questionId === "pickup_location")?.answer || "",
    dropoffLocation: "",
    duration: productSnapshot?.duration || "",
    adults: booking.paxSummary?.adults || 0,
    children: booking.paxSummary?.children || 0,
    totalPax: booking.paxSummary?.total || 0,
    guideLanguage: booking.bookingQuestionsSnapshot?.find((q) => q.questionId === "guide_language")?.answer || "English",
    included: productSnapshot?.included || [],
    excluded: productSnapshot?.excluded || [],
    items: (booking.pricingSnapshot?.lineItems || []).map((item) => ({
      label: item.label,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.total
    })),
    subtotal,
    discount,
    tax,
    total,
    amountPaid,
    amountRefunded,
    netAmountPaid,
    balanceDue,
    guestPaymentCollector: guestPayment.collector,
    guestPaymentSource: guestPayment.source,
    transactionCurrency: invoiceCurrency,
    accountingCurrency: invoiceCurrency,
    totalAmount: canonical.totalAmount,
    paidAccountingAmount: canonical.paidAccountingAmount,
    refundedAccountingAmount: canonical.refundedAccountingAmount,
    netAccountingAmount: canonical.netAccountingAmount,
    balanceDueAmount: canonical.balanceDueAmount,
    paymentMethod: booking.paymentMethod || "pending",
    notes: "Thank you for booking with Zanzibar premium experiences.",
    cancellationPolicy:
      booking.cancellationPolicySnapshot?.policySummary ||
      booking.cancellationPolicySnapshot?.policyDescription ||
      "Cancellation terms are determined by the supplier policy for this booking.",
    paymentTerms: "Balance due as per selected payment method or prepayment policy."
  };

  return snapshot;
};

const persistInvoiceFromSnapshot = async (invoiceSnapshot) => {
  const invoice = await Invoice.create(invoiceSnapshot);
  return invoice.toObject();
};

const upsertInvoiceFromSnapshot = async (invoiceSnapshot) => {
  const bookingReference = String(invoiceSnapshot.bookingReference || "").trim();
  if (!bookingReference) throw new Error("Invoice bookingReference is required");
  const mutableSnapshot = { ...invoiceSnapshot };
  const invoiceNumber = mutableSnapshot.invoiceNumber;
  delete mutableSnapshot.invoiceNumber;
  delete mutableSnapshot.bookingReference;
  try {
    const invoice = await Invoice.findOneAndUpdate(
      { bookingReference },
      { $set: mutableSnapshot, $setOnInsert: { bookingReference, invoiceNumber } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    return typeof invoice?.toObject === "function" ? invoice.toObject() : invoice;
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const canonical = await Invoice.findOne({ bookingReference });
    if (!canonical) throw error;
    logger.warn("INVOICE_DUPLICATE_PREVENTED", { bookingReference, canonicalRecordId: String(canonical._id) });
    const recovered = await Invoice.findOneAndUpdate(
      { _id: canonical._id }, { $set: mutableSnapshot }, { new: true, runValidators: true }
    );
    return typeof recovered?.toObject === "function" ? recovered.toObject() : recovered;
  }
};

const getInvoiceByBookingReference = async (bookingReference) => {
  return Invoice.findOne({ bookingReference }).lean();
};

const getInvoiceByNumber = async (invoiceNumber) => {
  return Invoice.findOne({ invoiceNumber }).lean();
};

const INVOICE_LOOKUP_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;

// Invoice access follows booking access: neither the booking reference nor the invoice number is
// proof of ownership. Returns null for "missing" and "not allowed" alike.
const getAuthorizedInvoiceByBookingReference = async ({ bookingReference, auth = null, accessToken = "" } = {}) => {
  const reference = String(bookingReference || "").trim();
  if (!INVOICE_LOOKUP_PATTERN.test(reference)) return null;
  const booking = await Booking.findOne({ bookingReference: reference })
    .select("_id bookingReference agentId customerAccessVersion")
    .lean();
  const access = booking
    ? bookingAccess.resolveBookingAccess({ booking, auth, accessToken })
    : bookingAccess.isBackOfficeUser(auth) ? "back_office" : null;
  if (!access) return null;
  const invoice = await Invoice.findOne({ bookingReference: reference }).lean();
  if (!invoice) return null;
  return access === "back_office" ? { access, invoice } : { access, invoice: bookingAccess.toCustomerInvoice(invoice) };
};

const getAuthorizedInvoiceByNumber = async ({ invoiceNumber, auth = null } = {}) => {
  const number = String(invoiceNumber || "").trim();
  if (!INVOICE_LOOKUP_PATTERN.test(number)) return null;
  if (bookingAccess.isBackOfficeUser(auth)) {
    const invoice = await Invoice.findOne({ invoiceNumber: number }).lean();
    return invoice ? { access: "back_office", invoice } : null;
  }
  if (auth?.role !== "agent") return null;
  const invoice = await Invoice.findOne({ invoiceNumber: number }).lean();
  if (!invoice?.bookingReference) return null;
  // Standalone invoices and other Agents' bookings never match: the Agent must own the booking.
  const booking = await Booking.findOne({ bookingReference: invoice.bookingReference, agentId: auth.id })
    .select("_id agentId")
    .lean();
  if (!bookingAccess.isOwningAgent(auth, booking)) return null;
  return { access: "agent", invoice: bookingAccess.toCustomerInvoice(invoice) };
};

module.exports = {
  buildInvoiceSnapshot,
  persistInvoiceFromSnapshot,
  upsertInvoiceFromSnapshot,
  getInvoiceByBookingReference,
  getInvoiceByNumber,
  getAuthorizedInvoiceByBookingReference,
  getAuthorizedInvoiceByNumber,
  resolveInvoiceAccounting,
  __testables: {
    resolveInvoiceAccounting,
    resolveGuestPaymentPolicy
  }
};
