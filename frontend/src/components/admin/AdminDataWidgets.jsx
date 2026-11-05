import { BsBarChartLine } from "react-icons/bs";
import { formatAdminDateTime } from "../../utils/adminFormat";
import { formatLabel } from "../../utils/formatLabel";
import { StatCard, StatusBadge as UiStatusBadge } from "./ui";

export const formatStatusLabel = (value = "") => formatLabel(value);

export const statusVariant = (status = "") => ({
  ACTIVE: "success",
  APPROVED: "success",
  AVAILABLE: "success",
  blocked: "danger",
  COMPLETED: "success",
  CONFIGURED: "success",
  CRITICAL: "danger",
  ERROR: "danger",
  FAILED: "danger",
  HIGH: "danger",
  INFO: "info",
  LIMITED: "warning",
  OBSERVED: "success",
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
  live: "success",
  running: "success",
  mock: "warning",
  degraded: "warning",
  disabled: "secondary",
  stopped: "secondary",
  not_configured: "danger",
  refunded: "success",
  review_required: "warning",
  submitted: "info",
  warn: "warning"
})[status] || "secondary";

export const formatDateTime = (value = "") => (value ? formatAdminDateTime(value) : "-");

// Older pages import these two; they now render the design-system StatCard and StatusBadge (components/admin/ui).
export const AdminMetricCard = ({ label, value, detail = "", icon: Icon = BsBarChartLine, status = "" }) => (
  <StatCard label={label} value={value} helper={detail} icon={Icon} status={status} />
);

export const StatusBadge = ({ value = "" }) => <UiStatusBadge value={value} />;
