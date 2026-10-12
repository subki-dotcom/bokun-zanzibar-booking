// Tour Admin view rules. Everything here is derived from fields the Tour Operations API returns; nothing
// is inferred. In particular a booking is "supplier confirmed" only when the supplier status says so:
// a verified payment is never treated as Bókun confirmation.

export const TOUR_PERMISSIONS = Object.freeze({
  OPERATIONS_READ: "tour_operations.read",
  REQUESTS_READ: "tour_requests.read",
  REQUESTS_PROCESS: "tour_requests.process"
});

export const hasPermission = (user, permission) =>
  Array.isArray(user?.permissions) && user.permissions.includes(permission);

export const TOUR_ADMIN_HOME = "/admin/tour-admin";

const words = (value = "") => String(value || "-").replaceAll("_", " ");

export const ORIGIN_LABELS = Object.freeze({
  WEBSITE: "Website",
  AGENT_PORTAL: "Agent Portal",
  BOKUN_IMPORT: "Bókun import",
  UNKNOWN: "Unknown"
});

export const PAYMENT_LABELS = Object.freeze({
  paid: "Payment verified",
  pending: "Payment pending",
  initiated: "Payment started",
  processing: "Payment verifying",
  failed: "Payment failed",
  verification_error: "Payment check failed",
  refunded: "Refunded",
  partially_refunded: "Partly refunded"
});

export const SUPPLIER_LABELS = Object.freeze({
  confirmed: "Supplier confirmed",
  supplier_pending: "Awaiting supplier",
  awaiting_payment: "Not sent to supplier",
  supplier_failed: "Supplier failed"
});

export const BOOKING_STATUS_OPTIONS = ["pending", "confirmed", "cancelled", "failed", "edit_requested"];
export const PAYMENT_STATUS_OPTIONS = ["pending", "processing", "paid", "failed"];
export const SUPPLIER_STATUS_OPTIONS = ["awaiting_payment", "supplier_pending", "confirmed", "supplier_failed"];

export const paymentLabel = (status) => PAYMENT_LABELS[status] || words(status);
export const supplierLabel = (status) => SUPPLIER_LABELS[status] || words(status);
export const originLabel = (origin) => ORIGIN_LABELS[origin] || words(origin);

export const paymentTone = (status) =>
  status === "paid" ? "success" : ["failed", "verification_error"].includes(status) ? "danger" : "warning";
export const supplierTone = (status) =>
  status === "confirmed" ? "success" : status === "supplier_failed" ? "danger" : "warning";

export const bokunSyncSummary = (supplierSync = {}) => {
  if (supplierSync.linkedToBokun) {
    return { label: `In Bókun (${words(supplierSync.bokunStatus || "unknown")})`, tone: supplierSync.bokunStatus === "confirmed" ? "success" : "warning" };
  }
  if (supplierSync.finalizationPending || ["pending", "processing", "pending_retry"].includes(supplierSync.finalizationStatus)) {
    return { label: "Sending to Bókun", tone: "warning" };
  }
  if (supplierSync.finalizationStatus === "failed") return { label: "Bókun sync failed", tone: "danger" };
  return { label: "Not in Bókun", tone: "secondary" };
};

// What an operator should look at first. Order matters: terminal states before in-progress ones.
export const bookingAttention = (booking = {}) => {
  const status = booking.status || {};
  const sync = booking.supplierSync || {};
  if (status.booking === "cancelled") return { key: "cancelled", label: "Cancelled", tone: "secondary" };
  if (status.booking === "failed" || status.payment === "failed") return { key: "failed", label: "Failed", tone: "danger" };
  if (status.supplier === "supplier_failed" || sync.finalizationStatus === "failed") {
    return { key: "supplier_failed", label: "Supplier confirmation failed", tone: "danger" };
  }
  if (status.payment === "paid" && status.supplier !== "confirmed") {
    return sync.finalizationPending || ["pending", "processing", "pending_retry"].includes(sync.finalizationStatus)
      ? { key: "supplier_sync_in_progress", label: "Paid, supplier sync in progress", tone: "warning" }
      : { key: "awaiting_supplier", label: "Paid, awaiting supplier confirmation", tone: "warning" };
  }
  if (status.payment !== "paid" && status.booking === "pending") return { key: "awaiting_payment", label: "Awaiting payment", tone: "info" };
  if (status.supplier === "confirmed") return { key: "ok", label: "No action needed", tone: "success" };
  return { key: "review", label: "Needs review", tone: "secondary" };
};

export const REQUEST_STATE_LABELS = Object.freeze({
  RECEIVED: "Received",
  UNDER_REVIEW: "Under review",
  AWAITING_SUPPLIER: "Awaiting supplier",
  AWAITING_FINANCE: "Escalated to Finance",
  RESOLVED: "Resolved (internal)",
  REJECTED: "Rejected (internal)"
});
export const REQUEST_STATES = Object.keys(REQUEST_STATE_LABELS);
export const OPEN_REQUEST_STATES = ["RECEIVED", "UNDER_REVIEW", "AWAITING_SUPPLIER", "AWAITING_FINANCE"];

export const requestStateTone = (state) =>
  ({ RECEIVED: "info", UNDER_REVIEW: "primary", AWAITING_SUPPLIER: "warning", AWAITING_FINANCE: "warning", RESOLVED: "success", REJECTED: "secondary" })[state] || "secondary";

export const CATEGORY_LABELS = Object.freeze({
  date_change: "Date change",
  cancellation: "Cancellation",
  traveler_change: "Traveller change",
  refund_inquiry: "Refund question",
  other: "Other"
});
export const REQUEST_TYPE_LABELS = Object.freeze({
  reschedule: "Reschedule",
  change_travelers: "Traveller change",
  cancel_booking: "Cancellation",
  combined_change: "Combined change"
});

export const requestStateLabel = (state) => REQUEST_STATE_LABELS[state] || words(state);
export const categoryLabel = (category) => CATEGORY_LABELS[category] || words(category);
export const requestTypeLabel = (type) => REQUEST_TYPE_LABELS[type] || words(type);
export const statusWords = words;

// Button text for a move the server allows (operations.allowedTransitions).
export const transitionActionLabel = ({ toState, escalatesTo } = {}) => {
  if (escalatesTo === "FINANCE") return "Escalate to Finance";
  if (escalatesTo === "SUPPLIER") return "Escalate for supplier action";
  return ({ UNDER_REVIEW: "Start review", RESOLVED: "Mark resolved (internal)", REJECTED: "Reject (internal)" })[toState] || `Move to ${requestStateLabel(toState)}`;
};

export const travellerSummary = (travelers) => {
  if (!travelers) return "-";
  const parts = [["adults", "adult"], ["children", "child"], ["infants", "infant"]]
    .filter(([key]) => Number(travelers[key] || 0) > 0)
    .map(([key, noun]) => `${travelers[key]} ${noun}${Number(travelers[key]) === 1 ? "" : key === "children" ? "ren" : "s"}`);
  return parts.length ? parts.join(", ") : "-";
};
