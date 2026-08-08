const dayjs = require("dayjs");
const Invoice = require("../../models/Invoice");
const Refund = require("../../models/Refund");
const { env } = require("../../config/env");
const paymentsService = require("../payments");
const { Decimal, decimalString, normalizeCurrency, toDecimal } = require("../../utils/money");

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
  const isCancelled = String(bookingStatus || "").toLowerCase() === "cancelled";
  const normalizedBookingPaymentStatus = String(bookingPaymentStatus || "").toLowerCase();
  const balanceDueDecimal = isCancelled
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
  const invoiceCurrency = normalizeCurrency(booking.currency || booking.pricingSnapshot?.currency || "USD");
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
    verifiedPaidAmount,
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
  const existing = await Invoice.findOne({ bookingReference: invoiceSnapshot.bookingReference });

  if (!existing) {
    return persistInvoiceFromSnapshot(invoiceSnapshot);
  }

  existing.paymentStatus = invoiceSnapshot.paymentStatus;
  existing.bookingStatus = invoiceSnapshot.bookingStatus;
  existing.clientName = invoiceSnapshot.clientName;
  existing.clientPhone = invoiceSnapshot.clientPhone;
  existing.clientEmail = invoiceSnapshot.clientEmail;
  existing.clientCountry = invoiceSnapshot.clientCountry;
  existing.hotelName = invoiceSnapshot.hotelName;
  existing.tourName = invoiceSnapshot.tourName;
  existing.bookedOption = invoiceSnapshot.bookedOption;
  existing.tourDate = invoiceSnapshot.tourDate;
  existing.pickupTime = invoiceSnapshot.pickupTime;
  existing.pickupLocation = invoiceSnapshot.pickupLocation;
  existing.dropoffLocation = invoiceSnapshot.dropoffLocation;
  existing.duration = invoiceSnapshot.duration;
  existing.adults = invoiceSnapshot.adults;
  existing.children = invoiceSnapshot.children;
  existing.totalPax = invoiceSnapshot.totalPax;
  existing.guideLanguage = invoiceSnapshot.guideLanguage;
  existing.included = invoiceSnapshot.included;
  existing.excluded = invoiceSnapshot.excluded;
  existing.items = invoiceSnapshot.items;
  existing.subtotal = invoiceSnapshot.subtotal;
  existing.discount = invoiceSnapshot.discount;
  existing.tax = invoiceSnapshot.tax;
  existing.total = invoiceSnapshot.total;
  existing.amountPaid = invoiceSnapshot.amountPaid;
  existing.amountRefunded = invoiceSnapshot.amountRefunded;
  existing.netAmountPaid = invoiceSnapshot.netAmountPaid;
  existing.balanceDue = invoiceSnapshot.balanceDue;
  existing.accountingCurrency = invoiceSnapshot.accountingCurrency;
  existing.totalAmount = invoiceSnapshot.totalAmount;
  existing.paidAccountingAmount = invoiceSnapshot.paidAccountingAmount;
  existing.refundedAccountingAmount = invoiceSnapshot.refundedAccountingAmount;
  existing.netAccountingAmount = invoiceSnapshot.netAccountingAmount;
  existing.balanceDueAmount = invoiceSnapshot.balanceDueAmount;
  existing.paymentMethod = invoiceSnapshot.paymentMethod;
  existing.notes = invoiceSnapshot.notes;
  existing.cancellationPolicy = invoiceSnapshot.cancellationPolicy;
  existing.paymentTerms = invoiceSnapshot.paymentTerms;
  await existing.save();

  return existing.toObject();
};

const getInvoiceByBookingReference = async (bookingReference) => {
  return Invoice.findOne({ bookingReference }).lean();
};

const getInvoiceByNumber = async (invoiceNumber) => {
  return Invoice.findOne({ invoiceNumber }).lean();
};

module.exports = {
  buildInvoiceSnapshot,
  persistInvoiceFromSnapshot,
  upsertInvoiceFromSnapshot,
  getInvoiceByBookingReference,
  getInvoiceByNumber,
  __testables: {
    resolveInvoiceAccounting
  }
};
