import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Col, Row, Table } from "react-bootstrap";
import { Link, useLocation } from "react-router-dom";
import {
  BsArrowClockwise,
  BsArrowDownRight,
  BsArrowUpRight,
  BsCalendar3,
  BsCashCoin,
  BsChevronRight,
  BsClipboard2Check,
  BsCreditCard2Front,
  BsDashLg,
  BsDownload,
  BsExclamationTriangle,
  BsFunnel,
  BsGraphUpArrow,
  BsInfoCircle,
  BsPieChart,
  BsReceipt
} from "react-icons/bs";
import {
  fetchBookingAccountingCostTemplates,
  fetchBookingAccountingDashboard,
  fetchBookingAccountingExpenses,
  fetchBookingAccountingInvoices,
  fetchBookingAccountingProfitability,
  fetchBookingAccountingReconciliation,
  fetchBookingAccountingRefunds
} from "../../api/adminApi";
import { AdminMetricCard, StatusBadge, formatDateTime } from "../../components/admin/AdminDataWidgets";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";
import { formatCurrency } from "../../utils/formatters";
import {
  BOOKING_ACCOUNTING_VIEW_CONFIG,
  bookingAccountingModeFromPath
} from "./bookingAccountingView";
import { CostTemplateEditor, CostTemplatesDashboard } from "./BookingCostTemplates";

const asArray = (value) => (Array.isArray(value) ? value : []);
const safeNumber = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const money = (value, currency = "USD") => formatCurrency(safeNumber(value), currency || "USD");
const percent = (value) => `${safeNumber(value).toFixed(2)}%`;
const label = (value = "") => String(value || "-").replaceAll("_", " ");

const formatReference = (value = "") => {
  const text = String(value || "");
  return text.length > 18 ? `${text.slice(0, 8)}...${text.slice(-6)}` : text || "-";
};

const EmptyRow = ({ colSpan, message }) => (
  <tr>
    <td colSpan={colSpan} className="text-center text-muted py-4">{message}</td>
  </tr>
);

const AccountingTable = ({ children }) => (
  <Table responsive hover className="align-middle mb-0">
    {children}
  </Table>
);

const SectionCard = ({ title, detail = "", action = null, children }) => (
  <Card className="surface-card h-100">
    <Card.Body>
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
        <div>
          <h5 className="mb-1">{title}</h5>
          {detail ? <small className="text-muted">{detail}</small> : null}
        </div>
        {action}
      </div>
      {children}
    </Card.Body>
  </Card>
);

const DATE_RANGE_PRESETS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7_days", label: "Last 7 Days" },
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "this_quarter", label: "This Quarter" },
  { value: "this_year", label: "This Year" },
  { value: "custom", label: "Custom Range" }
];

const DANGER_STATUSES = ["cancelled", "canceled", "failed", "missing_invoice", "missing_cost", "reconciliation_required"];
const WARNING_STATUSES = ["pending", "processing", "partially_paid", "partially_refunded", "overdue", "estimated"];
const SUCCESS_STATUSES = ["paid", "confirmed", "completed", "refunded", "actual"];

const toInputDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const copy = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return copy.toISOString().slice(0, 10);
};

const resolveDateRange = (preset = "this_month") => {
  const today = new Date();
  const start = new Date(today);
  const end = new Date(today);

  if (preset === "today") return { fromDate: toInputDate(today), toDate: toInputDate(today) };
  if (preset === "yesterday") {
    start.setDate(today.getDate() - 1);
    return { fromDate: toInputDate(start), toDate: toInputDate(start) };
  }
  if (preset === "last_7_days") {
    start.setDate(today.getDate() - 6);
    return { fromDate: toInputDate(start), toDate: toInputDate(end) };
  }
  if (preset === "last_month") {
    start.setMonth(today.getMonth() - 1, 1);
    end.setDate(0);
    return { fromDate: toInputDate(start), toDate: toInputDate(end) };
  }
  if (preset === "this_quarter") {
    start.setMonth(Math.floor(today.getMonth() / 3) * 3, 1);
    return { fromDate: toInputDate(start), toDate: toInputDate(end) };
  }
  if (preset === "this_year") {
    start.setMonth(0, 1);
    return { fromDate: toInputDate(start), toDate: toInputDate(end) };
  }

  start.setDate(1);
  return { fromDate: toInputDate(start), toDate: toInputDate(end) };
};

const formatNumber = (value = 0) => new Intl.NumberFormat("en-US").format(Math.round(safeNumber(value)));
const formatShortDate = (value = "") => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
};

const statusTone = (value = "") => {
  const normalized = String(value || "").toLowerCase();
  if (DANGER_STATUSES.includes(normalized)) return "danger";
  if (WARNING_STATUSES.includes(normalized)) return "warning";
  if (SUCCESS_STATUSES.includes(normalized)) return "success";
  return "neutral";
};

const prettyLabel = (value = "") =>
  String(value || "-")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());

const formatKpiValue = (kpi = {}, currency = "USD") => {
  if (kpi.type === "count") return formatNumber(kpi.value);
  if (kpi.type === "percent") return `${safeNumber(kpi.value).toFixed(2)}%`;
  return money(kpi.value, currency);
};

const comparisonText = (comparison = {}, type = "money") => {
  const change = safeNumber(comparison.changePercent);
  if (!change) return "No previous-period change";
  const direction = change > 0 ? "up" : "down";
  return `${Math.abs(change).toFixed(2)}% ${direction} vs previous period`;
};

const DashboardCard = ({ className = "", children }) => (
  <section className={`booking-accounting-dashboard-card ${className}`.trim()}>{children}</section>
);

const DashboardCardHeader = ({ title, detail = "", action = null }) => (
  <div className="booking-accounting-dashboard-card-head">
    <div>
      <h3>{title}</h3>
      {detail ? <p>{detail}</p> : null}
    </div>
    {action}
  </div>
);

const DashboardEmpty = ({ message }) => (
  <div className="booking-accounting-dashboard-empty">
    <BsInfoCircle aria-hidden="true" />
    <span>{message}</span>
  </div>
);

const DashboardError = ({ message, onRetry }) => (
  <div className="booking-accounting-dashboard-error" role="alert">
    <BsExclamationTriangle aria-hidden="true" />
    <div>
      <strong>Unable to load dashboard data.</strong>
      <span>{message || "Please retry."}</span>
    </div>
    <button type="button" onClick={onRetry}>Retry</button>
  </div>
);

const DashboardSkeleton = ({ rows = 3, className = "" }) => (
  <div className={`booking-accounting-dashboard-skeleton ${className}`.trim()} aria-hidden="true">
    {Array.from({ length: rows }).map((_, index) => <span key={index} />)}
  </div>
);

const AccountingStatusPill = ({ value }) => (
  <span className={`booking-accounting-dashboard-pill is-${statusTone(value)}`}>{prettyLabel(value)}</span>
);

const KpiCard = ({ kpi = {}, currency = "USD", icon: Icon = BsCashCoin }) => {
  const direction = kpi.comparison?.direction || "flat";
  const DirectionIcon = direction === "up" ? BsArrowUpRight : direction === "down" ? BsArrowDownRight : BsDashLg;
  const Wrapper = kpi.href ? Link : "div";
  const wrapperProps = kpi.href ? { to: kpi.href } : {};
  return (
    <Wrapper {...wrapperProps} className={`booking-accounting-dashboard-kpi is-${kpi.tone || "teal"}`}>
      <span className="booking-accounting-dashboard-kpi-icon"><Icon aria-hidden="true" /></span>
      <span className="booking-accounting-dashboard-kpi-copy">
        <span>{kpi.label}</span>
        <strong>{formatKpiValue(kpi, currency)}</strong>
        <small className={`is-${direction}`}>
          <DirectionIcon aria-hidden="true" /> {comparisonText(kpi.comparison, kpi.type)}
        </small>
      </span>
    </Wrapper>
  );
};

const SecondaryKpiCard = ({ kpi = {}, currency = "USD", icon: Icon = BsReceipt }) => {
  const Wrapper = kpi.href ? Link : "div";
  const wrapperProps = kpi.href ? { to: kpi.href } : {};
  return (
    <Wrapper {...wrapperProps} className={`booking-accounting-dashboard-secondary-kpi is-${kpi.tone || "teal"}`}>
      <span><Icon aria-hidden="true" /></span>
      <div>
        <small>{kpi.label}</small>
        <strong>{formatKpiValue(kpi, currency)}</strong>
        <em>{kpi.detail || comparisonText(kpi.comparison, kpi.type)}</em>
      </div>
    </Wrapper>
  );
};

const maxMetricValue = (rows = []) =>
  Math.max(
    1,
    ...rows.flatMap((row) => [
      safeNumber(row.revenue),
      safeNumber(row.directCosts),
      safeNumber(row.grossProfit)
    ])
  );

const TrendChart = ({ rows = [], currency = "USD" }) => {
  if (!rows.length) return <DashboardEmpty message="No revenue or cost data for this period." />;
  const max = maxMetricValue(rows);
  const points = rows.map((row, index) => {
    const x = rows.length === 1 ? 300 : 38 + (index * 564) / (rows.length - 1);
    const revenueY = 204 - (safeNumber(row.revenue) / max) * 170;
    const costY = 204 - (safeNumber(row.directCosts) / max) * 170;
    return { ...row, x, revenueY, costY };
  });

  return (
    <div className="booking-accounting-dashboard-chart" role="img" aria-label="Revenue versus direct costs">
      <svg viewBox="0 0 640 240" preserveAspectRatio="none">
        {[0, 1, 2, 3].map((line) => <line key={line} x1="32" x2="614" y1={34 + line * 56} y2={34 + line * 56} />)}
        <polyline className="is-revenue" points={points.map((point) => `${point.x},${point.revenueY}`).join(" ")} />
        <polyline className="is-cost" points={points.map((point) => `${point.x},${point.costY}`).join(" ")} />
        {points.map((point) => (
          <g key={point.key}>
            <circle className="is-revenue" cx={point.x} cy={point.revenueY} r="4" />
            <circle className="is-cost" cx={point.x} cy={point.costY} r="4" />
          </g>
        ))}
      </svg>
      <div className="booking-accounting-dashboard-chart-labels">
        {points.slice(0, 7).map((point) => (
          <span key={point.key} title={`${point.label}: ${money(point.revenue, currency)} revenue, ${money(point.directCosts, currency)} costs`}>
            {point.label}
          </span>
        ))}
      </div>
    </div>
  );
};

const buildDonut = (rows = []) => {
  const colors = ["#0f9f95", "#2563eb", "#7c3aed", "#f59e0b", "#ef4444", "#94a3b8"];
  let cursor = 0;
  const stops = rows.map((row, index) => {
    const size = safeNumber(row.percent) * 3.6;
    const start = cursor;
    cursor += size;
    return `${colors[index % colors.length]} ${start}deg ${cursor}deg`;
  });
  return stops.length ? `conic-gradient(${stops.join(", ")})` : "#e2e8f0";
};

const ChannelRevenue = ({ rows = [], currency = "USD" }) => {
  if (!rows.length) return <DashboardEmpty message="No channel revenue available." />;
  const total = rows.reduce((sum, row) => sum + safeNumber(row.revenue), 0);
  return (
    <div className="booking-accounting-dashboard-donut-wrap">
      <div className="booking-accounting-dashboard-donut" style={{ background: buildDonut(rows) }}>
        <div>
          <strong>{money(total, currency)}</strong>
          <span>Total</span>
        </div>
      </div>
      <div className="booking-accounting-dashboard-breakdown">
        {rows.slice(0, 6).map((row, index) => (
          <div key={row.value || row.label}>
            <span><i style={{ background: ["#0f9f95", "#2563eb", "#7c3aed", "#f59e0b", "#ef4444", "#94a3b8"][index % 6] }} /> {row.label}</span>
            <strong>{money(row.revenue, row.currency || currency)} <small>{safeNumber(row.percent).toFixed(1)}%</small></strong>
          </div>
        ))}
      </div>
    </div>
  );
};

const ProfitabilityBars = ({ rows = [], currency = "USD" }) => {
  if (!rows.length) return <DashboardEmpty message="No profitability data available." />;
  const max = maxMetricValue(rows);
  return (
    <div className="booking-accounting-dashboard-bars" role="img" aria-label="Profitability overview">
      {rows.slice(-8).map((row) => (
        <div key={row.key} title={`${row.label}: ${money(row.revenue, currency)} revenue, ${money(row.directCosts, currency)} costs`}>
          <div className="booking-accounting-dashboard-bar-track">
            <span className="is-revenue" style={{ height: `${Math.max(4, (safeNumber(row.revenue) / max) * 100)}%` }} />
            <span className="is-cost" style={{ height: `${Math.max(4, (safeNumber(row.directCosts) / max) * 100)}%` }} />
          </div>
          <strong>{safeNumber(row.margin).toFixed(0)}%</strong>
          <small>{row.label}</small>
        </div>
      ))}
    </div>
  );
};

const RecentFinancials = ({ rows = [], currency = "USD" }) => {
  if (!rows.length) return <DashboardEmpty message="No booking financials in selected period." />;
  return (
    <>
      <div className="booking-accounting-dashboard-table-scroll">
        <table className="booking-accounting-dashboard-table">
          <thead>
            <tr>
              <th>Booking</th>
              <th>Product / Service</th>
              <th>Channel</th>
              <th className="text-end">Revenue</th>
              <th className="text-end">Cost</th>
              <th className="text-end">Profit</th>
              <th className="text-end">Margin</th>
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.bookingReference}>
                <td><strong>{formatReference(row.bookingReference)}</strong></td>
                <td className="booking-accounting-dashboard-truncate"><span>{row.productTitle || "-"}</span><small>{row.optionTitle || ""}</small></td>
                <td>{row.salesChannelLabel || label(row.salesChannel)}</td>
                <td className="text-end">{money(row.revenue, row.currency || currency)}</td>
                <td className="text-end">
                  {money(row.directCost, row.currency || currency)}
                  <small>{prettyLabel(row.costStatus)}</small>
                </td>
                <td className="text-end">{money(row.profit, row.currency || currency)}</td>
                <td className="text-end">{percent(row.margin)}</td>
                <td><AccountingStatusPill value={row.financialStatus} /></td>
                <td>{formatShortDate(row.date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="booking-accounting-dashboard-mobile-financials">
        {rows.map((row) => (
          <article key={row.bookingReference}>
            <div>
              <strong>{row.productTitle || "Booking"}</strong>
              <span>Booking #{formatReference(row.bookingReference)}</span>
            </div>
            <AccountingStatusPill value={row.financialStatus} />
            <dl>
              <div><dt>Revenue</dt><dd>{money(row.revenue, row.currency || currency)}</dd></div>
              <div><dt>Direct Cost</dt><dd>{money(row.directCost, row.currency || currency)} <small>{prettyLabel(row.costStatus)}</small></dd></div>
              <div><dt>Profit</dt><dd>{money(row.profit, row.currency || currency)}</dd></div>
              <div><dt>Margin</dt><dd>{percent(row.margin)}</dd></div>
            </dl>
            <footer>
              <span>{row.salesChannelLabel || label(row.salesChannel)}</span>
              <span>{formatShortDate(row.date)}</span>
            </footer>
          </article>
        ))}
      </div>
    </>
  );
};

const AttentionPanel = ({ items = [] }) => {
  if (!items.length) return <DashboardEmpty message="No accounting issues detected." />;
  return (
    <div className="booking-accounting-dashboard-attention-list">
      {items.slice(0, 7).map((item) => (
        <Link key={item.id} to={item.href || "#"} className={`is-${item.severity || "neutral"}`}>
          <span>{item.label}<small>{item.description}</small></span>
          <strong>{formatNumber(item.count)}</strong>
          <BsChevronRight aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
};

const TopProducts = ({ rows = [], currency = "USD" }) => {
  if (!rows.length) return <DashboardEmpty message="No product profitability data available." />;
  const maxProfit = Math.max(1, ...rows.map((row) => safeNumber(row.profit)));
  return (
    <div className="booking-accounting-dashboard-top-products">
      {rows.map((row) => (
        <div key={row.productTitle}>
          <span>{row.productTitle}</span>
          <strong>{money(row.profit, row.currency || currency)}</strong>
          <em>{safeNumber(row.margin).toFixed(1)}%</em>
          <i><b style={{ width: `${Math.max(6, (safeNumber(row.profit) / maxProfit) * 100)}%` }} /></i>
        </div>
      ))}
    </div>
  );
};

const FooterKpis = ({ values = {}, currency = "USD" }) => {
  const rows = [
    ["Total Bookings", formatNumber(values.totalBookings)],
    ["Confirmed Bookings", formatNumber(values.confirmedBookings)],
    ["Cancelled Bookings", formatNumber(values.cancelledBookings)],
    ["Avg. Booking Value", money(values.averageBookingValue, currency)],
    ["Refund Rate", percent(values.refundRate)],
    ["Collection Rate", percent(values.collectionRate)]
  ];
  return (
    <div className="booking-accounting-dashboard-footer-kpis">
      {rows.map(([name, value]) => (
        <div key={name}>
          <span>{name}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
};

const exportDashboardCsv = (dashboard = {}) => {
  const rows = asArray(dashboard.recentBookingFinancials);
  const header = ["Booking", "Product", "Channel", "Revenue", "Direct Cost", "Cost Type", "Profit", "Margin", "Status", "Date"];
  const csv = [
    header,
    ...rows.map((row) => [
      row.bookingReference,
      row.productTitle,
      row.salesChannelLabel || row.salesChannel,
      row.revenue,
      row.directCost,
      row.costStatus,
      row.profit,
      row.margin,
      row.financialStatus,
      row.date
    ])
  ]
    .map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "booking-accounting-dashboard.csv";
  link.click();
  URL.revokeObjectURL(url);
};

const BookingAccountingDashboard = ({
  dashboard,
  filters,
  setFilters,
  loading,
  refreshing,
  error,
  onRefresh
}) => {
  const currency = dashboard?.currency || "USD";
  const channels = asArray(dashboard?.filters?.channels);
  const summary = dashboard?.summaryKpis || {};
  const secondary = dashboard?.secondaryKpis || {};
  const charts = dashboard?.charts || {};

  const primaryKpis = [
    { id: "bookingRevenue", icon: BsReceipt, kpi: summary.bookingRevenue },
    { id: "collectedRevenue", icon: BsCashCoin, kpi: summary.collectedRevenue },
    { id: "directCosts", icon: BsClipboard2Check, kpi: summary.directCosts },
    { id: "grossProfit", icon: BsGraphUpArrow, kpi: summary.grossProfit }
  ].filter((item) => item.kpi);
  const secondaryKpis = [
    { id: "profitMargin", icon: BsPieChart, kpi: secondary.profitMargin },
    { id: "outstandingAmount", icon: BsReceipt, kpi: secondary.outstandingAmount },
    { id: "refunds", icon: BsCreditCard2Front, kpi: secondary.refunds },
    { id: "unreconciledItems", icon: BsExclamationTriangle, kpi: secondary.unreconciledItems },
    { id: "overdueAmount", icon: BsCalendar3, kpi: secondary.overdueAmount }
  ].filter((item) => item.kpi);

  const updatePreset = (dateRange) => {
    const nextRange = dateRange === "custom" ? {} : resolveDateRange(dateRange);
    setFilters((current) => ({
      ...current,
      dateRange,
      ...nextRange
    }));
  };

  return (
    <div className="booking-accounting-dashboard">
      <div className="booking-accounting-dashboard-head">
        <div>
          <span>Booking Accounting / Dashboard</span>
          <h1>Booking Accounting Dashboard</h1>
          <p>Real-time overview of your booking financial performance and reconciliation status.</p>
        </div>
        <div className="booking-accounting-dashboard-actions" aria-label="Booking accounting dashboard controls">
          <label>
            <BsCalendar3 aria-hidden="true" />
            <select value={filters.dateRange} onChange={(event) => updatePreset(event.target.value)} aria-label="Date range">
              {DATE_RANGE_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
            </select>
          </label>
          {filters.dateRange === "custom" ? (
            <>
              <input
                type="date"
                value={filters.fromDate}
                onChange={(event) => setFilters((current) => ({ ...current, fromDate: event.target.value }))}
                aria-label="From date"
              />
              <input
                type="date"
                value={filters.toDate}
                onChange={(event) => setFilters((current) => ({ ...current, toDate: event.target.value }))}
                aria-label="To date"
              />
            </>
          ) : null}
          <label>
            <BsFunnel aria-hidden="true" />
            <select
              value={filters.channel}
              onChange={(event) => setFilters((current) => ({ ...current, channel: event.target.value }))}
              aria-label="Sales channel"
            >
              <option value="">All Channels</option>
              {channels.map((channel) => (
                <option key={channel.value} value={channel.value}>{channel.label}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={onRefresh} disabled={refreshing}>
            <BsArrowClockwise aria-hidden="true" /> {refreshing ? "Refreshing" : "Refresh"}
          </button>
          <button type="button" onClick={() => exportDashboardCsv(dashboard)} disabled={!dashboard}>
            <BsDownload aria-hidden="true" /> Export
          </button>
          <Link to="/admin/operations/bokun-sync/confirmed-import">
            <BsArrowClockwise aria-hidden="true" /> Sync Bokun
          </Link>
        </div>
      </div>

      {error ? <DashboardError message={error} onRetry={onRefresh} /> : null}
      {dashboard?.currencyWarning ? (
        <div className="booking-accounting-dashboard-note" role="status">
          <BsInfoCircle aria-hidden="true" /> {dashboard.currencyWarning}
        </div>
      ) : null}

      <div className="booking-accounting-dashboard-primary-kpis">
        {loading
          ? Array.from({ length: 4 }).map((_, index) => (
              <DashboardCard key={index} className="booking-accounting-dashboard-kpi-skeleton">
                <DashboardSkeleton rows={3} />
              </DashboardCard>
            ))
          : primaryKpis.map(({ id, icon, kpi }) => <KpiCard key={id} icon={icon} kpi={kpi} currency={currency} />)}
      </div>

      <div className="booking-accounting-dashboard-secondary-kpis">
        {loading
          ? Array.from({ length: 5 }).map((_, index) => (
              <DashboardCard key={index} className="booking-accounting-dashboard-secondary-skeleton">
                <DashboardSkeleton rows={2} />
              </DashboardCard>
            ))
          : secondaryKpis.map(({ id, icon, kpi }) => <SecondaryKpiCard key={id} icon={icon} kpi={kpi} currency={currency} />)}
      </div>

      <div className="booking-accounting-dashboard-chart-grid">
        <DashboardCard className="is-wide">
          <DashboardCardHeader title="Revenue vs Direct Costs" detail="Actual booking revenue compared with booking-linked direct costs." />
          {loading ? <DashboardSkeleton rows={4} className="is-chart" /> : <TrendChart rows={asArray(charts.revenueVsCosts)} currency={currency} />}
        </DashboardCard>
        <DashboardCard>
          <DashboardCardHeader title="Revenue by Channel" detail="Revenue grouped by real sales channel." />
          {loading ? <DashboardSkeleton rows={4} className="is-chart" /> : <ChannelRevenue rows={asArray(charts.revenueByChannel)} currency={currency} />}
        </DashboardCard>
        <DashboardCard>
          <DashboardCardHeader title="Profitability Overview" detail="Revenue, costs and margin across the selected period." />
          {loading ? <DashboardSkeleton rows={4} className="is-chart" /> : <ProfitabilityBars rows={asArray(charts.profitabilityOverview)} currency={currency} />}
        </DashboardCard>
      </div>

      <div className="booking-accounting-dashboard-work-grid">
        <DashboardCard className="is-financials">
          <DashboardCardHeader
            title="Recent Booking Financials"
            detail="Actual costs are preferred; estimated costs are labelled when no posted expense exists."
            action={<Link to="/admin/booking-accounting/profitability">View all</Link>}
          />
          {loading ? <DashboardSkeleton rows={7} className="is-table" /> : <RecentFinancials rows={asArray(dashboard?.recentBookingFinancials)} currency={currency} />}
        </DashboardCard>
        <DashboardCard>
          <DashboardCardHeader title="Needs Attention" action={<Link to="/admin/booking-accounting/reconciliation">View all</Link>} />
          {loading ? <DashboardSkeleton rows={6} /> : <AttentionPanel items={asArray(dashboard?.needsAttention)} />}
        </DashboardCard>
        <DashboardCard>
          <DashboardCardHeader title="Top Profitable Products" detail="Ranked by booking revenue minus actual direct costs." action={<Link to="/admin/booking-accounting/profitability">View all</Link>} />
          {loading ? <DashboardSkeleton rows={6} /> : <TopProducts rows={asArray(dashboard?.topProducts)} currency={currency} />}
        </DashboardCard>
      </div>

      {loading ? <DashboardSkeleton rows={2} /> : <FooterKpis values={dashboard?.footerKpis || {}} currency={currency} />}
    </div>
  );
};

const InvoicesTable = ({ items = [] }) => (
  <AccountingTable>
    <thead>
      <tr>
        <th>Invoice</th>
        <th>Booking</th>
        <th>Status</th>
        <th className="text-end">Total</th>
        <th className="text-end">Paid</th>
        <th className="text-end">Refunded</th>
        <th className="text-end">Balance</th>
        <th>Updated</th>
      </tr>
    </thead>
    <tbody>
      {items.length ? items.map((item) => (
        <tr key={item.id || item.invoiceNumber}>
          <td>
            <strong className="d-block">{item.invoiceNumber}</strong>
            <small className="text-muted">{item.clientName || item.clientEmail || "-"}</small>
          </td>
          <td>
            <strong className="d-block">{item.bookingReference || "-"}</strong>
            <small className="text-muted">{item.tourName || "-"}</small>
          </td>
          <td><StatusBadge value={item.paymentStatus} /></td>
          <td className="text-end">{money(item.total, item.currency)}</td>
          <td className="text-end">{money(item.amountPaid, item.currency)}</td>
          <td className="text-end">{money(item.amountRefunded, item.currency)}</td>
          <td className="text-end">{money(item.balanceDue, item.currency)}</td>
          <td>{formatDateTime(item.updatedAt || item.issueDate)}</td>
        </tr>
      )) : <EmptyRow colSpan={8} message="No invoice records found." />}
    </tbody>
  </AccountingTable>
);

const RefundsTable = ({ items = [] }) => (
  <AccountingTable>
    <thead>
      <tr>
        <th>Refund</th>
        <th>Booking</th>
        <th>Status</th>
        <th>Provider</th>
        <th className="text-end">Requested</th>
        <th className="text-end">Confirmed</th>
        <th>Provider Evidence</th>
        <th>Last Sync</th>
      </tr>
    </thead>
    <tbody>
      {items.length ? items.map((item) => (
        <tr key={item.id || item.refundReference}>
          <td>
            <strong className="d-block">{item.refundReference}</strong>
            <small className="text-muted">{formatDateTime(item.requestedAt)}</small>
          </td>
          <td>{item.bookingReference || "-"}</td>
          <td><StatusBadge value={item.status} /></td>
          <td className="text-capitalize">{item.provider || "-"}</td>
          <td className="text-end">{money(item.requestedAmount, item.currency)}</td>
          <td className="text-end">{money(item.confirmedRefundedAmount, item.currency)}</td>
          <td>
            <strong className="d-block">{formatReference(item.providerRefundReference)}</strong>
            <small className="text-muted">Request {formatReference(item.providerRefundRequestReference || item.originalTransactionReference)}</small>
          </td>
          <td>{formatDateTime(item.lastRefundSyncAt || item.completedAt || item.processingStartedAt)}</td>
        </tr>
      )) : <EmptyRow colSpan={8} message="No refund records found." />}
    </tbody>
  </AccountingTable>
);

const ExpensesTable = ({ items = [] }) => (
  <AccountingTable>
    <thead>
      <tr>
        <th>Expense</th>
        <th>Booking</th>
        <th>Category</th>
        <th>Supplier</th>
        <th>Status</th>
        <th className="text-end">Amount</th>
        <th>Date</th>
      </tr>
    </thead>
    <tbody>
      {items.length ? items.map((item) => (
        <tr key={item.id || item.expenseReference}>
          <td>
            <strong className="d-block">{item.expenseReference}</strong>
            <small className="text-muted">{item.description || "-"}</small>
          </td>
          <td>{item.bookingReference || "-"}</td>
          <td>{label(item.category)}</td>
          <td>{item.supplierName || "-"}</td>
          <td><StatusBadge value={item.status || item.paymentStatus} /></td>
          <td className="text-end">{money(item.baseCurrencyAmount ?? item.amount, item.baseCurrency || item.currency)}</td>
          <td>{formatDateTime(item.expenseDate)}</td>
        </tr>
      )) : <EmptyRow colSpan={7} message="No booking-linked expenses found." />}
    </tbody>
  </AccountingTable>
);

const ProfitabilityTable = ({ items = [] }) => (
  <AccountingTable>
    <thead>
      <tr>
        <th>Booking</th>
        <th>Channel</th>
        <th className="text-end">Collected</th>
        <th className="text-end">Refunded</th>
        <th className="text-end">Fees</th>
        <th className="text-end">Direct Cost</th>
        <th className="text-end">Gross Profit</th>
        <th className="text-end">Margin</th>
      </tr>
    </thead>
    <tbody>
      {items.length ? items.map((item) => (
        <tr key={item.bookingReference}>
          <td>
            <strong className="d-block">{item.bookingReference}</strong>
            <small className="text-muted">{item.productTitle || "-"}</small>
          </td>
          <td>{label(item.salesChannel)}</td>
          <td className="text-end">{money(item.collectedRevenue, item.currency)}</td>
          <td className="text-end">{money(item.refundedAmount, item.currency)}</td>
          <td className="text-end">{money(item.paymentProviderFees, item.currency)}</td>
          <td className="text-end">{money(item.actualDirectCost, item.currency)}</td>
          <td className="text-end">{money(item.grossProfit, item.currency)}</td>
          <td className="text-end">{percent(item.profitMargin)}</td>
        </tr>
      )) : <EmptyRow colSpan={8} message="No profitability rows found." />}
    </tbody>
  </AccountingTable>
);

const ReconciliationTable = ({ items = [] }) => (
  <AccountingTable>
    <thead>
      <tr>
        <th>Issue</th>
        <th>Record</th>
        <th>Severity</th>
        <th>Message</th>
      </tr>
    </thead>
    <tbody>
      {items.length ? items.map((item, index) => (
        <tr key={`${item.code}-${item.entityType}-${item.entityId}-${index}`}>
          <td>{label(item.code)}</td>
          <td>
            <strong className="d-block">{item.entityType}</strong>
            <small className="text-muted">{item.reference || item.entityId || "-"}</small>
          </td>
          <td><StatusBadge value={item.severity} /></td>
          <td>{item.message || "-"}</td>
        </tr>
      )) : <EmptyRow colSpan={4} message="No reconciliation issues found in this scan." />}
    </tbody>
  </AccountingTable>
);

const AdminBookingAccountingPage = () => {
  const location = useLocation();
  const mode = bookingAccountingModeFromPath(location.pathname);
  const config = BOOKING_ACCOUNTING_VIEW_CONFIG[mode] || BOOKING_ACCOUNTING_VIEW_CONFIG.dashboard;
  const defaultRange = useMemo(() => resolveDateRange("this_month"), []);
  const [dashboardFilters, setDashboardFilters] = useState({
    dateRange: "this_month",
    channel: "",
    ...defaultRange
  });
  const [data, setData] = useState({
    dashboard: null,
    invoices: { items: [] },
    refunds: { items: [] },
    expenses: { items: [] },
    costTemplates: null,
    profitability: { items: [], totals: {} },
    reconciliation: { items: [], summary: {} }
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const dashboardQuery = useMemo(() => ({
    limit: 500,
    dateRange: dashboardFilters.dateRange,
    fromDate: dashboardFilters.fromDate,
    toDate: dashboardFilters.toDate,
    ...(dashboardFilters.channel ? { channel: dashboardFilters.channel } : {})
  }), [dashboardFilters]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      if (mode === "dashboard") {
        const dashboard = await fetchBookingAccountingDashboard(dashboardQuery);
        setData((current) => ({
          ...current,
          dashboard
        }));
        return;
      }

      const [
        dashboard,
        invoices,
        refunds,
        expenses,
        costTemplates,
        profitability,
        reconciliation
      ] = await Promise.all([
        fetchBookingAccountingDashboard({ limit: 25 }),
        fetchBookingAccountingInvoices({ limit: 100 }),
        fetchBookingAccountingRefunds({ limit: 100 }),
        fetchBookingAccountingExpenses({ limit: 100 }),
        fetchBookingAccountingCostTemplates(),
        fetchBookingAccountingProfitability({ limit: 100 }),
        fetchBookingAccountingReconciliation({ limit: 100 })
      ]);

      setData({
        dashboard,
        invoices,
        refunds,
        expenses,
        costTemplates,
        profitability,
        reconciliation
      });
    } catch (err) {
      setError(err.message || "Failed to load booking accounting");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dashboardQuery, mode]);

  useEffect(() => {
    if (mode.startsWith("cost-template")) return;
    load();
  }, [load, mode]);

  const totals = data.dashboard?.totals || {};
  const currency = data.dashboard?.currency || data.profitability?.currency || "USD";
  const tableItems = useMemo(() => ({
    invoices: data.invoices?.items || [],
    refunds: data.refunds?.items || [],
    expenses: data.expenses?.items || [],
    profitability: data.profitability?.items || [],
    reconciliation: data.reconciliation?.items || []
  }), [data]);

  if (loading && mode !== "dashboard" && !mode.startsWith("cost-template")) return <Loader message="Loading booking accounting..." />;

  if (mode === "cost-templates") {
    return <CostTemplatesDashboard initialData={data.costTemplates} />;
  }

  if (mode.startsWith("cost-template-")) {
    return <CostTemplateEditor mode={mode} initialCatalog={data.costTemplates} />;
  }

  if (mode === "dashboard") {
    return (
      <BookingAccountingDashboard
        dashboard={data.dashboard}
        filters={dashboardFilters}
        setFilters={setDashboardFilters}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={() => load({ silent: true })}
      />
    );
  }

  return (
    <div className="admin-booking-accounting-page">
      <div className="admin-platform-page-header">
        <div>
          <span className="admin-platform-eyebrow">{config.eyebrow}</span>
          <h2>{config.title}</h2>
          <p>{config.subtitle}</p>
        </div>
        <Button variant="outline-secondary" onClick={() => load({ silent: true })} disabled={refreshing}>
          <BsArrowClockwise /> {refreshing ? "Refreshing" : "Refresh"}
        </Button>
      </div>

      <ErrorAlert error={error} />

      <Row className="g-3 mb-4">
        <Col md={6} xl={3}>
          <AdminMetricCard
            label="Collected Revenue"
            value={money(totals.collectedRevenue, currency)}
            detail={`${totals.invoiceCount || 0} invoices`}
            icon={BsCashCoin}
          />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard
            label="Confirmed Refunded"
            value={money(totals.confirmedRefundedAmount, currency)}
            detail={`${totals.refundCount || 0} refund records`}
            icon={BsCreditCard2Front}
            status={totals.openRefundCount ? "processing" : ""}
          />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard
            label="Gross Profit"
            value={money(totals.grossProfit, currency)}
            detail={`${percent(totals.profitMargin)} margin`}
            icon={BsGraphUpArrow}
          />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard
            label="Reconciliation Issues"
            value={totals.reconciliationIssueCount || 0}
            detail={`${totals.openRefundCount || 0} open refunds`}
            icon={BsExclamationTriangle}
            status={totals.reconciliationIssueCount ? "WARNING" : "COMPLETED"}
          />
        </Col>
      </Row>

      {mode === "invoices" ? (
        <SectionCard title="Invoice Records" detail={`${data.invoices?.total || 0} matching records`}>
          <InvoicesTable items={tableItems.invoices} />
        </SectionCard>
      ) : null}

      {mode === "refunds" ? (
        <SectionCard title="Refund Records" detail={`${data.refunds?.total || 0} matching records`}>
          <RefundsTable items={tableItems.refunds} />
        </SectionCard>
      ) : null}

      {mode === "expenses" ? (
        <SectionCard title="Booking-Linked Expenses" detail={`${data.expenses?.total || 0} matching records`}>
          <ExpensesTable items={tableItems.expenses} />
        </SectionCard>
      ) : null}

      {mode === "profitability" ? (
        <Row className="g-4">
          <Col md={6} xl={3}>
            <AdminMetricCard label="Net Revenue" value={money(data.profitability?.totals?.netRevenue, data.profitability?.currency)} icon={BsReceipt} />
          </Col>
          <Col md={6} xl={3}>
            <AdminMetricCard label="Direct Cost" value={money(data.profitability?.totals?.actualDirectCost, data.profitability?.currency)} icon={BsClipboard2Check} />
          </Col>
          <Col md={6} xl={3}>
            <AdminMetricCard label="Provider Fees" value={money(data.profitability?.totals?.paymentProviderFees, data.profitability?.currency)} icon={BsCreditCard2Front} />
          </Col>
          <Col md={6} xl={3}>
            <AdminMetricCard label="Margin" value={percent(data.profitability?.totals?.profitMargin)} icon={BsGraphUpArrow} />
          </Col>
          <Col xs={12}>
            <SectionCard title="Profitability by Booking" detail={`${data.profitability?.count || 0} scanned bookings`}>
              <ProfitabilityTable items={tableItems.profitability} />
            </SectionCard>
          </Col>
        </Row>
      ) : null}

      {mode === "reconciliation" ? (
        <SectionCard title="Reconciliation Issues" detail={`${data.reconciliation?.count || 0} issues in bounded scan`}>
          <ReconciliationTable items={tableItems.reconciliation} />
        </SectionCard>
      ) : null}
    </div>
  );
};

export default AdminBookingAccountingPage;
