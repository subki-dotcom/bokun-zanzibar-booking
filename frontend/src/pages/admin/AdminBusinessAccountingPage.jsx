import { useEffect, useMemo, useState } from "react";
import { Button } from "react-bootstrap";
import {
  BsArrowClockwise,
  BsBank,
  BsCalendar3,
  BsCashCoin,
  BsCheckCircleFill,
  BsDownload,
  BsExclamationTriangle,
  BsGraphUpArrow,
  BsInfoCircle,
  BsPieChartFill,
  BsReceipt,
  BsWallet2
} from "react-icons/bs";
import { fetchBusinessAccountingFoundation } from "../../api/adminApi";
import ErrorAlert from "../../components/common/ErrorAlert";
import { formatCurrency, formatDate } from "../../utils/formatters";

const PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7_days", label: "Last 7 Days" },
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "this_quarter", label: "Quarter" },
  { value: "this_year", label: "Year" },
  { value: "custom", label: "Custom Range" }
];

const KPI_ICONS = {
  bookingNetContribution: BsGraphUpArrow,
  otherBusinessIncome: BsWallet2,
  companyExpenses: BsReceipt,
  companyNetProfit: BsPieChartFill
};

const KPI_LABELS = {
  bookingNetContribution: "Booking Net Contribution",
  otherBusinessIncome: "Other Business Income",
  companyExpenses: "Company Expenses",
  companyNetProfit: "Company Net Profit"
};

const money = (value, currency = "USD") => formatCurrency(value || 0, currency || "USD");

const prettyLabel = (value = "") =>
  String(value || "")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const changeText = (value) => {
  if (value === null || value === undefined) return "New activity";
  const prefix = Number(value || 0) >= 0 ? "+" : "";
  return `${prefix}${Number(value || 0).toFixed(1)}%`;
};

const toneForChange = (value, inverted = false) => {
  if (value === null || value === undefined) return "neutral";
  const positive = Number(value || 0) >= 0;
  return positive === !inverted ? "up" : "down";
};

const downloadCsv = (foundation) => {
  const rows = [
    ["Section", "Reference", "Category", "Description", "Date", "Status", "Currency", "Amount"],
    ...(foundation?.recentIncome || []).map((row) => [
      "Recent Business Income",
      row.reference,
      row.categoryLabel || row.category,
      row.description,
      row.date,
      row.status,
      row.currency,
      row.amount
    ]),
    ...(foundation?.recentExpenses || []).map((row) => [
      "Recent Business Expenses",
      row.reference,
      row.categoryLabel || row.category,
      row.description,
      row.date,
      row.status,
      row.currency,
      row.amount
    ])
  ];
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "management-accounting-dashboard.csv";
  link.click();
  URL.revokeObjectURL(url);
};

const Sparkline = ({ points = [], tone = "teal" }) => {
  const values = points.length ? points : [0, 0, 0, 0];
  const max = Math.max(...values.map(Math.abs), 1);
  const width = 92;
  const height = 42;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const path = values
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value + max) / (max * 2)) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${Math.max(4, Math.min(height - 4, y)).toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg className={`management-accounting-sparkline is-${tone}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Period trend">
      <path d={path} />
    </svg>
  );
};

const KpiCard = ({ kpi }) => {
  const Icon = KPI_ICONS[kpi.id] || BsCashCoin;
  const expenseCard = kpi.id === "companyExpenses";
  const tone = kpi.tone || "teal";

  return (
    <article className={`management-accounting-kpi is-${tone}`}>
      <div className="management-accounting-kpi-main">
        <span className="management-accounting-kpi-icon"><Icon aria-hidden="true" /></span>
        <div>
          <span>{kpi.label}</span>
          <strong>{money(kpi.value, kpi.currency)}</strong>
          <small className={`is-${toneForChange(kpi.changePercent, expenseCard)}`}>
            {changeText(kpi.changePercent)} vs previous period
          </small>
        </div>
      </div>
      <Sparkline points={kpi.sparkline} tone={tone} />
    </article>
  );
};

const CardShell = ({ title, action, children, className = "" }) => (
  <section className={`management-accounting-card ${className}`.trim()}>
    <header>
      <h3>{title}</h3>
      {action}
    </header>
    {children}
  </section>
);

const EmptyState = ({ message }) => (
  <div className="management-accounting-empty">
    <BsInfoCircle aria-hidden="true" />
    <span>{message}</span>
  </div>
);

const Skeleton = ({ type = "card" }) => (
  <div className={`management-accounting-skeleton is-${type}`} aria-hidden="true">
    <span />
    <span />
    <span />
  </div>
);

const IncomeExpenseChart = ({ points = [], currency = "USD" }) => {
  if (!points.length) return <EmptyState message="No accounting activity available for the selected period." />;

  const width = 640;
  const height = 260;
  const padding = 36;
  const max = Math.max(...points.flatMap((point) => [Number(point.income || 0), Number(point.expenses || 0)]), 1);
  const x = (index) => padding + (index * (width - padding * 2)) / Math.max(points.length - 1, 1);
  const y = (value) => height - padding - (Number(value || 0) / max) * (height - padding * 2);
  const buildPath = (key) => points.map((point, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(point[key])}`).join(" ");
  const ticks = [0, 0.5, 1].map((ratio) => ({
    value: max * ratio,
    y: height - padding - ratio * (height - padding * 2)
  }));

  return (
    <div className="management-accounting-line-chart" role="img" aria-label="Income versus expenses chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {ticks.map((tick) => (
          <g key={tick.y}>
            <line x1={padding} x2={width - padding} y1={tick.y} y2={tick.y} />
            <text x={4} y={tick.y + 4}>{money(tick.value, currency).replace(".00", "")}</text>
          </g>
        ))}
        <path className="is-income-fill" d={`${buildPath("income")} L ${x(points.length - 1)} ${height - padding} L ${padding} ${height - padding} Z`} />
        <path className="is-expense-fill" d={`${buildPath("expenses")} L ${x(points.length - 1)} ${height - padding} L ${padding} ${height - padding} Z`} />
        <path className="is-income" d={buildPath("income")} />
        <path className="is-expense" d={buildPath("expenses")} />
        {points.map((point, index) => (
          <g key={point.key || index}>
            <circle className="is-income-dot" cx={x(index)} cy={y(point.income)} r="3.5" />
            <circle className="is-expense-dot" cx={x(index)} cy={y(point.expenses)} r="3.5" />
          </g>
        ))}
      </svg>
      <div className="management-accounting-chart-axis">
        {points.slice(0, 6).map((point) => <span key={point.key}>{point.label}</span>)}
      </div>
    </div>
  );
};

const donutBackground = (rows = []) => {
  const colors = ["#10b981", "#1d7ff0", "#ff4d57", "#f59e0b", "#8b5cf6", "#64748b"];
  let cursor = 0;
  const segments = rows.map((row, index) => {
    const start = cursor;
    cursor += Number(row.percentage || 0);
    return `${colors[index % colors.length]} ${start}% ${cursor}%`;
  });
  return segments.length ? `conic-gradient(${segments.join(", ")})` : "conic-gradient(#e2e8f0 0% 100%)";
};

const DonutBreakdown = ({ rows = [], total = 0, currency = "USD", centerLabel }) => {
  if (!rows.length || Number(total || 0) === 0) {
    return <EmptyState message={`${centerLabel} is empty for this period.`} />;
  }

  return (
    <div className="management-accounting-donut-wrap">
      <div className="management-accounting-donut" style={{ background: donutBackground(rows) }}>
        <div>
          <strong>{money(total, currency)}</strong>
          <span>{centerLabel}</span>
        </div>
      </div>
      <div className="management-accounting-breakdown-list">
        {rows.slice(0, 5).map((row, index) => (
          <div key={row.label}>
            <i style={{ "--dot-color": ["#10b981", "#1d7ff0", "#ff4d57", "#f59e0b", "#8b5cf6"][index % 5] }} />
            <span>{row.label}</span>
            <strong>{money(row.amount, currency)}</strong>
            <small>{Number(row.percentage || 0).toFixed(1)}%</small>
          </div>
        ))}
      </div>
    </div>
  );
};

const StatusPill = ({ value }) => (
  <span className={`management-accounting-status is-${String(value || "").toLowerCase()}`}>
    {prettyLabel(value)}
  </span>
);

const TransactionTable = ({ rows = [], type = "income", currency = "USD" }) => {
  const emptyMessage = type === "income"
    ? "No business income recorded for this period."
    : "No company expenses recorded for this period.";

  if (!rows.length) return <EmptyState message={emptyMessage} />;

  return (
    <>
      <div className="management-accounting-table-wrap">
        <table className="management-accounting-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Reference</th>
              <th>Category</th>
              <th>Description</th>
              <th className="text-end">Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id || row.reference}>
                <td>{formatDate(row.date, "DD MMM YYYY")}</td>
                <td><strong>{row.reference}</strong></td>
                <td>{row.categoryLabel || prettyLabel(row.category)}</td>
                <td className="management-accounting-truncate"><span>{row.description || "-"}</span></td>
                <td className="text-end">{money(row.amount, row.currency || currency)}</td>
                <td><StatusPill value={row.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="management-accounting-mobile-transactions">
        {rows.map((row) => (
          <article key={`${row.id || row.reference}-mobile`}>
            <header>
              <strong>{row.reference}</strong>
              <StatusPill value={row.status} />
            </header>
            <p>{row.description || "-"}</p>
            <div>
              <span>{row.categoryLabel || prettyLabel(row.category)}</span>
              <span>{formatDate(row.date, "DD MMM YYYY")}</span>
              <strong>{money(row.amount, row.currency || currency)}</strong>
            </div>
          </article>
        ))}
      </div>
    </>
  );
};

const SourceStrategy = ({ strategy = {} }) => {
  const rows = Object.values(strategy);
  if (!rows.length) return <EmptyState message="Source link strategy is not configured." />;

  return (
    <div className="management-accounting-source-list">
      {rows.map((row) => (
        <div key={row.label}>
          <BsCheckCircleFill aria-hidden="true" />
          <div>
            <strong>{row.label}</strong>
            <span>{row.description}</span>
          </div>
          <em>{row.value}</em>
        </div>
      ))}
    </div>
  );
};

const AdminBusinessAccountingPage = () => {
  const [foundation, setFoundation] = useState(null);
  const [period, setPeriod] = useState("this_month");
  const [customRange, setCustomRange] = useState({ fromDate: "", toDate: "" });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const query = useMemo(() => {
    if (period === "custom") {
      return {
        dateRange: "custom",
        fromDate: customRange.fromDate || undefined,
        toDate: customRange.toDate || undefined
      };
    }
    return { dateRange: period };
  }, [customRange.fromDate, customRange.toDate, period]);

  const load = async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const nextFoundation = await fetchBusinessAccountingFoundation(query);
      setFoundation(nextFoundation);
    } catch (err) {
      setError(err.message || "Failed to load management accounting");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, [query]);

  const totals = foundation?.totals || {};
  const kpis = foundation?.kpis || {};
  const currency = foundation?.currency || "USD";
  const periodLabel = foundation?.period?.label || PERIOD_OPTIONS.find((option) => option.value === period)?.label || "This Month";

  return (
    <div className="management-accounting-page">
      <div className="management-accounting-header">
        <div>
          <div className="management-accounting-breadcrumb">
            <BsBank aria-hidden="true" />
            <span>Business Accounting</span>
            <span>/</span>
            <strong>Management Accounting</strong>
          </div>
          <h1>Management Accounting</h1>
          <p>Company-wide contribution, income, and expense evidence without duplicating booking accounting revenue.</p>
        </div>

        <div className="management-accounting-actions">
          <label>
            <BsCalendar3 aria-hidden="true" />
            <select value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Accounting period">
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          {period === "custom" ? (
            <>
              <input
                type="date"
                value={customRange.fromDate}
                aria-label="Custom range start"
                onChange={(event) => setCustomRange((current) => ({ ...current, fromDate: event.target.value }))}
              />
              <input
                type="date"
                value={customRange.toDate}
                aria-label="Custom range end"
                onChange={(event) => setCustomRange((current) => ({ ...current, toDate: event.target.value }))}
              />
            </>
          ) : null}
          <Button type="button" variant="outline-secondary" onClick={() => load({ silent: true })} disabled={refreshing || loading}>
            <BsArrowClockwise aria-hidden="true" /> {refreshing ? "Refreshing" : "Refresh"}
          </Button>
          <Button type="button" variant="outline-secondary" onClick={() => downloadCsv(foundation)} disabled={!foundation || loading}>
            <BsDownload aria-hidden="true" /> Export
          </Button>
        </div>
      </div>

      <ErrorAlert error={error} />

      {foundation?.currencySummary?.warning ? (
        <div className="management-accounting-warning" role="status">
          <BsExclamationTriangle aria-hidden="true" />
          {foundation.currencySummary.warning}
        </div>
      ) : null}

      <div className="management-accounting-kpi-grid">
        {loading ? Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} />) : (
          ["bookingNetContribution", "otherBusinessIncome", "companyExpenses", "companyNetProfit"].map((key) => (
            <KpiCard key={key} kpi={kpis[key] || { id: key, label: KPI_LABELS[key] || prettyLabel(key), value: 0, currency }} />
          ))
        )}
      </div>

      <div className="management-accounting-analytics-grid">
        <CardShell
          title="Income vs Expenses"
          className="is-wide"
          action={<span className="management-accounting-period-pill">{periodLabel}</span>}
        >
          {loading ? <Skeleton type="chart" /> : <IncomeExpenseChart points={foundation?.incomeVsExpenses || []} currency={currency} />}
        </CardShell>
        <CardShell title="Income Breakdown" action={<span className="management-accounting-period-pill">{periodLabel}</span>}>
          {loading ? <Skeleton type="donut" /> : (
            <DonutBreakdown
              rows={foundation?.incomeBreakdown || []}
              total={totals.companyContributionRevenue}
              currency={currency}
              centerLabel="Total Income"
            />
          )}
        </CardShell>
        <CardShell title="Expense Breakdown" action={<span className="management-accounting-period-pill">{periodLabel}</span>}>
          {loading ? <Skeleton type="donut" /> : (
            <DonutBreakdown
              rows={foundation?.expenseBreakdown || []}
              total={totals.companyExpenses}
              currency={currency}
              centerLabel="Total Expenses"
            />
          )}
        </CardShell>
      </div>

      <div className="management-accounting-transaction-grid">
        <CardShell
          title="Recent Business Income"
          action={<button type="button" disabled title="A dedicated business income register is not available in this admin shell yet.">View All</button>}
        >
          {loading ? <Skeleton type="table" /> : <TransactionTable rows={foundation?.recentIncome || []} type="income" currency={currency} />}
        </CardShell>
        <CardShell
          title="Recent Business Expenses"
          action={<button type="button" disabled title="A dedicated business expense register is not available in this admin shell yet.">View All</button>}
        >
          {loading ? <Skeleton type="table" /> : <TransactionTable rows={foundation?.recentExpenses || []} type="expense" currency={currency} />}
        </CardShell>
      </div>

      <CardShell
        title="Source Link Strategy"
        action={<button type="button" disabled title="Accounting source settings are managed in backend controls.">Edit Settings</button>}
      >
        {loading ? <Skeleton type="source" /> : <SourceStrategy strategy={foundation?.sourceStrategy} />}
      </CardShell>
    </div>
  );
};

export default AdminBusinessAccountingPage;
