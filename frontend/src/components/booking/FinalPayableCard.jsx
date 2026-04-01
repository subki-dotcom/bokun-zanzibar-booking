import Card from "react-bootstrap/Card";
import { formatCurrency } from "../../utils/formatters";

const toSafeNumber = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const FinalPayableCard = ({ quote = null, extras = [] }) => {
  const pricing = quote?.pricing || {};
  const currency = pricing.currency || "USD";
  const subtotal = toSafeNumber(pricing.baseAmount);
  const quoteExtras = toSafeNumber(pricing.extraAmount);
  const fallbackExtras = (extras || []).reduce(
    (sum, row) => sum + toSafeNumber(row.amount) * Math.max(1, toSafeNumber(row.quantity)),
    0
  );
  const extrasTotal = quoteExtras > 0 ? quoteExtras : fallbackExtras;
  const finalPayable = toSafeNumber(pricing.finalPayable || subtotal + extrasTotal);

  return (
    <Card className="surface-card review-total-card">
      <Card.Body>
        <div className="review-block-label">Payment Summary</div>

        <div className="review-compact-row">
          <span className="review-compact-key">Subtotal</span>
          <strong className="review-compact-value">{formatCurrency(subtotal, currency)}</strong>
        </div>
        <div className="review-compact-row">
          <span className="review-compact-key">Extras</span>
          <strong className="review-compact-value">{formatCurrency(extrasTotal, currency)}</strong>
        </div>

        <div className="review-total-line">
          <span>Total payable</span>
          <strong>{formatCurrency(finalPayable, currency)}</strong>
        </div>
      </Card.Body>
    </Card>
  );
};

export default FinalPayableCard;

