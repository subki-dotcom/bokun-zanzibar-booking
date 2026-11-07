// The admin design system: every admin page is built from these, so all pages share one width, one header, one card,
// one table, one filter bar, one empty/error/loading state and one status colour map.
// Styles: adminUi.css (structure) and admin-theme.css (tokens, look).
import { useEffect, useMemo, useState } from "react";
import { Dropdown } from "react-bootstrap";
import { BsArrowClockwise, BsChevronLeft, BsChevronRight, BsExclamationTriangle, BsFunnel, BsInbox, BsSearch, BsThreeDots } from "react-icons/bs";
import { formatLabel, rawLabelTitle } from "../../../utils/formatLabel";
import { formatAdminDateTime, formatRelativeTime } from "../../../utils/adminFormat";
import { statusTone } from "./statusTone";
import "./adminUi.css";

const cx = (...names) => names.filter(Boolean).join(" ");

// One content container: same max-width, padding and vertical rhythm on every page.
export const AdminPage = ({ children, className = "", wide = false }) => (
  <div className={cx("adm-page", wide && "is-wide", className)}>{children}</div>
);

// Eyebrow (section), title, short description and right-side actions. The top bar shows the breadcrumb.
export const PageHeader = ({ eyebrow = "", title, description = "", actions = null, icon: Icon = null, status = null }) => (
  <header className="adm-page-header">
    <div className="adm-page-header-copy">
      {eyebrow ? <span className="adm-eyebrow">{eyebrow}</span> : null}
      <h1 className="adm-title">
        {Icon ? <Icon aria-hidden="true" className="adm-title-icon" /> : null}
        {title}
        {status ? <span className="adm-title-status">{status}</span> : null}
      </h1>
      {description ? <p className="adm-description">{description}</p> : null}
    </div>
    {actions ? <div className="adm-page-actions">{actions}</div> : null}
  </header>
);

// Pill with a small dot, one colour map for booking, payment and sync states (statusTone.js).
export const StatusBadge = ({ value = "", label = "", tone = "" }) => {
  if (value === null || value === undefined || value === "") {
    return (
      <span className="adm-badge is-neutral">
        <i className="adm-badge-dot" aria-hidden="true" />—
      </span>
    );
  }
  const text = label || formatLabel(value);
  return (
    <span className={cx("adm-badge", `is-${tone || statusTone(value)}`)} title={rawLabelTitle(value)}>
      <i className="adm-badge-dot" aria-hidden="true" />
      {text}
    </span>
  );
};

// Figures: negative amounts ("USD -120.00", "-3") in red; "Not available" / "Unavailable" / "Unknown" muted with a
// tooltip saying why. Anything else is returned unchanged.
const NOT_AVAILABLE = /^(not available|unavailable|unknown)$/i;
export const decorateFigure = (value, reason = "Not recorded for this item yet.") => {
  if (typeof value !== "string") return value;
  if (NOT_AVAILABLE.test(value.trim())) return <span className="adm-na" title={reason}>Not available</span>;
  if (/^(?:[A-Z]{3}\s)?-\s?[\d.,]/.test(value.trim())) return <span className="adm-negative">{value}</span>;
  return value;
};

// "13d ago" with the full date and time on hover.
export const RelativeTime = ({ value }) => {
  if (!value) return "—";
  const full = formatAdminDateTime(value);
  if (full === "—") return "—";
  return (
    <time className="adm-relative-time" dateTime={new Date(value).toISOString()} title={full}>
      {formatRelativeTime(value)}
    </time>
  );
};

// trend: { value: "12%", direction: "up" | "down", good: true | false } (good decides green or red).
export const StatCard = ({ label, value, helper = "", icon: Icon = null, status = "", tone = "", loading = false, trend = null }) => (
  <section className={cx("adm-stat", tone && `is-${tone}`)} aria-busy={loading || undefined}>
    <div className="adm-stat-top">
      <span className="adm-stat-label">{label}</span>
      {Icon ? (
        <span className="adm-stat-icon" aria-hidden="true">
          <Icon />
        </span>
      ) : null}
    </div>
    <strong className="adm-stat-value">{loading ? <span className="adm-skeleton-line is-value" /> : decorateFigure(value)}</strong>
    {trend && !loading ? (
      <span className={cx("adm-stat-trend", trend.good === false ? "is-bad" : trend.good ? "is-good" : "")}>
        {trend.direction === "down" ? "▼" : "▲"} {trend.value}
      </span>
    ) : null}
    {helper ? <span className="adm-stat-helper">{loading ? "" : helper}</span> : null}
    {status && !loading ? <StatusBadge value={status} /> : null}
  </section>
);

export const StatGrid = ({ children, columns = 4 }) => (
  <div className={cx("adm-stat-grid", `cols-${columns}`)}>{children}</div>
);

export const SectionCard = ({ title = "", description = "", actions = null, children, className = "", flush = false }) => (
  <section className={cx("adm-card", flush && "is-flush", className)}>
    {title || actions ? (
      <div className="adm-card-header">
        <div>
          {title ? <h3 className="adm-card-title">{title}</h3> : null}
          {description ? <p className="adm-card-description">{description}</p> : null}
        </div>
        {actions ? <div className="adm-card-actions">{actions}</div> : null}
      </div>
    ) : null}
    <div className="adm-card-body">{children}</div>
  </section>
);

export const EmptyState = ({ title = "Nothing here yet", message = "", icon: Icon = BsInbox, action = null }) => (
  <div className="adm-state" role="status">
    <span className="adm-state-icon" aria-hidden="true">
      <Icon />
    </span>
    <strong>{title}</strong>
    {message ? <p>{message}</p> : null}
    {action ? <div className="adm-state-action">{action}</div> : null}
  </div>
);

export const ErrorState = ({ title = "This could not be loaded", message = "", onRetry = null }) => (
  <div className="adm-state is-error" role="alert">
    <span className="adm-state-icon" aria-hidden="true">
      <BsExclamationTriangle />
    </span>
    <strong>{title}</strong>
    {message ? <p>{message}</p> : null}
    {onRetry ? (
      <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onRetry}>
        <BsArrowClockwise aria-hidden="true" /> Try again
      </button>
    ) : null}
  </div>
);

export const LoadingSkeleton = ({ rows = 4, label = "Loading" }) => (
  <div className="adm-skeleton" role="status" aria-label={label}>
    {Array.from({ length: rows }).map((_, index) => (
      <span key={index} className="adm-skeleton-line" style={{ width: `${92 - (index % 3) * 14}%` }} />
    ))}
  </div>
);

// Search + selects + date range + Reset in one row. On phones the extra filters fold behind a "Filters" button.
export const FilterBar = ({ search = null, children = null, onReset = null, actions = null }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="adm-filter-bar">
      {search ? (
        <label className="adm-filter-search">
          <BsSearch aria-hidden="true" />
          <input
            type="search"
            value={search.value}
            onChange={(event) => search.onChange(event.target.value)}
            placeholder={search.placeholder || "Search"}
            aria-label={search.label || search.placeholder || "Search"}
          />
        </label>
      ) : null}
      {children ? (
        <button type="button" className="btn btn-outline-secondary btn-sm adm-filter-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          <BsFunnel aria-hidden="true" /> Filters
        </button>
      ) : null}
      {children ? <div className={cx("adm-filter-extra", open && "is-open")}>{children}</div> : null}
      {onReset ? (
        <button type="button" className="btn btn-link btn-sm adm-filter-reset" onClick={onReset}>
          Reset
        </button>
      ) : null}
      {actions ? <div className="adm-filter-actions">{actions}</div> : null}
    </div>
  );
};

// "⋯" menu for row actions: [{ label, onClick, danger?, disabled? }].
export const RowActions = ({ actions = [], label = "Actions" }) => {
  const items = actions.filter(Boolean);
  if (!items.length) return null;
  return (
    <Dropdown align="end" className="adm-row-actions">
      <Dropdown.Toggle as="button" type="button" className="adm-row-actions-toggle" aria-label={label}>
        <BsThreeDots aria-hidden="true" />
      </Dropdown.Toggle>
      <Dropdown.Menu className="adm-row-actions-menu" popperConfig={{ strategy: "fixed" }}>
        {items.map((action) => (
          <Dropdown.Item
            key={action.label}
            as="button"
            type="button"
            disabled={action.disabled}
            className={action.danger ? "is-danger" : ""}
            onClick={action.onClick}
          >
            {action.icon ? <action.icon aria-hidden="true" /> : null}
            {action.label}
          </Dropdown.Item>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );
};

// columns: [{ key, header, render?(row), align?: "end", money?: bool, width?, hideOnMobile?: bool }]
// rowActions?(row) -> [{ label, onClick, danger?, disabled? }] renders a "⋯" menu in the last column.
// Scrolls sideways inside the card only; below 768px every row becomes a stacked card.
export const DataTable = ({
  columns = [],
  rows = [],
  rowKey = (row, index) => row.id || row._id || index,
  loading = false,
  error = "",
  onRetry = null,
  empty = null,
  pageSize = 0,
  pageSizeOptions = [10, 25, 50, 100],
  caption = "",
  onRowClick = null,
  rowActions = null
}) => {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);
  useEffect(() => setSize(pageSize), [pageSize]);
  const pages = size ? Math.max(1, Math.ceil(rows.length / size)) : 1;
  const current = Math.min(page, pages);
  const visible = useMemo(() => (size ? rows.slice((current - 1) * size, current * size) : rows), [rows, size, current]);
  const allColumns = rowActions
    ? [...columns, { key: "__actions", header: <span className="visually-hidden">Actions</span>, align: "end", width: 56, render: (row) => <RowActions actions={rowActions(row)} /> }]
    : columns;

  if (loading) return <LoadingSkeleton rows={5} />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (!rows.length) return empty || <EmptyState title="No records" message="Nothing matches these filters." />;

  const headerText = (column) => (typeof column.header === "string" ? column.header : "");

  return (
    <>
      <div className={cx("adm-table-scroll", visible.length > 12 && "is-tall")} role="region" aria-label={caption || "Table"} tabIndex={0}>
        <table className="adm-table">
          {caption ? <caption className="visually-hidden">{caption}</caption> : null}
          <thead>
            <tr>
              {allColumns.map((column) => (
                <th key={column.key} className={column.align === "end" || column.money ? "is-end" : ""} style={column.width ? { width: column.width } : undefined}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => (
              <tr key={rowKey(row, index)} className={onRowClick ? "is-clickable" : ""} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {allColumns.map((column) => (
                  <td
                    key={column.key}
                    data-label={headerText(column)}
                    className={cx(
                      column.align === "end" || column.money ? "is-end" : "",
                      column.money && "is-money",
                      column.key === "__actions" && "is-actions",
                      column.hideOnMobile && "adm-hide-mobile"
                    )}
                  >
                    {(() => {
                      const content = column.render ? column.render(row) : row[column.key] ?? "—";
                      return column.money || column.align === "end" ? decorateFigure(content) : content;
                    })()}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {size && rows.length > Math.min(...pageSizeOptions) ? (
        <div className="adm-pagination">
          <label className="adm-pagination-size">
            Rows per page
            <select
              className="form-select form-select-sm"
              value={size}
              onChange={(event) => {
                setSize(Number(event.target.value));
                setPage(1);
              }}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <span className="adm-pagination-range">
            {(current - 1) * size + 1}–{Math.min(current * size, rows.length)} of {rows.length}
          </span>
          <div className="adm-pagination-nav">
            <button type="button" className="btn btn-outline-secondary btn-sm" disabled={current <= 1} onClick={() => setPage(current - 1)} aria-label="Previous page">
              <BsChevronLeft aria-hidden="true" />
            </button>
            <button type="button" className="btn btn-outline-secondary btn-sm" disabled={current >= pages} onClick={() => setPage(current + 1)} aria-label="Next page">
              <BsChevronRight aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
};

// A long value (e.g. an OTA relay email or a product name) cut to one line, the full value in a tooltip.
export const Truncate = ({ value = "", max = 28 }) => {
  const text = String(value || "");
  if (!text) return "—";
  return (
    <span className="adm-truncate" title={text} style={{ maxWidth: `${max}ch` }}>
      {text}
    </span>
  );
};
