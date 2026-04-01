import Button from "react-bootstrap/Button";

const ConfirmActionRow = ({
  submitting = false,
  disableConfirm = false,
  confirmLabel = "Confirm & Pay",
  loadingLabel = "Redirecting to payment...",
  onBack,
  onConfirm
}) => (
  <div className="review-action-row">
    <Button variant="outline-secondary" onClick={onBack} disabled={submitting}>
      Back
    </Button>
    <Button className="premium-btn text-white" onClick={onConfirm} disabled={submitting || disableConfirm}>
      {submitting ? loadingLabel : confirmLabel}
    </Button>
  </div>
);

export default ConfirmActionRow;
