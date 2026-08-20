import { Badge, Card } from "react-bootstrap";
import { BsBarChartLine } from "react-icons/bs";

export const formatStatusLabel = (value = "") => String(value || "-").replaceAll("_", " ");

export const statusVariant = (status = "") => ({
  ACTIVE: "success",
  APPROVED: "success",
  AVAILABLE: "success",
  blocked: "danger",
  COMPLETED: "success",
  CRITICAL: "danger",
  ERROR: "danger",
  FAILED: "danger",
  OPEN: "warning",
  PAID: "success",
  PLANNED: "secondary",
  RESOLVED: "success",
  WARNING: "warning",
  acknowledged: "info",
  approved: "success",
  completed: "success",
  covered: "success",
  failed: "danger",
  fail: "danger",
  open: "warning",
  paid: "success",
  pass: "success",
  pending: "warning",
  ready: "success",
  refunded: "success",
  review_required: "warning",
  submitted: "info",
  warn: "warning"
})[status] || "secondary";

export const formatDateTime = (value = "") => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
};

export const AdminMetricCard = ({ label, value, detail = "", icon: Icon = BsBarChartLine, status = "" }) => (
  <Card className="surface-card h-100">
    <Card.Body>
      <div className="d-flex justify-content-between align-items-start gap-3">
        <div>
          <small className="text-muted d-block">{label}</small>
          <strong className="fs-4 d-block">{value}</strong>
          {detail ? <span className="text-muted small">{detail}</span> : null}
        </div>
        <span className="admin-platform-brand-mark d-inline-flex align-items-center justify-content-center">
          <Icon aria-hidden="true" />
        </span>
      </div>
      {status ? <Badge bg={statusVariant(status)} className="mt-3 text-capitalize">{formatStatusLabel(status)}</Badge> : null}
    </Card.Body>
  </Card>
);

export const StatusBadge = ({ value = "" }) => (
  <Badge bg={statusVariant(value)} className="text-capitalize">{formatStatusLabel(value)}</Badge>
);
