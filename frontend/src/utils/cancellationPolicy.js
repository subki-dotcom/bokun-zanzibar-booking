const ZANZIBAR_TZ = "Africa/Dar_es_Salaam";

export const hasKnownRefundAmount = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));

export const formatCancellationDeadline = (policy = {}) => {
  if (!policy?.deadline) return "";
  const parsed = new Date(policy.deadline);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${new Intl.DateTimeFormat("en-GB", {
    timeZone: policy.timezone || ZANZIBAR_TZ,
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(parsed)} (Zanzibar time)`;
};

export const resolveCancellationHeadline = (policy = {}) => {
  if (!policy?.policyAvailable) return "Cancellation review required";
  if (policy.refundable === false) return "Non-refundable booking";
  if (policy.isFreeCancellationAvailable) return "Free cancellation available";
  if (policy.freeCancellationExpired) return "Free cancellation period ended";
  if (policy.requiresManualReview) return "Cancellation review required";
  return "Cancellation policy";
};

export const resolveCancellationCopy = (policy = {}) => {
  const deadline = formatCancellationDeadline(policy);
  if (!policy?.policyAvailable) {
    return "Cancellation terms could not be confirmed automatically. Please contact our support team before cancelling.";
  }
  if (policy.refundable === false) {
    return "This booking is non-refundable according to the applicable cancellation policy.";
  }
  if (policy.isFreeCancellationAvailable && deadline) {
    return `Cancel before ${deadline} to receive a full refund.`;
  }
  if (policy.freeCancellationExpired && deadline) {
    return `Free cancellation period ended on ${deadline}. Cancellation may now be non-refundable or subject to review.`;
  }
  if (policy.requiresManualReview) {
    return policy.reviewReason || "This booking requires cancellation review. Please contact our support team.";
  }
  return policy.policySummary || "Cancellation terms are shown from the supplier policy.";
};

export const resolveCancellationActionLabel = (policy = {}) => {
  if (!policy?.policyAvailable || policy.requiresManualReview || policy.freeCancellationExpired) {
    return "Request Cancellation Review";
  }
  return "Cancel Booking";
};

export const buildCancellationTimeline = (request = {}, currency = "USD") => {
  if (request?.type !== "cancel_booking") return [];
  const status = String(request.status || "");
  const supplier = String(request.bokunSync?.status || "");
  const refund = String(request.refund?.status || "not_required");
  const refundAmount = Number(request.refund?.estimatedAmount || 0);

  const steps = [
    {
      label: "Cancellation requested",
      done: Boolean(request.createdAt),
      text: "Your cancellation request has been received."
    },
    {
      label: "Under review",
      done: ["under_review", "approved", "processing", "completed"].includes(status),
      active: ["submitted", "under_review"].includes(status),
      text: "We are reviewing the supplier policy and booking status."
    },
    {
      label: "Supplier confirmation",
      done: supplier === "synced" || status === "completed",
      active: ["pending", "syncing", "failed", "manual_action_required"].includes(supplier),
      text: supplier === "synced" || status === "completed"
        ? "Your booking has been cancelled with the supplier."
        : "We are confirming the cancellation with the activity supplier."
    }
  ];

  if (refund !== "not_required") {
    steps.push({
      label: "Refund processing",
      done: ["refunded", "partially_refunded"].includes(refund),
      active: ["pending_approval", "approved", "processing", "manual_review", "failed"].includes(refund),
      text: ["refunded", "partially_refunded"].includes(refund)
        ? "Your refund has been completed."
        : `Your refund${refundAmount > 0 ? ` of ${new Intl.NumberFormat("en-US", { style: "currency", currency }).format(refundAmount)}` : ""} is being reviewed separately.`
    });
  }

  return steps;
};
