import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  BsArrowClockwise,
  BsBell,
  BsCalendar2Check,
  BsCalendar3,
  BsCashStack,
  BsCheck2Circle,
  BsChevronLeft,
  BsChevronRight,
  BsDownload,
  BsExclamationCircle,
  BsFunnel,
  BsGlobe2,
  BsInfoCircle,
  BsPlusLg,
  BsSearch,
  BsShop,
  BsThreeDotsVertical,
  BsXCircle
} from "react-icons/bs";
import { adminCancelBooking, fetchAdminBookings } from "../../api/bookingsApi";
import { formatCurrency, formatDate } from "../../utils/formatters";

const BOOKING_STATUSES = [
  { value: "all", label: "All Statuses" },
  { value: "confirmed", label: "Confirmed" },
  { value: "pending", label: "Pending" },
  { value: "cancelled", label: "Cancelled" },
  { value: "failed", label: "Failed" },
  { value: "edit_requested", label: "Edit Requested" }
];

const PAYMENT_STATUSES = [
  { value: "all", label: "All Payments" },
  { value: "paid", label: "Paid" },
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "failed", label: "Failed" },
  { value: "refunded", label: "Refunded" },
  { value: "partially_refunded", label: "Partially Refunded" },
  { value: "reversed", label: "Reversed" }
];

const SOURCE_OPTIONS = [
  { value: "all", label: "All Sources" },
  { value: "DIRECT_WEBSITE", label: "Direct" },
  { value: "GETYOURGUIDE", label: "GetYourGuide" },
  { value: "VIATOR", label: "Viator" },
  { value: "BOKUN_MARKETPLACE", label: "Bokun" },
  { value: "AGENT", label: "Agent / B2B" },
  { value: "OTHER", label: "Other" }
];

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const numberFormatter = new Intl.NumberFormat("en-US");
const CHART_COLORS = ["#0f9f95", "#2f80ed", "#63c6b4", "#7c83db", "#d66fc6", "#94a3b8"];
const PAYMENT_COLORS = {
  paid: "#22c55e",
  pending: "#f59e0b",
  processing: "#2f80ed",
  failed: "#ef4444",
  refunded: "#94a3b8",
  partially_refunded: "#0f766e",
  reversed: "#64748b"
};

const defaultLimit = () => {
  if (typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches) {
    return 10;
  }
  return 20;
};

const titleize = (value = "") =>
  String(value || "unknown")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());

const readQuery = (searchParams) => {
  const limit = Number(searchParams.get("limit") || defaultLimit());
  return {
    page: Math.max(1, Number(searchParams.get("page") || 1)),
    limit: PAGE_SIZE_OPTIONS.includes(limit) ? limit : defaultLimit(),
    search: searchParams.get("search") || "",
    from: searchParams.get("from") || "",
    to: searchParams.get("to") || "",
    status: searchParams.get("status") || "all",
    payment: searchParams.get("payment") || "all",
    source: searchParams.get("source") || "all",
    sortBy: searchParams.get("sortBy") || "createdAt",
    sortDirection: searchParams.get("sortDirection") || "desc"
  };
};

const buildQueryParams = (query) => {
  const params = new URLSearchParams();
  params.set("page", String(query.page || 1));
  params.set("limit", String(query.limit || defaultLimit()));

  ["search", "from", "to", "status", "payment", "source", "sortBy", "sortDirection"].forEach((key) => {
    const value = query[key];
    if (value && value !== "all" && !(key === "sortBy" && value === "createdAt") && !(key === "sortDirection" && value === "desc")) {
      params.set(key, String(value));
    }
  });

  return params;
};

const pct = (count, total) => {
  if (!total) return "0.0%";
  return `${((Number(count || 0) / Number(total || 0)) * 100).toFixed(1)}%`;
};

const getCustomerName = (booking = {}) => {
  const customer = booking.customer || {};
  return [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.email || "Unknown customer";
};

const getCustomerContact = (booking = {}) => {
  const customer = booking.customer || {};
  return customer.phone || customer.email || "";
};

const getBookingAmount = (booking = {}) => {
  const amount = booking.pricingSnapshot?.finalPayable ?? booking.amount ?? 0;
  const currency = booking.pricingSnapshot?.currency || booking.currency || "USD";
  return { amount: Number(amount || 0), currency };
};

const getBookingDateParts = (booking = {}) => {
  const bokunDates = booking.bokunOperationalDates || {};
  const date =
    bokunDates.travelDate?.localDate ||
    bokunDates.activityDate?.localDate ||
    booking.travelDate ||
    "";
  const time =
    bokunDates.activityStartTime?.localTime ||
    bokunDates.travelDate?.localTime ||
    booking.startTime ||
    "";

  return {
    date: date ? formatDate(date, "DD MMM YYYY") : "-",
    time
  };
};

const getSourceLabel = (value = "") => {
  const token = String(value || "").toUpperCase();
  const found = SOURCE_OPTIONS.find((option) => option.value === token);
  if (found && found.value !== "all") return found.label;
  if (token === "DIRECT_WEBSITE") return "Direct";
  if (token === "BOKUN_MARKETPLACE") return "Bokun";
  return value ? titleize(value) : "Unknown";
};

const getSourceIcon = (value = "") => {
  const token = String(value || "").toUpperCase();
  if (token.includes("GETYOURGUIDE")) return "G";
  if (token.includes("VIATOR")) return "V";
  if (token.includes("BOKUN")) return "B";
  if (token.includes("AGENT") || token.includes("B2B")) return "A";
  return <BsGlobe2 aria-hidden="true" />;
};

const getBadgeTone = (value = "") => {
  const status = String(value || "").toLowerCase();
  if (["confirmed", "paid", "completed"].includes(status)) return "success";
  if (["pending", "processing", "initiated", "edit_requested", "partial"].includes(status)) return "warning";
  if (["cancelled", "failed", "rejected", "verification_error"].includes(status)) return "danger";
  if (["refunded", "partially_refunded", "reversed"].includes(status)) return "neutral";
  return "muted";
};

const buildDonutRows = (rows = [], colorMap = {}) => {
  const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  return rows.slice(0, 6).map((row, index) => {
    const id = String(row._id || "unknown");
    return {
      id,
      label: id === "DIRECT_WEBSITE" ? "Direct" : getSourceLabel(id),
      count: Number(row.count || 0),
      percent: total ? Math.round((Number(row.count || 0) / total) * 100) : 0,
      color: colorMap[id.toLowerCase()] || colorMap[id] || CHART_COLORS[index % CHART_COLORS.length]
    };
  });
};

const donutGradient = (rows = []) => {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (!total) return "#e2e8f0";
  let cursor = 0;
  return `conic-gradient(${rows.map((row) => {
    const start = cursor;
    cursor += (row.count / total) * 360;
    return `${row.color} ${start}deg ${cursor}deg`;
  }).join(", ")})`;
};

const buildTrendPath = (rows = []) => {
  if (!rows.length) return { line: "", area: "", points: [] };
  const width = 360;
  const height = 145;
  const padX = 18;
  const padTop = 14;
  const padBottom = 28;
  const max = Math.max(...rows.map((row) => Number(row.count || 0)), 1);
  const usableWidth = width - padX * 2;
  const usableHeight = height - padTop - padBottom;
  const points = rows.map((row, index) => {
    const x = rows.length === 1 ? width / 2 : padX + (index / (rows.length - 1)) * usableWidth;
    const y = padTop + usableHeight - (Number(row.count || 0) / max) * usableHeight;
    return { x, y, row };
  });
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const area = `${line} L ${points[points.length - 1].x} ${height - padBottom} L ${points[0].x} ${height - padBottom} Z`;
  return { line, area, points };
};

const PageAction = ({ as: Component = "button", children, className = "", ...props }) => (
  <Component className={`admin-bookings-action ${className}`.trim()} {...props}>{children}</Component>
);

const MetricCard = ({ icon: Icon, label, value, detail, tone = "teal" }) => (
  <section className={`admin-bookings-card admin-bookings-metric is-${tone}`}>
    <span className="admin-bookings-metric-icon"><Icon aria-hidden="true" /></span>
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  </section>
);

const Skeleton = ({ rows = 3, className = "" }) => (
  <div className={`admin-bookings-skeleton ${className}`.trim()} aria-hidden="true">
    {Array.from({ length: rows }).map((_, index) => <span key={index} />)}
  </div>
);

const ErrorState = ({ message, onRetry }) => (
  <div className="admin-bookings-error" role="alert">
    <BsExclamationCircle aria-hidden="true" />
    <div>
      <strong>We could not load bookings.</strong>
      <span>{message || "Please retry."}</span>
    </div>
    <button type="button" onClick={onRetry}>Retry</button>
  </div>
);

const EmptyState = ({ onReset }) => (
  <div className="admin-bookings-empty">
    <BsInfoCircle aria-hidden="true" />
    <strong>No bookings found.</strong>
    <span>Try changing your filters or search.</span>
    <button type="button" onClick={onReset}>Reset filters</button>
  </div>
);

const Badge = ({ value }) => (
  <span className={`admin-bookings-badge is-${getBadgeTone(value)}`}>{titleize(value)}</span>
);

const TrendChart = ({ rows = [], loading }) => {
  if (loading) return <Skeleton rows={4} className="is-chart" />;
  if (!rows.length) return <div className="admin-bookings-mini-empty">No booking trend data.</div>;

  const { line, area, points } = buildTrendPath(rows);
  return (
    <div className="admin-bookings-trend-chart">
      <svg viewBox="0 0 360 145" role="img" aria-label="Bookings trend">
        <path d={area} className="admin-bookings-chart-area" />
        <path d={line} className="admin-bookings-chart-line" />
        {points.map((point) => (
          <circle key={point.row._id} cx={point.x} cy={point.y} r="3.5" />
        ))}
      </svg>
      <div className="admin-bookings-trend-labels">
        {rows.map((row) => <span key={row._id}>{formatDate(row._id, "MMM D")}</span>)}
      </div>
    </div>
  );
};

const DonutChart = ({ rows = [], total = 0, loading, emptyMessage }) => {
  if (loading) return <Skeleton rows={4} className="is-chart" />;
  if (!rows.length || total <= 0) return <div className="admin-bookings-mini-empty">{emptyMessage}</div>;

  return (
    <div className="admin-bookings-donut-wrap">
      <div className="admin-bookings-donut" style={{ background: donutGradient(rows) }}>
        <div>
          <strong>{numberFormatter.format(total)}</strong>
          <span>Total</span>
        </div>
      </div>
      <div className="admin-bookings-chart-legend">
        {rows.map((row) => (
          <div key={row.id}>
            <span><i style={{ backgroundColor: row.color }} />{row.label}</span>
            <strong>{row.percent}% ({numberFormatter.format(row.count)})</strong>
          </div>
        ))}
      </div>
    </div>
  );
};

const FilterFields = ({ filters, onChange }) => (
  <>
    <label className="admin-bookings-filter-field">
      <span>Date from</span>
      <input type="date" value={filters.from} onChange={(event) => onChange("from", event.target.value)} />
    </label>
    <label className="admin-bookings-filter-field">
      <span>Date to</span>
      <input type="date" value={filters.to} onChange={(event) => onChange("to", event.target.value)} />
    </label>
    <label className="admin-bookings-filter-field">
      <span>Status</span>
      <select value={filters.status} onChange={(event) => onChange("status", event.target.value)}>
        {BOOKING_STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
    <label className="admin-bookings-filter-field">
      <span>Payment</span>
      <select value={filters.payment} onChange={(event) => onChange("payment", event.target.value)}>
        {PAYMENT_STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
    <label className="admin-bookings-filter-field">
      <span>Source</span>
      <select value={filters.source} onChange={(event) => onChange("source", event.target.value)}>
        {SOURCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  </>
);

const SortButton = ({ label, sortBy, query, onSort }) => {
  const active = query.sortBy === sortBy;
  const direction = active ? query.sortDirection : "desc";
  return (
    <button type="button" className={`admin-bookings-sort ${active ? "is-active" : ""}`} onClick={() => onSort(sortBy)}>
      {label} <span>{active ? direction === "asc" ? "up" : "down" : ""}</span>
    </button>
  );
};

const RowActions = ({ booking, open, onToggle, onCancel }) => {
  const reference = booking.bookingReference || "";
  const canCancel = booking.bookingStatus !== "cancelled";

  return (
    <div className="admin-bookings-row-actions">
      <button
        type="button"
        className="admin-bookings-icon-button"
        aria-label={`Actions for booking ${reference || "row"}`}
        aria-expanded={open}
        onClick={onToggle}
      >
        <BsThreeDotsVertical aria-hidden="true" />
      </button>
      {open ? (
        <div className="admin-bookings-action-menu">
          <Link to={`/my-booking/${encodeURIComponent(reference)}`}>View booking</Link>
          <Link to={`/invoice/${encodeURIComponent(reference)}`}>View invoice</Link>
          <Link to={`/admin/audit-control?reference=${encodeURIComponent(reference)}`}>Audit history</Link>
          <Link to={`/admin/operations/bokun-sync/single-booking?reference=${encodeURIComponent(reference)}`}>Resync from Bokun</Link>
          <button type="button" disabled={!canCancel} onClick={onCancel}>Request cancellation</button>
        </div>
      ) : null}
    </div>
  );
};

const BookingsTable = ({ bookings, loading, openActionId, onToggleAction, onCancel, query, onSort }) => {
  if (loading) return <Skeleton rows={8} className="is-table" />;

  return (
    <div className="admin-bookings-table-scroll">
      <table className="admin-bookings-table">
        <thead>
          <tr>
            <th><SortButton label="Reference" sortBy="reference" query={query} onSort={onSort} /></th>
            <th>Product</th>
            <th><SortButton label="Date" sortBy="travelDate" query={query} onSort={onSort} /></th>
            <th>Customer</th>
            <th>Status</th>
            <th>Payment</th>
            <th>Source</th>
            <th className="text-end"><SortButton label="Total" sortBy="total" query={query} onSort={onSort} /></th>
            <th className="text-end">Actions</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((booking) => {
            const reference = booking.bookingReference || booking._id;
            const dateParts = getBookingDateParts(booking);
            const money = getBookingAmount(booking);
            const source = booking.salesChannel || booking.sourceChannel || "";
            return (
              <tr key={booking._id || reference}>
                <td>
                  <Link className="admin-bookings-reference" to={`/my-booking/${encodeURIComponent(booking.bookingReference || "")}`}>
                    {booking.bookingReference || "-"}
                  </Link>
                  {booking.bokunBookingId || booking.bokunConfirmationCode ? (
                    <small title={`Bokun ${booking.bokunBookingId || booking.bokunConfirmationCode}`}>
                      Bokun {booking.bokunConfirmationCode || booking.bokunBookingId}
                    </small>
                  ) : null}
                </td>
                <td className="admin-bookings-product-cell">
                  <strong>{booking.productTitle || "-"}</strong>
                  {booking.optionTitle ? <small>{booking.optionTitle}</small> : null}
                </td>
                <td className="admin-bookings-date-cell">
                  <strong>{dateParts.date}</strong>
                  {dateParts.time ? <small>{dateParts.time}</small> : null}
                </td>
                <td className="admin-bookings-customer-cell">
                  <strong>{getCustomerName(booking)}</strong>
                  {getCustomerContact(booking) ? <small>{getCustomerContact(booking)}</small> : null}
                </td>
                <td><Badge value={booking.bookingStatus} /></td>
                <td><Badge value={booking.paymentStatus} /></td>
                <td>
                  <span className="admin-bookings-source">
                    <i>{getSourceIcon(source)}</i>
                    {getSourceLabel(source)}
                  </span>
                </td>
                <td className="text-end admin-bookings-total-cell">
                  <strong>{formatCurrency(money.amount, money.currency)}</strong>
                </td>
                <td className="text-end">
                  <RowActions
                    booking={booking}
                    open={openActionId === String(booking._id || reference)}
                    onToggle={() => onToggleAction(String(booking._id || reference))}
                    onCancel={() => onCancel(booking)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const MobileBookingsList = ({ bookings, loading, openActionId, onToggleAction, onCancel }) => {
  if (loading) return <Skeleton rows={6} className="is-table" />;

  return (
    <div className="admin-bookings-mobile-list">
      {bookings.map((booking) => {
        const reference = booking.bookingReference || booking._id;
        const dateParts = getBookingDateParts(booking);
        const money = getBookingAmount(booking);
        const source = booking.salesChannel || booking.sourceChannel || "";
        return (
          <article className="admin-bookings-mobile-card" key={booking._id || reference}>
            <div className="admin-bookings-mobile-head">
              <div>
                <Link to={`/my-booking/${encodeURIComponent(booking.bookingReference || "")}`}>{booking.bookingReference || "-"}</Link>
                <strong>{booking.productTitle || "-"}</strong>
              </div>
              <RowActions
                booking={booking}
                open={openActionId === String(booking._id || reference)}
                onToggle={() => onToggleAction(String(booking._id || reference))}
                onCancel={() => onCancel(booking)}
              />
            </div>
            <div className="admin-bookings-mobile-meta">
              <span>{dateParts.date}{dateParts.time ? ` at ${dateParts.time}` : ""}</span>
              <span>{getCustomerName(booking)}</span>
            </div>
            <div className="admin-bookings-mobile-badges">
              <Badge value={booking.bookingStatus} />
              <Badge value={booking.paymentStatus} />
            </div>
            <div className="admin-bookings-mobile-foot">
              <span className="admin-bookings-source"><i>{getSourceIcon(source)}</i>{getSourceLabel(source)}</span>
              <strong>{formatCurrency(money.amount, money.currency)}</strong>
            </div>
          </article>
        );
      })}
    </div>
  );
};

const Pagination = ({ pagination, onPageChange, onLimitChange }) => {
  const page = Number(pagination.page || 1);
  const total = Number(pagination.total || 0);
  const totalPages = Number(pagination.totalPages || 1);
  const limit = Number(pagination.limit || defaultLimit());
  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1)
    .filter((item) => item === 1 || item === totalPages || Math.abs(item - page) <= 1);

  return (
    <div className="admin-bookings-pagination">
      <span>Showing {numberFormatter.format(start)}-{numberFormatter.format(end)} of {numberFormatter.format(total)} bookings</span>
      <div className="admin-bookings-pagination-desktop">
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page">
          <BsChevronLeft aria-hidden="true" />
        </button>
        {pageNumbers.map((item, index) => {
          const previous = pageNumbers[index - 1];
          return (
            <span key={item} className="admin-bookings-page-number-wrap">
              {previous && item - previous > 1 ? <em>...</em> : null}
              <button type="button" className={item === page ? "is-active" : ""} onClick={() => onPageChange(item)}>
                {item}
              </button>
            </span>
          );
        })}
        <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label="Next page">
          <BsChevronRight aria-hidden="true" />
        </button>
        <select value={limit} onChange={(event) => onLimitChange(Number(event.target.value))} aria-label="Rows per page">
          {PAGE_SIZE_OPTIONS.map((option) => <option key={option} value={option}>{option} / page</option>)}
        </select>
      </div>
      <div className="admin-bookings-pagination-mobile">
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Previous</button>
        <strong>Page {page} of {totalPages}</strong>
        <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>Next</button>
      </div>
    </div>
  );
};

const AdminBookingsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(() => readQuery(searchParams));
  const [searchDraft, setSearchDraft] = useState(query.search);
  const [data, setData] = useState({ items: [], summary: {}, pagination: { page: 1, limit: defaultLimit(), total: 0, totalPages: 1 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openActionId, setOpenActionId] = useState("");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [actionBusyId, setActionBusyId] = useState("");

  const updateQuery = useCallback((updates, { resetPage = true } = {}) => {
    setSearchParams((currentParams) => {
      const current = readQuery(currentParams);
      const next = {
        ...current,
        ...updates,
        page: resetPage ? 1 : updates.page || current.page
      };
      return buildQueryParams(next);
    });
  }, [setSearchParams]);

  useEffect(() => {
    const next = readQuery(searchParams);
    setQuery(next);
    setSearchDraft(next.search);
  }, [searchParams]);

  const loadBookings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchAdminBookings(query);
      setData({
        items: result.items || [],
        summary: result.summary || {},
        pagination: result.pagination || { page: query.page, limit: query.limit, total: 0, totalPages: 1 }
      });
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to load bookings");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = mobileFiltersOpen ? "hidden" : previousOverflow;

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileFiltersOpen]);

  useEffect(() => {
    if (searchDraft === query.search) return undefined;
    const timer = window.setTimeout(() => {
      updateQuery({ search: searchDraft }, { resetPage: true });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [query.search, searchDraft, updateQuery]);

  const handleFilterChange = (key, value) => {
    updateQuery({ [key]: value }, { resetPage: true });
  };

  const handleSort = (sortBy) => {
    const sameSort = query.sortBy === sortBy;
    updateQuery({
      sortBy,
      sortDirection: sameSort && query.sortDirection === "asc" ? "desc" : "asc"
    }, { resetPage: false });
  };

  const resetFilters = () => {
    setSearchParams(buildQueryParams({ page: 1, limit: defaultLimit(), sortBy: "createdAt", sortDirection: "desc" }));
    setMobileFiltersOpen(false);
  };

  const handleCancel = async (booking) => {
    const ok = window.confirm(`Request cancellation for booking ${booking.bookingReference}?`);
    if (!ok) return;

    setError("");
    setNotice("");
    setActionBusyId(String(booking._id || booking.bookingReference));
    try {
      await adminCancelBooking(booking._id, "Cancelled from admin bookings page");
      setNotice(`${booking.bookingReference} cancellation submitted.`);
      await loadBookings();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to cancel booking");
    } finally {
      setActionBusyId("");
      setOpenActionId("");
    }
  };

  const toggleActionMenu = (id) => {
    if (actionBusyId) return;
    setOpenActionId((current) => current === id ? "" : id);
  };

  const summary = data.summary || {};
  const totalBookings = Number(summary.totalBookings || data.pagination?.total || 0);
  const bookedValue = Number(summary.bookedValue || 0);
  const sourceRows = useMemo(() => buildDonutRows(summary.sourceBreakdown || []), [summary.sourceBreakdown]);
  const paymentRows = useMemo(() => buildDonutRows(summary.paymentStatusBreakdown || [], PAYMENT_COLORS), [summary.paymentStatusBreakdown]);
  const sourceTotal = sourceRows.reduce((sum, row) => sum + row.count, 0);
  const paymentTotal = paymentRows.reduce((sum, row) => sum + row.count, 0);

  const metrics = [
    {
      label: "Total Bookings",
      value: loading ? "--" : numberFormatter.format(totalBookings),
      detail: "Matching current filters",
      icon: BsCalendar2Check,
      tone: "blue"
    },
    {
      label: "Confirmed",
      value: loading ? "--" : numberFormatter.format(summary.confirmed || 0),
      detail: `${pct(summary.confirmed, totalBookings)} of total`,
      icon: BsCheck2Circle,
      tone: "green"
    },
    {
      label: "Pending",
      value: loading ? "--" : numberFormatter.format(summary.pending || 0),
      detail: `${pct(summary.pending, totalBookings)} of total`,
      icon: BsCalendar3,
      tone: "amber"
    },
    {
      label: "Cancelled",
      value: loading ? "--" : numberFormatter.format(summary.cancelled || 0),
      detail: `${pct(summary.cancelled, totalBookings)} of total`,
      icon: BsXCircle,
      tone: "red"
    },
    {
      label: "Booked Value",
      value: loading ? "--" : formatCurrency(bookedValue, "USD"),
      detail: "Booking value, not ledger revenue",
      icon: BsCashStack,
      tone: "green"
    },
    {
      label: "Avg. Order Value",
      value: loading ? "--" : formatCurrency(summary.averageOrderValue || 0, "USD"),
      detail: "Booked value per booking",
      icon: BsShop,
      tone: "blue"
    }
  ];

  return (
    <div className="admin-bookings-page">
      <div className="admin-bookings-page-head">
        <div>
          <span>Operations / Bookings</span>
          <h1>Bookings</h1>
          <p>Manage all bookings and reservations</p>
        </div>
        <div className="admin-bookings-actions">
          <PageAction as={Link} to="/admin/operations/bokun-sync/confirmed-import">
            <BsArrowClockwise aria-hidden="true" />
            Sync Bokun
          </PageAction>
          <PageAction as={Link} to="/admin/operations/recovery">
            <BsBell aria-hidden="true" />
            Alerts
          </PageAction>
          <PageAction as={Link} to="/admin/report-center">
            <BsDownload aria-hidden="true" />
            Export
          </PageAction>
          <PageAction as={Link} to="/tours" className="is-primary">
            <BsPlusLg aria-hidden="true" />
            New Booking
          </PageAction>
        </div>
      </div>

      {notice ? <div className="admin-bookings-notice">{notice}</div> : null}

      <div className="admin-bookings-metric-grid">
        {metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}
      </div>

      <div className="admin-bookings-chart-grid">
        <section className="admin-bookings-card admin-bookings-chart-card">
          <div className="admin-bookings-card-head">
            <h2>Bookings Trend</h2>
            <span>Last 7 travel dates</span>
          </div>
          <TrendChart rows={summary.trend || []} loading={loading} />
        </section>
        <section className="admin-bookings-card admin-bookings-chart-card">
          <div className="admin-bookings-card-head">
            <h2>Bookings by Source</h2>
          </div>
          <DonutChart rows={sourceRows} total={sourceTotal} loading={loading} emptyMessage="No source data available." />
        </section>
        <section className="admin-bookings-card admin-bookings-chart-card">
          <div className="admin-bookings-card-head">
            <h2>Payment Status</h2>
          </div>
          <DonutChart rows={paymentRows} total={paymentTotal} loading={loading} emptyMessage="No payment data available." />
        </section>
      </div>

      <section className="admin-bookings-filter-card">
        <label className="admin-bookings-search">
          <BsSearch aria-hidden="true" />
          <input
            type="search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Search by reference, customer, product..."
          />
        </label>
        <div className="admin-bookings-filter-desktop">
          <FilterFields filters={query} onChange={handleFilterChange} />
          <button type="button" className="admin-bookings-filter-button" onClick={loadBookings}>
            <BsFunnel aria-hidden="true" />
            Filters
          </button>
          <button type="button" className="admin-bookings-reset-button" onClick={resetFilters}>
            Reset
          </button>
        </div>
        <button type="button" className="admin-bookings-mobile-filter-trigger" onClick={() => setMobileFiltersOpen(true)}>
          <BsFunnel aria-hidden="true" />
          Filters
        </button>
      </section>

      {mobileFiltersOpen ? (
        <div className="admin-bookings-filter-overlay" role="presentation" onClick={() => setMobileFiltersOpen(false)}>
          <div className="admin-bookings-filter-sheet" role="dialog" aria-modal="true" aria-label="Booking filters" onClick={(event) => event.stopPropagation()}>
            <div className="admin-bookings-filter-sheet-head">
              <strong>Filters</strong>
              <button type="button" onClick={() => setMobileFiltersOpen(false)} aria-label="Close filters"><BsXCircle aria-hidden="true" /></button>
            </div>
            <FilterFields filters={query} onChange={handleFilterChange} />
            <div className="admin-bookings-filter-sheet-actions">
              <button type="button" onClick={() => setMobileFiltersOpen(false)}>Apply filters</button>
              <button type="button" onClick={resetFilters}>Reset</button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="admin-bookings-card admin-bookings-table-card">
        {error ? (
          <ErrorState message={error} onRetry={loadBookings} />
        ) : !loading && !data.items.length ? (
          <EmptyState onReset={resetFilters} />
        ) : (
          <>
            <BookingsTable
              bookings={data.items}
              loading={loading}
              openActionId={openActionId}
              onToggleAction={toggleActionMenu}
              onCancel={handleCancel}
              query={query}
              onSort={handleSort}
            />
            <MobileBookingsList
              bookings={data.items}
              loading={loading}
              openActionId={openActionId}
              onToggleAction={toggleActionMenu}
              onCancel={handleCancel}
            />
            <Pagination
              pagination={data.pagination || {}}
              onPageChange={(page) => updateQuery({ page }, { resetPage: false })}
              onLimitChange={(limit) => updateQuery({ limit, page: 1 }, { resetPage: false })}
            />
          </>
        )}
      </section>
    </div>
  );
};

export default AdminBookingsPage;
