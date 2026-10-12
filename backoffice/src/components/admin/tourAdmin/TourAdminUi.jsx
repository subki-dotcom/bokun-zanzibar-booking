import { Badge, Button } from "react-bootstrap";
import {
  bokunSyncSummary,
  bookingAttention,
  originLabel,
  paymentLabel,
  paymentTone,
  supplierLabel,
  supplierTone
} from "../../../config/tourOperations";

// Light badges need dark text to stay readable.
const textFor = (tone) => (["warning", "info", "light"].includes(tone) ? "dark" : undefined);

export const ToneBadge = ({ tone = "secondary", children, title }) => (
  <Badge bg={tone} text={textFor(tone)} title={title} className="text-wrap text-start">
    {children}
  </Badge>
);

export const OriginBadge = ({ booking }) => (
  <span className="d-inline-flex flex-column gap-1">
    <ToneBadge tone={booking.origin === "AGENT_PORTAL" ? "primary" : "info"}>{originLabel(booking.origin)}</ToneBadge>
    {booking.originBasis === "historical" ? <small className="text-muted">from booking history</small> : null}
  </span>
);

// Payment and supplier confirmation are separate facts and are always shown separately.
export const PaymentBadge = ({ status }) => <ToneBadge tone={paymentTone(status)}>{paymentLabel(status)}</ToneBadge>;
export const SupplierBadge = ({ status }) => <ToneBadge tone={supplierTone(status)}>{supplierLabel(status)}</ToneBadge>;

export const BokunSyncBadge = ({ supplierSync }) => {
  const summary = bokunSyncSummary(supplierSync);
  return <ToneBadge tone={summary.tone}>{summary.label}</ToneBadge>;
};

export const AttentionBadge = ({ booking }) => {
  const attention = bookingAttention(booking);
  return <ToneBadge tone={attention.tone}>{attention.label}</ToneBadge>;
};

export const TourAdminPagination = ({ page, limit, total, onPage, disabled = false, label = "results" }) => {
  const pages = Math.max(1, Math.ceil(Number(total || 0) / Math.max(1, Number(limit || 1))));
  return (
    <nav className="d-flex flex-wrap align-items-center justify-content-between gap-2 mt-3 tour-admin-pagination" aria-label="Pagination">
      <small className="text-muted">
        {Number(total || 0)} {label} · page {page} of {pages}
      </small>
      <div className="d-flex gap-2">
        <Button variant="outline-secondary" size="sm" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="outline-secondary" size="sm" disabled={disabled || page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </nav>
  );
};

// Readable, safe messages for API failures. The server decides access; this only explains it.
export const tourAdminErrorMessage = (error, fallback = "Something went wrong. Please try again.") => {
  const status = Number(error?.status || 0);
  if (status === 401) return "Your session has ended. Sign in again.";
  if (status === 403) return "Your account does not have access to this Tour Admin information.";
  if (status === 404) return "Not found, or not part of Tour Operations.";
  if (status === 409) return "This request was changed by someone else. The latest version has been loaded.";
  if (status === 422) return error?.message || "Some details were not accepted. Check and try again.";
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  return error?.message || fallback;
};

export const EmptyState = ({ children }) => (
  <div className="text-center text-muted py-5" role="status">
    {children}
  </div>
);
