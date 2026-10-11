// Single definition of "is this booking a sale?" and "is this invoice balance a receivable?" so Booking
// Accounting, Profitability, Receivables and Data Quality cannot disagree about the same booking.
//
// A sale is a booking the supplier has confirmed (confirmed / edit_requested), or a checkout the customer has
// already paid that is still awaiting supplier confirmation. Failed checkouts, unpaid abandoned checkouts and
// cancelled bookings are not sales; any money collected on them stays visible as cash, refunds or retained fees.

const SALE_BOOKING_STATUSES = Object.freeze(["confirmed", "edit_requested"]);
const NO_RECEIVABLE_BOOKING_STATUSES = Object.freeze(["cancelled", "failed"]);

const normalizeStatus = (value = "") => String(value || "").trim().toLowerCase();
const toAmount = (value) => {
  const parsed = Number(value?.toString?.() ?? value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isSaleBooking = ({ bookingStatus = "", collectedAmount = 0 } = {}) => {
  const status = normalizeStatus(bookingStatus);
  // Records without a booking status are kept visible rather than silently dropped.
  if (!status || status === "unknown") return true;
  if (SALE_BOOKING_STATUSES.includes(status)) return true;
  return status === "pending" && toAmount(collectedAmount) > 0;
};

// An unpaid balance is owed by the customer only when the booking is a sale.
const isReceivableInvoice = (invoice = {}) =>
  isSaleBooking({
    bookingStatus: invoice.bookingStatus,
    collectedAmount: invoice.paidAccountingAmount ?? invoice.amountPaid
  });

// Failed and cancelled bookings never carry a customer balance.
const bookingStatusClearsBalance = (bookingStatus = "") =>
  NO_RECEIVABLE_BOOKING_STATUSES.includes(normalizeStatus(bookingStatus));

module.exports = {
  NO_RECEIVABLE_BOOKING_STATUSES,
  SALE_BOOKING_STATUSES,
  bookingStatusClearsBalance,
  isReceivableInvoice,
  isSaleBooking
};
