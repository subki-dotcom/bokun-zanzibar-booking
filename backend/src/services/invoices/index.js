const dayjs = require("dayjs");
const Invoice = require("../../models/Invoice");
const Refund = require("../../models/Refund");
const { env } = require("../../config/env");
const paymentsService = require("../payments");

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
  const subtotal = Number(booking.pricingSnapshot.grossAmount || 0);
  const discount = Number(booking.pricingSnapshot.discountAmount || 0);
  const tax = Number(((subtotal - discount) * env.TAX_PERCENT) / 100);
  const total = Number((subtotal - discount + tax).toFixed(2));
  const verifiedPaidAmount = await paymentsService.getVerifiedPaidAmountByBookingReference({
    bookingReference: booking.bookingReference
  });
  const refundRows = await Refund.aggregate([
    {
      $match: {
        bookingId: booking._id,
        status: { $in: ["refunded", "partially_refunded"] }
      }
    },
    { $group: { _id: null, amount: { $sum: "$amount" } } }
  ]);
  const amountPaid = Number(Math.max(0, verifiedPaidAmount).toFixed(2));
  const amountRefunded = Number(Math.min(amountPaid, Number(refundRows[0]?.amount || 0)).toFixed(2));
  const netAmountPaid = Number(Math.max(0, amountPaid - amountRefunded).toFixed(2));
  const balanceDue = Number(Math.max(0, total - netAmountPaid).toFixed(2));
  const paymentStatus =
    amountPaid <= 0
      ? (booking.paymentStatus === "failed" ? "failed" : "pending")
      : amountRefunded >= amountPaid
        ? "refunded"
        : amountRefunded > 0
          ? "partially_refunded"
          : netAmountPaid > total + 0.009
            ? "overpaid"
            : netAmountPaid >= total
              ? "paid"
              : "partial";

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
    paymentMethod: booking.paymentMethod || "pending",
    notes: "Thank you for booking with Zanzibar premium experiences.",
    cancellationPolicy:
      "Free cancellation up to 48 hours before departure unless supplier terms state otherwise.",
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
  getInvoiceByNumber
};
