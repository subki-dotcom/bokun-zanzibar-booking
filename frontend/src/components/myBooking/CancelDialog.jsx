import { useEffect, useRef, useState } from "react";
import { LuCircleX } from "react-icons/lu";
import { fetchCancellationEstimate, newIdempotencyKey, submitMyBookingRequest } from "../../api/myBookingApi";
import { trackAnalyticsEvent } from "../../utils/analytics";
import Dialog from "./Dialog";
import { CANCEL_REASONS, instantWeekdayDayTime, money } from "./myBookingData";

// The refund explanation, from the policy the server calculated just now.
const refundText = (estimate) => {
  if (!estimate) return "";
  if (estimate.freeCancellation) {
    return `You're cancelling before the free-cancellation deadline${estimate.deadline ? ` (${instantWeekdayDayTime(estimate.deadline)}, Zanzibar time)` : ""}, so you get a full refund to your original payment method.`;
  }
  if (estimate.requiresManualReview || estimate.refund === null) {
    return `${estimate.reviewReason || "Our team checks the refund under the tour's cancellation policy."} We'll email you the amount before anything is final.`;
  }
  if (Number(estimate.refund) <= 0) return "The free-cancellation period has ended, so this booking is no longer refundable.";
  return "The free-cancellation period has ended, so a cancellation fee applies under the tour's policy.";
};

// "Cancel booking" (mockup MyBooking, cancel dialog; a bottom sheet on phones).
const CancelDialog = ({ data, onClose, onDone, onChangeDate }) => {
  const [estimate, setEstimate] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [idempotencyKey] = useState(newIdempotencyKey);
  const keepButton = useRef(null);

  useEffect(() => {
    let active = true;
    fetchCancellationEstimate(data.reference)
      .then((value) => active && setEstimate(value))
      .catch((err) => active && setLoadError(err.message));
    return () => {
      active = false;
    };
  }, [data.reference]);

  const submit = async () => {
    setSubmitting(true);
    setError("");
    const label = CANCEL_REASONS.find(([value]) => value === reason)?.[1] || "Cancelled from My booking";
    try {
      await submitMyBookingRequest(
        data.reference,
        {
          type: "cancel_booking",
          customerReason: label,
          cancellationReason: reason || "other",
          cancellationConfirmed: true
        },
        idempotencyKey
      );
      trackAnalyticsEvent("cancel_request");
      onDone("Cancellation requested – we've emailed you a confirmation");
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const currency = estimate?.currency || data.receipt.currency;
  const fee = estimate?.cancellationFee;
  const back = estimate?.refund;

  return (
    <Dialog onClose={onClose} labelledBy="mb-cancel-title" initialFocus={keepButton} busy={submitting}>
      <span className="mb-dialog-icon" aria-hidden="true"><LuCircleX size={24} /></span>
      <h2 id="mb-cancel-title">Cancel your {data.tour.title}?</h2>
      <p className="mb-dialog-lead">{loadError || (estimate ? refundText(estimate) : "Checking your refund…")}</p>
      {estimate ? (
        <dl className="mb-summary">
          <div>
            <dt>Amount paid</dt>
            <dd>{money(estimate.amountPaid, currency)}</dd>
          </div>
          <div>
            <dt>Cancellation fee</dt>
            <dd>{fee === null || fee === undefined ? "Reviewed by our team" : money(fee, currency)}</dd>
          </div>
          <div className="is-total">
            <dt>You&apos;ll get back</dt>
            <dd>{back === null || back === undefined ? "To be confirmed" : money(back, currency)}</dd>
          </div>
        </dl>
      ) : null}
      <div className="mb-field">
        <label htmlFor="mb-cancel-reason">Reason (optional)</label>
        <select id="mb-cancel-reason" className="mb-input" value={reason} onChange={(event) => setReason(event.target.value)}>
          <option value="">Choose a reason</option>
          {CANCEL_REASONS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
      {data.actions.changeDate.allowed ? (
        <p className="mb-dialog-alt">
          Prefer another date instead?{" "}
          <button type="button" className="mb-link" onClick={onChangeDate}>
            Change date{data.policy.freeCancellation ? " for free" : ""}
          </button>
        </p>
      ) : null}
      {error ? <p className="mb-alert" role="alert">{error}</p> : null}
      <div className="mb-dialog-actions">
        <button ref={keepButton} type="button" className="mb-btn mb-btn-outline" onClick={onClose} disabled={submitting}>
          Keep my booking
        </button>
        <button type="button" className="mb-btn mb-btn-danger" onClick={submit} disabled={submitting || (!estimate && !loadError)}>
          {submitting ? "Sending…" : back > 0 ? "Cancel & refund" : "Cancel booking"}
        </button>
      </div>
    </Dialog>
  );
};

export default CancelDialog;
