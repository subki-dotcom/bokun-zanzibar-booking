const ROLES = {
  SUPER_ADMIN: "super_admin",
  ADMIN: "admin",
  STAFF: "staff",
  AGENT: "agent",
  // Tour operations only: website and Agent Portal tour bookings and their customer requests.
  TOUR_ADMIN: "tour_admin"
};

// Where a booking entered the system. Set once at creation and never changed by synchronization.
// It is not the sales channel (who sold it), operationalSource (whether Bókun evidence exists),
// createdByRole (who submitted it) or the supplier status.
const BOOKING_ORIGIN = Object.freeze({
  WEBSITE: "WEBSITE",
  AGENT_PORTAL: "AGENT_PORTAL",
  BOKUN_IMPORT: "BOKUN_IMPORT"
});

const BOOKING_STATUS = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
  CANCELLED: "cancelled",
  FAILED: "failed",
  EDIT_REQUESTED: "edit_requested"
};

const PAYMENT_STATUS = {
  INITIATED: "initiated",
  PROCESSING: "processing",
  PENDING: "pending",
  PARTIAL: "partial",
  PAID: "paid",
  FAILED: "failed",
  REVERSED: "reversed",
  VERIFICATION_ERROR: "verification_error",
  REFUNDED: "refunded",
  PARTIALLY_REFUNDED: "partially_refunded",
  OVERPAID: "overpaid"
};

module.exports = {
  ROLES,
  BOOKING_ORIGIN,
  BOOKING_STATUS,
  PAYMENT_STATUS
};
