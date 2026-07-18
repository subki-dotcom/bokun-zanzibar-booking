const ROLES = {
  SUPER_ADMIN: "super_admin",
  ADMIN: "admin",
  STAFF: "staff",
  AGENT: "agent"
};

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
  BOOKING_STATUS,
  PAYMENT_STATUS
};
