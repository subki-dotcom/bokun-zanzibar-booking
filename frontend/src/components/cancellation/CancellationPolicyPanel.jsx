import { useEffect, useMemo, useState } from "react";
import { Button } from "react-bootstrap";
import { BsArrowRepeat, BsCalendar3, BsCheckCircle, BsShieldCheck, BsXCircle } from "react-icons/bs";
import { formatCurrency } from "../../utils/formatters";
import {
  cancellationDisplayText,
  formatCancellationDeadlineParts,
  hasKnownRefundAmount,
  resolveCancellationActionLabel,
  resolveCancellationCopy,
  resolveCancellationHeadline,
  splitCancellationTimeRemaining
} from "../../utils/cancellationPolicy";

const iconForPolicy = (policy = {}) => {
  if (!policy.policyAvailable || policy.requiresManualReview) return <BsArrowRepeat />;
  if (policy.refundable === false || policy.freeCancellationExpired) return <BsXCircle />;
  if (policy.isFreeCancellationAvailable) return <BsCheckCircle />;
  return <BsShieldCheck />;
};

const countdownSegments = [
  ["days", "Days"],
  ["hours", "Hours"],
  ["minutes", "Minutes"],
  ["seconds", "Seconds"]
];

const policyStateClass = (policy = {}) => {
  if (!policy.policyAvailable || policy.requiresManualReview) return "is-review";
  if (policy.refundable === false) return "is-non-refundable";
  if (policy.freeCancellationExpired) return "is-expired";
  if (policy.isFreeCancellationAvailable) return "is-free";
  return "is-standard";
};

const deadlineLabel = (policy = {}) => {
  if (policy.isFreeCancellationAvailable) return "Cancel before";
  if (policy.freeCancellationExpired) return "Free cancellation ended";
  return "Cancellation deadline";
};

const CancellationPolicyPanel = ({
  policy = null,
  currency = "USD",
  amountPaid = null,
  showAmounts = false,
  showAction = false,
  actionLabel = "",
  onAction,
  disabled = false,
  compact = false,
  className = ""
}) => {
  const resolvedPolicy = policy || { policyAvailable: false };
  const deadline = formatCancellationDeadlineParts(resolvedPolicy);
  const feeKnown = hasKnownRefundAmount(resolvedPolicy.estimatedCancellationFee);
  const refundKnown = hasKnownRefundAmount(resolvedPolicy.estimatedRefundAmount);
  const paidKnown = hasKnownRefundAmount(amountPaid ?? resolvedPolicy.amountPaid);
  const policySummary = cancellationDisplayText(resolvedPolicy.policySummary);
  const serverStartTime = useMemo(() => {
    const parsed = new Date(resolvedPolicy.serverTime || "").getTime();
    return Number.isFinite(parsed) ? parsed : Date.now();
  }, [resolvedPolicy.serverTime]);
  const [referenceTime, setReferenceTime] = useState(serverStartTime);

  useEffect(() => {
    if (!resolvedPolicy.deadline || !resolvedPolicy.isFreeCancellationAvailable) return undefined;

    const clientStartTime = Date.now();
    const updateReferenceTime = () => {
      setReferenceTime(serverStartTime + (Date.now() - clientStartTime));
    };
    updateReferenceTime();
    const timer = window.setInterval(updateReferenceTime, 1000);

    return () => window.clearInterval(timer);
  }, [resolvedPolicy.deadline, resolvedPolicy.isFreeCancellationAvailable, serverStartTime]);

  const countdown = resolvedPolicy.deadline && resolvedPolicy.isFreeCancellationAvailable
    ? splitCancellationTimeRemaining(resolvedPolicy.deadline, referenceTime)
    : null;
  const stateClass = policyStateClass(resolvedPolicy);
  const description = policySummary || resolveCancellationCopy(resolvedPolicy);

  return (
    <section className={`cancellation-policy-panel ${stateClass} ${compact ? "is-compact" : ""} ${className}`.trim()}>
      <div className="cancellation-policy-main">
        <span className="cancellation-policy-icon">{iconForPolicy(resolvedPolicy)}</span>
        <div>
          <h3>{resolveCancellationHeadline(resolvedPolicy)}</h3>
        </div>
      </div>

      <p className="cancellation-policy-description">{description}</p>

      {deadline ? (
        <div className="cancellation-policy-deadline">
          <span className="cancellation-policy-deadline-label"><BsCalendar3 /> {deadlineLabel(resolvedPolicy)}</span>
          <div className="cancellation-policy-deadline-value">
            <strong>{deadline.date}</strong>
            <strong>{deadline.time}</strong>
            <small>{deadline.timezoneLabel}</small>
          </div>
          {countdown ? (
            <div className="cancellation-policy-countdown" role="timer" aria-label="Time remaining before free cancellation ends">
              {countdownSegments.map(([key, label]) => (
                <span className={`cancellation-countdown-segment${key === "seconds" ? " is-seconds" : ""}`} key={key}>
                  <strong>{String(countdown[key]).padStart(2, "0")}</strong>
                  <small>{label}</small>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {showAmounts ? (
        <div className="cancellation-policy-amounts">
          <span>Amount paid <strong>{paidKnown ? formatCurrency(amountPaid ?? resolvedPolicy.amountPaid, currency) : "Review required"}</strong></span>
          <span>Cancellation fee <strong>{feeKnown ? formatCurrency(resolvedPolicy.estimatedCancellationFee, currency) : "Review required"}</strong></span>
          <span>Estimated refund <strong>{refundKnown ? formatCurrency(resolvedPolicy.estimatedRefundAmount, currency) : "Review required"}</strong></span>
        </div>
      ) : null}

      {showAction ? (
        <Button
          type="button"
          variant={resolvedPolicy.isFreeCancellationAvailable ? "outline-danger" : "outline-warning"}
          onClick={onAction}
          disabled={disabled}
          className="cancellation-policy-action"
        >
          {actionLabel || resolveCancellationActionLabel(resolvedPolicy)}
        </Button>
      ) : null}
    </section>
  );
};

export default CancellationPolicyPanel;
