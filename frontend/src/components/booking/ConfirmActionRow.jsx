import Button from "react-bootstrap/Button";

const ConfirmActionRow = ({
  submitting = false,
  disableConfirm = false,
  confirmLabel = "Confirm & Pay",
  loadingLabel = "Redirecting to payment...",
  onBack,
  onConfirm,
  confirmIcon = null,
  showBack = true,
  className = ""
}) => (
  <div className={`review-action-row ${className}`.trim()}>
    {showBack ? (
      <Button variant="outline-secondary" onClick={onBack} disabled={submitting}>
        Back
      </Button>
    ) : null}
    <Button className="premium-btn text-white" onClick={onConfirm} disabled={submitting || disableConfirm}>
      {!submitting && confirmIcon ? <span className="confirm-action-icon">{confirmIcon}</span> : null}
      {submitting ? loadingLabel : confirmLabel}
    </Button>
  </div>
);

export default ConfirmActionRow;
