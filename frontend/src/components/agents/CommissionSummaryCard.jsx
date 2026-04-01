import Card from "react-bootstrap/Card";
import { formatCurrency } from "../../utils/formatters";

const CommissionSummaryCard = ({ summary = [] }) => {
  return (
    <Card className="surface-card">
      <Card.Body>
        <h5>Commission Summary</h5>
        {summary.length === 0 ? <p className="text-muted mb-0">No commission data yet.</p> : null}
        {summary.map((row) => (
          <div key={row._id} className="d-flex justify-content-between mb-2">
            <span className="text-capitalize">{row._id}</span>
            <strong>{formatCurrency(row.totalAmount || 0, "USD")}</strong>
          </div>
        ))}
      </Card.Body>
    </Card>
  );
};

export default CommissionSummaryCard;