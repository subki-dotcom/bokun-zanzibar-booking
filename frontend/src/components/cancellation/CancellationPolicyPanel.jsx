import { Button } from "react-bootstrap";
import { BsArrowRepeat, BsClockHistory, BsShieldCheck, BsXCircle } from "react-icons/bs";
import { formatCurrency } from "../../utils/formatters";
import {
  formatCancellationDeadline,
  hasKnownRefundAmount,
  resolveCancellationActionLabel,
  resolveCancellationCopy,
  resolveCancellationHeadline
} from "../../utils/cancellationPolicy";

const iconForPolicy = (policy = {}) => {
  if (!policy.policyAvailable || policy.requiresManualReview) return <BsArrowRepeat />;
  if (policy.refundable === false || policy.freeCancellationExpired) return <BsXCircle />;
  return <BsShieldCheck />;
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
  const deadline = formatCancellationDeadline(resolvedPolicy);
  const feeKnown = hasKnownRefundAmount(resolvedPolicy.estimatedCancellationFee);
  const refundKnown = hasKnownRefundAmount(resolvedPolicy.estimatedRefundAmount);
  const paidKnown = hasKnownRefundAmount(amountPaid ?? resolvedPolicy.amountPaid);

  return (
    <section className={`cancellation-policy-panel ${compact ? "is-compact" : ""} ${className}`.trim()}>
      <div className="cancellation-policy-main">
        <span className="cancellation-policy-icon">{iconForPolicy(resolvedPolicy)}</span>
        <div>
          <h3>{resolveCancellationHeadline(resolvedPolicy)}</h3>
          <p>{resolveCancellationCopy(resolvedPolicy)}</p>
        </div>
      </div>

      {deadline ? (
        <div className="cancellation-policy-deadline">
          <span><BsClockHistory /> Deadline</span>
          <strong>{deadline}</strong>
          {resolvedPolicy.timeRemainingLabel && resolvedPolicy.isFreeCancellationAvailable ? (
            <small>Time remaining: {resolvedPolicy.timeRemainingLabel}</small>
          ) : null}
        </div>
      ) : null}

      {resolvedPolicy.policySummary ? (
        <p className="cancellation-policy-summary">{resolvedPolicy.policySummary}</p>
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
