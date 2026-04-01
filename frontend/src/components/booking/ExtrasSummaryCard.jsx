import Card from "react-bootstrap/Card";
import { formatCurrency } from "../../utils/formatters";

const toSafeNumber = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const ExtrasSummaryCard = ({ extras = [], currency = "USD" }) => {
  const rows = (extras || [])
    .map((extra = {}) => {
      const quantity = Math.max(1, toSafeNumber(extra.quantity));
      const amount = toSafeNumber(extra.amount);

      return {
        code: String(extra.code || extra.label || ""),
        label: extra.label || "Extra",
        quantity,
        lineTotal: amount * quantity
      };
    })
    .filter((row) => row.code);

  return (
    <Card className="surface-card review-summary-card">
      <Card.Body>
        <div className="review-block-label">Extras</div>
        {rows.length ? (
          <div className="review-compact-list">
            {rows.map((row) => (
              <div className="review-compact-row" key={row.code}>
                <span className="review-compact-key">{row.label} x{row.quantity}</span>
                <strong className="review-compact-value">{formatCurrency(row.lineTotal, currency)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="review-empty-state">No extras selected.</div>
        )}
      </Card.Body>
    </Card>
  );
};

export default ExtrasSummaryCard;

