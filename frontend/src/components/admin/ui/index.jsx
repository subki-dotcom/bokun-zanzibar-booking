// The admin design system: every admin page is built from these, so all pages share one width, one header, one card,
// one table, one filter bar, one empty/error/loading state and one status colour map. Styles: adminUi.css.
import { useMemo, useState } from "react";
import { BsArrowClockwise, BsExclamationTriangle, BsInbox, BsSearch } from "react-icons/bs";
import { formatLabel, rawLabelTitle } from "../../../utils/formatLabel";
import { statusTone } from "./statusTone";
import "./adminUi.css";

const cx = (...names) => names.filter(Boolean).join(" ");

// One content container: same max-width, padding and vertical rhythm on every page.
export const AdminPage = ({ children, className = "", wide = false }) => (
  <div className={cx("adm-page", wide && "is-wide", className)}>{children}</div>
);

// Eyebrow (section), title, short description and right-side actions. The top bar already shows the breadcrumb.
export const PageHeader = ({ eyebrow = "", title, description = "", actions = null, icon: Icon = null }) => (
  <header className="adm-page-header">
    <div className="adm-page-header-copy">
      {eyebrow ? <span className="adm-eyebrow">{eyebrow}</span> : null}
      <h1 className="adm-title">
        {Icon ? <Icon aria-hidden="true" className="adm-title-icon" /> : null}
        {title}
      </h1>
      {description ? <p className="adm-description">{description}</p> : null}
    </div>
    {actions ? <div className="adm-page-actions">{actions}</div> : null}
  </header>
);

export const StatusBadge = ({ value = "", label = "", tone = "" }) => {
  if (value === null || value === undefined || value === "") return <span className="adm-badge is-neutral">—</span>;
  const text = label || formatLabel(value);
  return (
    <span className={cx("adm-badge", `is-${tone || statusTone(value)}`)} title={rawLabelTitle(value)}>
      {text}
    </span>
  );
};

export const StatCard = ({ label, value, helper = "", icon: Icon = null, status = "", tone = "", loading = false }) => (
  <section className={cx("adm-stat", tone && `is-${tone}`)} aria-busy={loading || undefined}>
    <div className="adm-stat-top">
      <span className="adm-stat-label">{label}</span>
      {Icon ? (
        <span className="adm-stat-icon" aria-hidden="true">
          <Icon />
        </span>
      ) : null}
    </div>
    <strong className="adm-stat-value">{loading ? <span className="adm-skeleton-line is-value" /> : value}</strong>
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
    <Icon aria-hidden="true" className="adm-state-icon" />
    <strong>{title}</strong>
    {message ? <p>{message}</p> : null}
    {action ? <div className="adm-state-action">{action}</div> : null}
  </div>
);

export const ErrorState = ({ title = "This could not be loaded", message = "", onRetry = null }) => (
  <div className="adm-state is-error" role="alert">
    <BsExclamationTriangle aria-hidden="true" className="adm-state-icon" />
    <strong>{title}</strong>
    {message ? <p>{message}</p> : null}
    {onRetry ? (
      <button type="button" className="btn btn-outline-primary btn-sm" onClick={onRetry}>
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

// Search + selects + date range + Reset in one row that wraps on small screens.
export const FilterBar = ({ search = null, children = null, onReset = null, actions = null }) => (
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
    {children}
    {onReset ? (
      <button type="button" className="btn btn-outline-secondary btn-sm adm-filter-reset" onClick={onReset}>
        Reset
      </button>
    ) : null}
    {actions ? <div className="adm-filter-actions">{actions}</div> : null}
  </div>
);

// columns: [{ key, header, render?(row), align?: "end", money?: bool, width? }]. Scrolls sideways inside the card only.
export const DataTable = ({
  columns = [],
  rows = [],
  rowKey = (row, index) => row.id || row._id || index,
  loading = false,
  error = "",
  onRetry = null,
  empty = null,
  pageSize = 0,
  caption = "",
  onRowClick = null
}) => {
  const [page, setPage] = useState(1);
  const pages = pageSize ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
  const current = Math.min(page, pages);
  const visible = useMemo(() => (pageSize ? rows.slice((current - 1) * pageSize, current * pageSize) : rows), [rows, pageSize, current]);

  if (loading) return <LoadingSkeleton rows={5} />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (!rows.length) return empty || <EmptyState title="No records" message="Nothing matches these filters." />;

  return (
    <>
      <div className={cx("adm-table-scroll", visible.length > 12 && "is-tall")} role="region" aria-label={caption || "Table"} tabIndex={0}>
        <table className="adm-table">
          {caption ? <caption className="visually-hidden">{caption}</caption> : null}
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={column.align === "end" || column.money ? "is-end" : ""} style={column.width ? { width: column.width } : undefined}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => (
              <tr key={rowKey(row, index)} className={onRowClick ? "is-clickable" : ""} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {columns.map((column) => (
                  <td key={column.key} className={cx(column.align === "end" || column.money ? "is-end" : "", column.money && "is-money")}>
                    {column.render ? column.render(row) : row[column.key] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageSize && pages > 1 ? (
        <div className="adm-pagination">
          <span>
            {(current - 1) * pageSize + 1}–{Math.min(current * pageSize, rows.length)} of {rows.length}
          </span>
          <div>
            <button type="button" className="btn btn-outline-secondary btn-sm" disabled={current <= 1} onClick={() => setPage(current - 1)}>
              Previous
            </button>
            <button type="button" className="btn btn-outline-secondary btn-sm" disabled={current >= pages} onClick={() => setPage(current + 1)}>
              Next
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
};

// A long value (e.g. an OTA relay email) cut to one line, the full value in a tooltip.
export const Truncate = ({ value = "", max = 28 }) => {
  const text = String(value || "");
  if (!text) return "—";
  return (
    <span className="adm-truncate" title={text} style={{ maxWidth: `${max}ch` }}>
      {text}
    </span>
  );
};
