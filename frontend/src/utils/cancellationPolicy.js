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
  const refundAmount = Number(request.refund?.approvedAmount || request.refund?.eligibleAmount || request.refund?.estimatedAmount || 0);
  const confirmedRefundedAmount = Number(request.refund?.confirmedRefundedAmount || 0);
  const providerLabel = request.refund?.providerLabel || "";

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
    const completed = ["refunded", "partially_refunded"].includes(refund);
    const processing = ["processing", "verification_required"].includes(refund);
    const manual = ["manual_review", "manual_refund_required", "failed"].includes(refund);
    steps.push({
      label: completed ? "Refund completed" : processing ? "Refund processing" : "Refund review",
      done: completed,
      active: ["eligible", "pending_approval", "approved", "processing", "verification_required", "manual_review", "manual_refund_required", "failed"].includes(refund),
      text: completed
        ? `Your refund${confirmedRefundedAmount > 0 ? ` of ${new Intl.NumberFormat("en-US", { style: "currency", currency }).format(confirmedRefundedAmount)}` : ""} has been completed.`
        : processing
          ? `Your refund${refundAmount > 0 ? ` of ${new Intl.NumberFormat("en-US", { style: "currency", currency }).format(refundAmount)}` : ""}${providerLabel ? ` to your original ${providerLabel} payment method` : ""} is being processed.`
          : manual
            ? "Your refund requires assistance from our team."
            : `Your refund${refundAmount > 0 ? ` of ${new Intl.NumberFormat("en-US", { style: "currency", currency }).format(refundAmount)}` : ""} is awaiting admin processing.`
    });
  }

  return steps;
};
