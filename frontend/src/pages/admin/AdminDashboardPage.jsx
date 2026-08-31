import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BsArrowRepeat,
  BsBell,
  BsCalendar2Check,
  BsCalendar3,
  BsCashStack,
  BsCloudCheck,
  BsDownload,
  BsExclamationTriangle,
  BsGeoAlt,
  BsInfoCircle,
  BsPersonCheck,
  BsThreeDotsVertical,
  BsTruck
} from "react-icons/bs";
import {
  fetchBokunSyncStatus,
  fetchDashboardSummary,
  fetchMonthlySalesReport,
  fetchOperationalAlerts,
  fetchOperationsOverview
} from "../../api/adminApi";
import { fetchRecentBookings } from "../../api/bookingsApi";
import { formatCurrency, formatDate } from "../../utils/formatters";

const numberFormatter = new Intl.NumberFormat("en-US");

const CHANNEL_COLORS = ["#16a085", "#2f80ed", "#6b7280", "#f9735b", "#a855f7", "#94a3b8"];
const STATUS_COLORS = {
  confirmed: "#16a085",
  pending: "#f59e0b",
  cancelled: "#ef4444",
  completed: "#64748b",
  failed: "#ef4444",
  refunded: "#0f766e"
};

const CHANNEL_LABELS = {
  DIRECT_WEBSITE: "Direct Website",
  direct_website: "Direct Website",
  GETYOURGUIDE: "GetYourGuide",
  getyourguide: "GetYourGuide",
  VIATOR: "Viator",
  viator: "Viator",
  BOKUN_MARKETPLACE: "Bokun Marketplace",
  bokun_marketplace: "Bokun Marketplace",
  AGENT: "Agent / B2B",
  agent: "Agent / B2B",
  B2B: "Agent / B2B",
  HOTEL: "Hotel",
  WHATSAPP: "WhatsApp",
  WALK_IN: "Walk-in",
  TOURHQ: "TourHQ",
  AIRBNB: "Airbnb",
  OTHER: "Other"
};

const emptyDashboardData = {
  summary: null,
  recentBookings: [],
  monthlySales: [],
  operationalAlerts: null,
  operationsOverview: null,
  bokunSyncStatus: null
};

const requestDashboardWidget = async (key, request, fallbackMessage) => {
  try {
    return { key, ok: true, data: await request() };
  } catch (err) {
    return {
      key,
      ok: false,
      error: err?.response?.data?.message || err?.message || fallbackMessage
    };
  }
};

const titleize = (value = "") =>
  String(value || "unknown")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());

const formatCompactCurrency = (amount = 0, currency = "USD") => {
  const numericAmount = Number(amount || 0);
  if (Math.abs(numericAmount) >= 1000000) {
    return formatCurrency(numericAmount / 1000000, currency).replace(/\.00$/, "") + "M";
  }
  if (Math.abs(numericAmount) >= 1000) {
    return formatCurrency(numericAmount / 1000, currency).replace(/\.00$/, "") + "K";
  }
  return formatCurrency(numericAmount, currency);
};

const formatMonthLabel = (value = "") => {
  const [year, month] = String(value).split("-");
  if (!year || !month) return value || "-";
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-US", { month: "short" });
};

const formatRelativeTime = (value) => {
  if (!value) return "-";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "-";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const normalizeStatus = (value = "") => String(value || "unknown").toLowerCase();

const getStatusTone = (value = "") => {
  const status = normalizeStatus(value);
  if (["confirmed", "paid", "completed", "refunded"].includes(status)) return "success";
  if (["pending", "processing", "supplier_pending", "edit_requested"].includes(status)) return "warning";
  if (["cancelled", "failed", "rejected"].includes(status)) return "danger";
  return "neutral";
};

const getBookingCustomerName = (booking = {}) => {
  const customer = booking.customer || {};
  return [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.email || "-";
};

const getBookingDate = (booking = {}) => {
  const date = formatDate(booking.travelDate);
  return booking.startTime ? `${date} ${booking.startTime}` : date;
};

const getBookingAmount = (booking = {}) => {
  const amount = booking.pricingSnapshot?.finalPayable ?? booking.amount ?? 0;
  const currency = booking.pricingSnapshot?.currency || booking.currency || "USD";
  return formatCurrency(amount, currency);
};

const getBookingSourceLabel = (source) => CHANNEL_LABELS[source] || CHANNEL_LABELS[String(source || "").toUpperCase()] || titleize(source);

const normalizeBreakdownRows = (rows = [], type = "channel") => {
  const total = rows.reduce((sum, row) => sum + Number(row.count || row.bookings || 0), 0);

  return rows.slice(0, 6).map((row, index) => {
    const key = row._id || "unknown";
    const count = Number(row.count || row.bookings || 0);
    const normalizedStatus = normalizeStatus(key);
    return {
      id: key,
      label: type === "status" ? titleize(normalizedStatus) : getBookingSourceLabel(key),
      count,
      percent: total > 0 ? Math.round((count / total) * 100) : 0,
      sales: Number(row.sales || 0),
      color: type === "status" ? STATUS_COLORS[normalizedStatus] || "#94a3b8" : CHANNEL_COLORS[index % CHANNEL_COLORS.length]
    };
  });
};

const buildDonutGradient = (rows = []) => {
  const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  if (!total) return "#e2e8f0";

  let cursor = 0;
  const stops = rows.map((row) => {
    const size = (Number(row.count || 0) / total) * 360;
    const start = cursor;
    cursor += size;
    return `${row.color} ${start}deg ${cursor}deg`;
  });

  return `conic-gradient(${stops.join(", ")})`;
};

const DashboardCard = ({ children, className = "" }) => (
  <section className={`admin-dashboard-card ${className}`.trim()}>{children}</section>
);

const CardHeader = ({ title, detail, action }) => (
  <div className="admin-dashboard-card-header">
    <div>
      <h2>{title}</h2>
      {detail ? <p>{detail}</p> : null}
    </div>
    {action}
  </div>
);

const EmptyState = ({ message }) => (
  <div className="admin-dashboard-empty-state">
    <BsInfoCircle aria-hidden="true" />
    <span>{message}</span>
  </div>
);

const WidgetError = ({ message, onRetry }) => (
  <div className="admin-dashboard-widget-error" role="alert">
    <BsExclamationTriangle aria-hidden="true" />
    <div>
      <strong>Unable to load this widget.</strong>
      <span>{message}</span>
    </div>
    <button type="button" onClick={onRetry}>Retry</button>
  </div>
);

const SkeletonBlock = ({ rows = 3, className = "" }) => (
  <div className={`admin-dashboard-skeleton ${className}`.trim()} aria-hidden="true">
    {Array.from({ length: rows }).map((_, index) => <span key={index} />)}
  </div>
);

const KpiCard = ({ icon: Icon, label, value, detail, tone = "teal" }) => (
  <DashboardCard className={`admin-dashboard-kpi-card is-${tone}`}>
    <div className="admin-dashboard-kpi-icon">
      <Icon aria-hidden="true" />
    </div>
    <div className="admin-dashboard-kpi-copy">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  </DashboardCard>
);

const StatusBadge = ({ value }) => {
  const tone = getStatusTone(value);
  return <span className={`admin-dashboard-status-badge is-${tone}`}>{titleize(value)}</span>;
};

const RecentBookingsWidget = ({ bookings, loading, error, onRetry }) => {
  if (loading) return <SkeletonBlock rows={8} className="is-table" />;
  if (error) return <WidgetError message={error} onRetry={onRetry} />;
  if (!bookings.length) return <EmptyState message="No recent bookings." />;

  const visibleBookings = bookings.slice(0, 8);

  return (
    <>
      <div className="admin-dashboard-table-scroll">
        <table className="admin-dashboard-table">
          <thead>
            <tr>
              <th>Reference</th>
              <th>Product</th>
              <th>Date</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Payment</th>
              <th className="text-end">Amount</th>
              <th className="text-end">Action</th>
            </tr>
          </thead>
          <tbody>
            {visibleBookings.map((booking) => (
              <tr key={booking._id || booking.bookingReference}>
                <td><strong>{booking.bookingReference || "-"}</strong></td>
                <td className="admin-dashboard-truncate">
                  <span>{booking.productTitle || "-"}</span>
                  {booking.optionTitle ? <small>{booking.optionTitle}</small> : null}
                </td>
                <td>{getBookingDate(booking)}</td>
                <td className="admin-dashboard-truncate">{getBookingCustomerName(booking)}</td>
                <td><StatusBadge value={booking.bookingStatus} /></td>
                <td><StatusBadge value={booking.paymentStatus} /></td>
                <td className="text-end">{getBookingAmount(booking)}</td>
                <td className="text-end">
                  <button type="button" className="admin-dashboard-icon-action" disabled aria-label="Booking actions unavailable">
                    <BsThreeDotsVertical aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="admin-dashboard-booking-list">
        {visibleBookings.map((booking) => (
          <article key={booking._id || booking.bookingReference} className="admin-dashboard-booking-item">
            <div>
              <strong>{booking.bookingReference || "-"}</strong>
              <span>{booking.productTitle || "-"}</span>
            </div>
            <div className="admin-dashboard-booking-meta">
              <span>{getBookingDate(booking)}</span>
              <span>{getBookingCustomerName(booking)}</span>
            </div>
            <div className="admin-dashboard-booking-footer">
              <div>
                <StatusBadge value={booking.bookingStatus} />
                <StatusBadge value={booking.paymentStatus} />
              </div>
              <strong>{getBookingAmount(booking)}</strong>
            </div>
          </article>
        ))}
      </div>
    </>
  );
};

const MonthlySalesWidget = ({ rows, loading, error, onRetry }) => {
  if (loading) return <SkeletonBlock rows={6} className="is-chart" />;
  if (error) return <WidgetError message={error} onRetry={onRetry} />;

  const salesRows = [...rows].reverse().slice(-7);
  const maxSales = Math.max(...salesRows.map((row) => Number(row.sales || 0)), 0);
  if (!salesRows.length || maxSales <= 0) return <EmptyState message="No sales data available for this period." />;

  return (
    <div className="admin-dashboard-bar-chart" role="img" aria-label="Monthly sales by month">
      {salesRows.map((row) => {
        const sales = Number(row.sales || 0);
        const height = maxSales > 0 ? Math.max((sales / maxSales) * 100, 8) : 0;
        return (
          <div className="admin-dashboard-bar-column" key={row._id}>
            <span className="admin-dashboard-bar-value">{formatCompactCurrency(sales, "USD")}</span>
            <div className="admin-dashboard-bar-track">
              <span style={{ height: `${height}%` }} />
            </div>
            <span className="admin-dashboard-bar-label">{formatMonthLabel(row._id)}</span>
          </div>
        );
      })}
    </div>
  );
};

const OperationalAlertsWidget = ({ alerts, loading, error, onRetry }) => {
  if (loading) return <SkeletonBlock rows={5} />;
  if (error) return <WidgetError message={error} onRetry={onRetry} />;

  const items = alerts.slice(0, 5);
  if (!items.length) return <EmptyState message="No operational alerts." />;

  return (
    <div className="admin-dashboard-alert-list">
      {items.map((alert) => {
        const severity = alert.severity === "danger" ? "critical" : alert.type?.includes("sync") ? "integration" : "warning";
        const Icon = severity === "critical" ? BsExclamationTriangle : severity === "integration" ? BsCloudCheck : BsInfoCircle;
        return (
          <article key={alert.id} className={`admin-dashboard-alert-item is-${severity}`}>
            <span className="admin-dashboard-alert-icon"><Icon aria-hidden="true" /></span>
            <div className="admin-dashboard-alert-copy">
              <strong>{alert.title}</strong>
              <span>{alert.description}</span>
            </div>
            <time>{formatRelativeTime(alert.createdAt)}</time>
          </article>
        );
      })}
    </div>
  );
};

const DonutSummaryWidget = ({ rows, total, centerLabel, emptyMessage, valueLabel = "bookings" }) => {
  if (!rows.length || total <= 0) return <EmptyState message={emptyMessage} />;

  return (
    <div className="admin-dashboard-donut-summary">
      <div className="admin-dashboard-donut" style={{ background: buildDonutGradient(rows) }}>
        <div>
          <strong>{numberFormatter.format(total)}</strong>
          <span>{centerLabel}</span>
        </div>
      </div>
      <div className="admin-dashboard-breakdown-list">
        {rows.map((row) => (
          <div key={row.id} className="admin-dashboard-breakdown-row">
            <span className="admin-dashboard-breakdown-label">
              <i style={{ backgroundColor: row.color }} />
              {row.label}
            </span>
            <strong>{numberFormatter.format(row.count)} <small>{row.percent}%</small></strong>
          </div>
        ))}
      </div>
      <span className="visually-hidden">{valueLabel}</span>
    </div>
  );
};

const TopProductsWidget = ({ products = [], loading, error, onRetry }) => {
  if (loading) return <SkeletonBlock rows={5} className="is-table" />;
  if (error) return <WidgetError message={error} onRetry={onRetry} />;
  if (!products.length) return <EmptyState message="No product performance data available." />;

  return (
    <div className="admin-dashboard-compact-table">
      {products.slice(0, 5).map((product) => (
        <div key={product._id || product.productTitle} className="admin-dashboard-compact-row">
          <span>{product._id || "Unknown product"}</span>
          <strong>{numberFormatter.format(product.bookings || 0)}</strong>
          <em>{formatCurrency(product.sales || 0, "USD")}</em>
        </div>
      ))}
    </div>
  );
};

const AdminDashboardPage = () => {
  const [dashboardData, setDashboardData] = useState(emptyDashboardData);
  const [widgetErrors, setWidgetErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadDashboard = useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    const results = await Promise.all([
      requestDashboardWidget("summary", fetchDashboardSummary, "Failed to load dashboard summary"),
      requestDashboardWidget("recentBookings", fetchRecentBookings, "Failed to load recent bookings"),
      requestDashboardWidget("monthlySales", fetchMonthlySalesReport, "Failed to load monthly sales"),
      requestDashboardWidget("operationalAlerts", fetchOperationalAlerts, "Failed to load operational alerts"),
      requestDashboardWidget("operationsOverview", fetchOperationsOverview, "Failed to load operations overview"),
      requestDashboardWidget("bokunSyncStatus", fetchBokunSyncStatus, "Failed to load Bokun sync status")
    ]);

    const nextData = {};
    const nextErrors = {};

    results.forEach((result) => {
      if (result.ok) {
        nextData[result.key] = result.data;
      } else {
        nextErrors[result.key] = result.error;
      }
    });

    setDashboardData((current) => ({ ...current, ...nextData }));
    setWidgetErrors(nextErrors);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const summary = dashboardData.summary || {};
  const kpis = summary.kpis || {};
  const operationsOverview = dashboardData.operationsOverview || {};
  const queue = operationsOverview.queue || {};
  const operationalAlerts = dashboardData.operationalAlerts?.alerts || [];
  const unreadAlerts =
    Number(dashboardData.operationalAlerts?.counts?.paidPendingSupplier || 0) +
    Number(dashboardData.operationalAlerts?.counts?.failedPayments || 0) +
    Number(dashboardData.operationalAlerts?.counts?.failedEmailDeliveries || 0) +
    Number(queue.retriableFinalizations || 0) +
    Number(queue.openBookingRequests || 0);

  const sourceRows = useMemo(() => normalizeBreakdownRows(summary.sourceBreakdown || [], "channel"), [summary.sourceBreakdown]);
  const statusRows = useMemo(() => normalizeBreakdownRows(summary.bookingStatusBreakdown || [], "status"), [summary.bookingStatusBreakdown]);
  const sourceTotal = sourceRows.reduce((sum, row) => sum + row.count, 0);
  const statusTotal = statusRows.reduce((sum, row) => sum + row.count, 0);

  const fleet = operationsOverview.fleet || {};
  const trips = operationsOverview.trips || {};
  const activeVehicles = fleet.activeVehicles ?? null;
  const activeDrivers = fleet.activeDrivers ?? null;
  const onTripNow = trips.onTripNow ?? null;
  const bokunStatus = dashboardData.bokunSyncStatus;
  const bokunMode = bokunStatus?.integration?.dataMode || "unknown";
  const bokunWorker = bokunStatus?.confirmedBookingImport?.worker || {};
  const bokunReady = Boolean(bokunStatus?.confirmedBookingImport?.ready);
  const latestBokunSync = queue.latestBokunSync;

  const metricCards = [
    {
      id: "total-bookings",
      label: "Total Bookings",
      value: widgetErrors.summary && !summary.kpis ? "--" : numberFormatter.format(kpis.totalBookings || 0),
      detail: `${numberFormatter.format(kpis.confirmedBookings || 0)} confirmed`,
      icon: BsCalendar2Check,
      tone: "blue"
    },
    {
      id: "gross-revenue",
      label: "Gross Revenue",
      value: widgetErrors.summary && !summary.kpis ? "--" : formatCurrency(kpis.totalSales || 0, "USD"),
      detail: "Reported gross sales",
      icon: BsCashStack,
      tone: "teal"
    },
    {
      id: "active-vehicles",
      label: "Active Vehicles",
      value: activeVehicles == null ? "--" : numberFormatter.format(activeVehicles),
      detail: activeVehicles == null ? "Fleet KPI unavailable" : "Ready for dispatch",
      icon: BsTruck,
      tone: "purple"
    },
    {
      id: "active-drivers",
      label: "Active Drivers",
      value: activeDrivers == null ? "--" : numberFormatter.format(activeDrivers),
      detail: activeDrivers == null ? "Driver KPI unavailable" : "Available to assign",
      icon: BsPersonCheck,
      tone: "orange"
    },
    {
      id: "on-trip-now",
      label: "On Trip Now",
      value: onTripNow == null ? "--" : numberFormatter.format(onTripNow),
      detail: onTripNow == null ? "Live trips unavailable" : "Live trips",
      icon: BsGeoAlt,
      tone: "blue"
    },
    {
      id: "unread-alerts",
      label: "Unread Alerts",
      value: numberFormatter.format(unreadAlerts),
      detail: unreadAlerts > 0 ? "Requires attention" : "No open alerts",
      icon: BsBell,
      tone: unreadAlerts > 0 ? "red" : "teal"
    }
  ];

  return (
    <div className="admin-main-dashboard">
      <div className="admin-dashboard-page-head">
        <div>
          <span className="admin-dashboard-eyebrow">Riser Business Platform</span>
          <h1>Dashboard</h1>
        </div>
        <div className="admin-dashboard-toolbar" aria-label="Dashboard controls">
          <button type="button" className="admin-dashboard-toolbar-button" disabled title="Date range filtering is not enabled for this dashboard yet">
            <BsCalendar3 aria-hidden="true" />
            This month
          </button>
          <button type="button" className="admin-dashboard-toolbar-button" onClick={() => loadDashboard({ silent: true })} disabled={refreshing}>
            <BsArrowRepeat aria-hidden="true" />
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
          <button type="button" className="admin-dashboard-toolbar-button" disabled title="Export is available in Report Center">
            <BsDownload aria-hidden="true" />
            Export
          </button>
        </div>
      </div>

      <div className={`admin-dashboard-sync-strip is-${bokunReady ? "healthy" : bokunMode === "mock" ? "warning" : "muted"}`}>
        <span><BsCloudCheck aria-hidden="true" /> Bokun source of truth</span>
        <strong>{bokunMode === "live" ? "Live API" : titleize(bokunMode)}</strong>
        <small>
          {bokunWorker.lastSuccessAt
            ? `Last import ${formatRelativeTime(bokunWorker.lastSuccessAt)}`
            : latestBokunSync?.completedAt
              ? `Last sync ${formatRelativeTime(latestBokunSync.completedAt)}`
              : "Waiting for Bokun synchronization."}
        </small>
        <Link to="/admin/operations/bokun-sync/confirmed-import">Manage sync</Link>
      </div>

      <div className="admin-dashboard-kpi-grid">
        {loading ? (
          Array.from({ length: 6 }).map((_, index) => (
            <DashboardCard key={index} className="admin-dashboard-kpi-card">
              <SkeletonBlock rows={3} />
            </DashboardCard>
          ))
        ) : metricCards.map((card) => (
          <KpiCard key={card.id} {...card} />
        ))}
      </div>

      <div className="admin-dashboard-primary-grid">
        <DashboardCard className="admin-dashboard-recent-card">
          <CardHeader
            title="Recent Bookings"
            action={<Link className="admin-dashboard-link" to="/admin/operations/bookings">View all</Link>}
          />
          <RecentBookingsWidget
            bookings={dashboardData.recentBookings || []}
            loading={loading}
            error={widgetErrors.recentBookings}
            onRetry={() => loadDashboard({ silent: true })}
          />
        </DashboardCard>

        <div className="admin-dashboard-side-stack">
          <DashboardCard>
            <CardHeader title="Monthly Sales (USD)" detail="Latest available reporting months" />
            <MonthlySalesWidget
              rows={dashboardData.monthlySales || []}
              loading={loading}
              error={widgetErrors.monthlySales}
              onRetry={() => loadDashboard({ silent: true })}
            />
          </DashboardCard>

          <DashboardCard>
            <CardHeader
              title="Operational Alerts"
              detail={`${numberFormatter.format(unreadAlerts)} open`}
              action={<Link className="admin-dashboard-link" to="/admin/operations/recovery">View all</Link>}
            />
            <OperationalAlertsWidget
              alerts={operationalAlerts}
              loading={loading}
              error={widgetErrors.operationalAlerts}
              onRetry={() => loadDashboard({ silent: true })}
            />
          </DashboardCard>
        </div>
      </div>

      <div className="admin-dashboard-bottom-grid">
        <DashboardCard>
          <CardHeader title="Booking Source Breakdown" />
          {loading ? (
            <SkeletonBlock rows={5} />
          ) : widgetErrors.summary ? (
            <WidgetError message={widgetErrors.summary} onRetry={() => loadDashboard({ silent: true })} />
          ) : (
            <DonutSummaryWidget
              rows={sourceRows}
              total={sourceTotal}
              centerLabel="Total"
              emptyMessage="No channel data available."
            />
          )}
        </DashboardCard>

        <DashboardCard>
          <CardHeader
            title="Top Products"
            action={<Link className="admin-dashboard-link" to="/admin/business-intelligence">View all</Link>}
          />
          <TopProductsWidget
            products={summary.topProducts || []}
            loading={loading}
            error={widgetErrors.summary}
            onRetry={() => loadDashboard({ silent: true })}
          />
        </DashboardCard>

        <DashboardCard>
          <CardHeader title="Booking Status Overview" />
          {loading ? (
            <SkeletonBlock rows={5} />
          ) : widgetErrors.summary ? (
            <WidgetError message={widgetErrors.summary} onRetry={() => loadDashboard({ silent: true })} />
          ) : (
            <DonutSummaryWidget
              rows={statusRows}
              total={statusTotal}
              centerLabel="Total"
              emptyMessage="No booking status data available."
            />
          )}
        </DashboardCard>
      </div>
    </div>
  );
};

export default AdminDashboardPage;
