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
  PENDING: "pending",
  PARTIAL: "partial",
  PAID: "paid",
  FAILED: "failed",
  REFUNDED: "refunded"
};

module.exports = {
  ROLES,
  BOOKING_STATUS,
  PAYMENT_STATUS
};