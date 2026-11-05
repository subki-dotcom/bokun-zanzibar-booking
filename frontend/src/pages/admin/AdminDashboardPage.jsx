import { PaymentTruthBadge } from '../../components/invoice/BookingPaymentState';
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BsArrowRepeat,
  BsBell,
  BsCalendar2Check,
  BsCalendarEvent,
  BsCashStack,
  BsCloudCheck,
  BsCreditCard,
  BsExclamationTriangle,
  BsHourglassSplit,
  BsInfoCircle,
  BsThreeDotsVertical
} from "react-icons/bs";
import {
  fetchBokunSyncStatus,
  fetchDashboardSummary,
  fetchMonthlySalesReport,
  fetchOperationalAlerts,
  fetchOperationsOverview
} from "../../api/adminApi";
import { fetchAdminBookings, fetchRecentBookings } from "../../api/bookingsApi";
import {
  AdminPage,
  EmptyState as UiEmptyState,
  ErrorState,
  LoadingSkeleton,
  PageHeader,
  SectionCard,
  StatCard,
  StatGrid,
  StatusBadge as UiStatusBadge
} from "../../components/admin/ui";
import { formatCurrency, formatDate } from "../../utils/formatters";
import { adminAlertCount, bokunSyncState } from "../../utils/adminStatus";

const numberFormatter = new Intl.NumberFormat("en-US");

const CHANNEL_COLORS = ["#16a085", "#2f80ed", "#6b7280", "#f9735b", "#a855f7", "#94a3b8"];
const STATUS_COLORS = {
  confirmed: "#0e6b57",
  pending: "#d97706",
  cancelled: "#94a3b8",
  completed: "#475569",
  failed: "#b42318",
  refunded: "#0f766e"
};

const CHANNEL_LABELS = {
  DIRECT_WEBSITE: "Direct Website",
  direct_website: "Direct Website",
  GETYOURGUIDE: "GetYourGuide",
  getyourguide: "GetYourGuide",
  VIATOR: "Viator",
  viator: "Viator",
  BOKUN_MARKETPLACE: "Marketplace",
  bokun_marketplace: "Marketplace",
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
  const currency = booking.transactionCurrency || booking.currency || booking.pricingSnapshot?.currency || "USD";
  return formatCurrency(amount, currency);
};

const getBookingSourceLabel = (source) => CHANNEL_LABELS[source] || CHANNEL_LABELS[String(source || "").toUpperCase()] || titleize(source);

const normalizeBreakdownRows = (rows = [], type = "channel") => {
  const total = rows.reduce((sum, row) => sum + Number(row.count || row.bookings || 0), 0);

  // Rows with the same label are one row (e.g. "DIRECT_WEBSITE" and "direct_website" are both "Direct Website").
  const merged = new Map();
  for (const row of rows) {
    const key = row._id || "unknown";
    const normalizedStatus = normalizeStatus(key);
    const label = type === "status" ? titleize(normalizedStatus) : getBookingSourceLabel(key);
    const current = merged.get(label) || { id: key, label, normalizedStatus, count: 0, sales: 0 };
    current.count += Number(row.count || row.bookings || 0);
    current.sales += Number(row.sales || 0);
    merged.set(label, current);
  }

  return [...merged.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, 6)
    .map((row, index) => ({
      id: row.id,
      label: row.label,
      count: row.count,
      percent: total > 0 ? Math.round((row.count / total) * 100) : 0,
      sales: row.sales,
      color: type === "status" ? STATUS_COLORS[row.normalizedStatus] || "#94a3b8" : CHANNEL_COLORS[index % CHANNEL_COLORS.length]
    }));
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

const EmptyState = ({ message }) => <UiEmptyState title={message} />;

const WidgetError = ({ message, onRetry }) => <ErrorState message={message} onRetry={onRetry} />;

const SkeletonBlock = ({ rows = 3 }) => <LoadingSkeleton rows={rows} />;

const StatusBadge = ({ value }) => <UiStatusBadge value={value} />;

// "2026-11-05" in Zanzibar time, and the same date 7 days later (travel dates are plain calendar days).
const zanzibarDay = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 86400000).toLocaleDateString("en-CA", { timeZone: "Africa/Dar_es_Salaam" });

const fetchUpcomingTours = async () => {
  const result = await fetchAdminBookings({ status: "confirmed", from: zanzibarDay(0), to: zanzibarDay(7), page: 1, limit: 1 });
  return { total: Number(result?.pagination?.total || 0) };
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
              <th>Customer payment</th>
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
                <td><PaymentTruthBadge payment={booking.bookingPayment} /></td>
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
                <PaymentTruthBadge payment={booking.bookingPayment} />
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
      requestDashboardWidget("bokunSyncStatus", fetchBokunSyncStatus, "Failed to load sync status"),
      requestDashboardWidget("upcomingTours", fetchUpcomingTours, "Failed to load upcoming tours")
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
  // Same count as the top bar (utils/adminStatus.js).
  const unreadAlerts = adminAlertCount({ operationalAlerts: dashboardData.operationalAlerts, operationsOverview });

  const sourceRows = useMemo(() => normalizeBreakdownRows(summary.sourceBreakdown || [], "channel"), [summary.sourceBreakdown]);
  const statusRows = useMemo(() => normalizeBreakdownRows(summary.bookingStatusBreakdown || [], "status"), [summary.bookingStatusBreakdown]);
  const sourceTotal = sourceRows.reduce((sum, row) => sum + row.count, 0);
  const statusTotal = statusRows.reduce((sum, row) => sum + row.count, 0);

  const pendingBookings = statusRows.find((row) => row.label === "Pending")?.count ?? null;
  const upcomingTours = dashboardData.upcomingTours?.total ?? null;
  const bokunStatus = dashboardData.bokunSyncStatus;
  const bokunWorker = bokunStatus?.confirmedBookingImport?.worker || {};
  const latestBokunSync = queue.latestBokunSync;
  // Same Bókun state as the top bar (utils/adminStatus.js).
  const bokunSync = bokunSyncState(bokunStatus);

  const summaryMissing = Boolean(widgetErrors.summary && !summary.kpis);
  const metricCards = [
    {
      id: "total-bookings",
      label: "Total bookings",
      value: summaryMissing ? "—" : numberFormatter.format(kpis.totalBookings || 0),
      helper: `${numberFormatter.format(kpis.confirmedBookings || 0)} confirmed`,
      icon: BsCalendar2Check
    },
    {
      id: "gross-revenue",
      label: "Gross revenue",
      value: summaryMissing ? "—" : formatCurrency(kpis.totalSales || 0, "USD"),
      helper: "Reported gross sales",
      icon: BsCashStack
    },
    {
      id: "upcoming-tours",
      label: "Tours in the next 7 days",
      value: upcomingTours == null ? "—" : numberFormatter.format(upcomingTours),
      helper: "Confirmed bookings by travel date",
      icon: BsCalendarEvent
    },
    {
      id: "waiting-supplier",
      label: "Waiting for supplier",
      value: numberFormatter.format(Number(queue.paidPendingSupplier || 0)),
      helper: "Paid, not yet confirmed in Bókun",
      icon: BsHourglassSplit,
      status: Number(queue.paidPendingSupplier || 0) > 0 ? "pending" : ""
    },
    {
      id: "awaiting-payment",
      label: "Awaiting payment",
      value: pendingBookings == null ? "—" : numberFormatter.format(pendingBookings),
      helper: "Bookings still pending",
      icon: BsCreditCard
    },
    {
      id: "open-alerts",
      label: "Open alerts",
      value: numberFormatter.format(unreadAlerts),
      helper: unreadAlerts > 0 ? "Needs attention" : "Nothing open",
      icon: BsBell,
      status: unreadAlerts > 0 ? "warning" : ""
    }
  ];

  const retry = () => loadDashboard({ silent: true });

  return (
    <AdminPage className="admin-main-dashboard">
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description="Bookings, sales and what needs your attention today."
        actions={
          <button type="button" className="btn btn-outline-secondary" onClick={retry} disabled={refreshing}>
            <BsArrowRepeat aria-hidden="true" /> {refreshing ? "Refreshing" : "Refresh"}
          </button>
        }
      />

      <div className={`admin-dashboard-sync-strip is-${bokunSync.status === "unknown" ? "muted" : bokunSync.status === "critical" ? "warning" : bokunSync.status}`} title={bokunSync.detail}>
        <span><BsCloudCheck aria-label="Synchronization" /></span>
        <strong>{bokunSync.label}</strong>
        <small>
          {bokunWorker.lastSuccessAt
            ? `Last import ${formatRelativeTime(bokunWorker.lastSuccessAt)}`
            : latestBokunSync?.completedAt
              ? `Last sync ${formatRelativeTime(latestBokunSync.completedAt)}`
              : "Waiting for synchronization."}
        </small>
        <Link to="/admin/operations/bokun-sync/confirmed-import">Manage sync</Link>
      </div>

      <StatGrid columns={3}>
        {metricCards.map(({ id, ...card }) => <StatCard key={id} {...card} loading={loading} />)}
      </StatGrid>

      <div className="admin-dashboard-primary-grid">
        <SectionCard
  
          title="Recent bookings"
          actions={<Link className="admin-dashboard-link" to="/admin/operations/bookings">View all</Link>}
        >
          <RecentBookingsWidget bookings={dashboardData.recentBookings || []} loading={loading} error={widgetErrors.recentBookings} onRetry={retry} />
        </SectionCard>

        <div className="admin-dashboard-side-stack">
          <SectionCard title="Monthly sales (USD)" description="Latest reporting months">
            <MonthlySalesWidget rows={dashboardData.monthlySales || []} loading={loading} error={widgetErrors.monthlySales} onRetry={retry} />
          </SectionCard>

          <SectionCard
            title="Operational alerts"
            description={`${numberFormatter.format(unreadAlerts)} open`}
            actions={<Link className="admin-dashboard-link" to="/admin/operations/recovery">View all</Link>}
          >
            <OperationalAlertsWidget alerts={operationalAlerts} loading={loading} error={widgetErrors.operationalAlerts} onRetry={retry} />
          </SectionCard>
        </div>
      </div>

      <div className="admin-dashboard-bottom-grid">
        <SectionCard title="Booking sources">
          {loading ? <SkeletonBlock rows={5} /> : widgetErrors.summary ? <WidgetError message={widgetErrors.summary} onRetry={retry} /> : (
            <DonutSummaryWidget rows={sourceRows} total={sourceTotal} centerLabel="Total" emptyMessage="No channel data available." />
          )}
        </SectionCard>

        <SectionCard title="Top products" actions={<Link className="admin-dashboard-link" to="/admin/business-intelligence">View all</Link>}>
          <TopProductsWidget products={summary.topProducts || []} loading={loading} error={widgetErrors.summary} onRetry={retry} />
        </SectionCard>

        <SectionCard title="Booking status">
          {loading ? <SkeletonBlock rows={5} /> : widgetErrors.summary ? <WidgetError message={widgetErrors.summary} onRetry={retry} /> : (
            <DonutSummaryWidget rows={statusRows} total={statusTotal} centerLabel="Total" emptyMessage="No booking status data available." />
          )}
        </SectionCard>
      </div>
    </AdminPage>
  );
};

export default AdminDashboardPage;
