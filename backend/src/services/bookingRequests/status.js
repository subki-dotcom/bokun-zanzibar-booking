const AppError = require("../../utils/AppError");

const ACTIVE_REQUEST_STATUSES = [
  "submitted",
  "under_review",
  "awaiting_customer_information",
  "awaiting_availability_check",
  "awaiting_additional_payment",
  "approved",
  "processing"
];

const ALLOWED_TRANSITIONS = {
  submitted: ["under_review", "awaiting_customer_information", "awaiting_availability_check", "rejected", "cancelled_by_customer"],
  under_review: ["awaiting_customer_information", "awaiting_availability_check", "awaiting_additional_payment", "approved", "rejected", "processing", "failed"],
  awaiting_customer_information: ["under_review", "cancelled_by_customer", "rejected"],
  awaiting_availability_check: ["under_review", "approved", "rejected", "failed"],
  awaiting_additional_payment: ["processing", "approved", "rejected", "cancelled_by_customer", "failed"],
  approved: ["processing", "awaiting_additional_payment", "completed", "failed"],
  processing: ["completed", "failed", "approved"],
  failed: ["under_review", "processing", "rejected"],
  rejected: [],
  completed: [],
  cancelled_by_customer: []
};

const assertTransition = ({ from, to }) => {
  if (from === to) return;
  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    throw new AppError(`Request cannot move from ${from} to ${to}`, 409, "INVALID_REQUEST_STATUS_TRANSITION");
  }
};

module.exports = { ACTIVE_REQUEST_STATUSES, ALLOWED_TRANSITIONS, assertTransition };
