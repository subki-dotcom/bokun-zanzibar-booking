import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Form, Spinner } from "react-bootstrap";
import {
  BsArrowClockwise,
  BsBarChartLine,
  BsBriefcase,
  BsCalendar3,
  BsCheck2Circle,
  BsDownload,
  BsExclamationTriangle,
  BsFilter,
  BsPrinter,
  BsSearch,
  BsWallet2
} from "react-icons/bs";
import { Link, useSearchParams } from "react-router-dom";
import {
  fetchAccountingHealth,
  fetchTrialBalance
} from "../../api/adminApi";
import ErrorAlert from "../../components/common/ErrorAlert";
import { formatCurrency } from "../../utils/formatters";

const ACCOUNT_TABS = [
  { key: "all", label: "All Accounts", type: "" },
  { key: "assets", label: "Assets", type: "ASSET" },
  { key: "liabilities", label: "Liabilities", type: "LIABILITY" },
  { key: "equity", label: "Equity", type: "EQUITY" },
  { key: "income", label: "Income", type: "REVENUE" },
  { key: "expenses", label: "Expenses", type: "EXPENSE" },
  { key: "other", label: "Other", type: "OTHER" }
];
const LIMITS = [10, 25, 50, 100];
const ACTIVITY_OPTIONS = [
  { value: "all", label: "All Activity" },
  { value: "with_activity", label: "With Activity" },
  { value: "with_balance", label: "With Balance" },
  { value: "no_activity", label: "No Period Activity" }
];

const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStartIso = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
};
const labelize = (value = "") =>
  String(value || "")
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
const money = (value, currency = "USD") => formatCurrency(Number(value || 0), currency || "USD");
const number = (value = 0) => Number(value || 0).toLocaleString();
const csvValue = (value = "") => `"${String(value ?? "").replace(/"/g, '""')}"`;

const updateQuery = (setSearchParams, updates = {}) => {
  setSearchParams((current) => {
    const next = new URLSearchParams(current);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === "" || value === null || value === undefined) next.delete(key);
      else next.set(key, String(value));
    });
    return next;
  });
};

const downloadCsv = (rows = [], totals = {}, filters = {}) => {
  const csv = [
    ["Code", "Account", "Type", "Opening Debit", "Opening Credit", "Period Debit", "Period Credit", "Closing Debit", "Closing Credit", "Review Status"].join(","),
    ...rows.map((row) => [
      row.accountCode,
      row.accountName,
      row.accountType,
      row.openingDebit,
      row.openingCredit,
      row.periodDebit,
      row.periodCredit,
      row.closingDebit,
      row.closingCredit,
      row.reviewStatus
    ].map(csvValue).join(",")),
    ["TOTAL", "", "", totals.openingDebit, totals.openingCredit, totals.periodDebit, totals.periodCredit, totals.closingDebit, totals.closingCredit, ""].map(csvValue).join(",")
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `trial-balance-${filters.fromDate || "all"}-${filters.toDate || todayIso()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

const KpiCard = ({ label, value, detail, tone, icon: Icon }) => (
  <section className={`tb-kpi-card ${tone}`}>
    <span><Icon /></span>
    <div>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  </section>
);

const Skeleton = () => (
  <div className="tb-skeleton-grid">
    {Array.from({ length: 8 }).map((_, index) => <span key={index} />)}
  </div>
);

const TrendChart = ({ trend = {}, currency }) => {
  const points = trend.points || [];
  const max = Math.max(1, ...points.flatMap((point) => [Number(point.debit || 0), Number(point.credit || 0)]));
  if (!points.length) return <div className="tb-empty-state compact">No posted activity for this period.</div>;
  return (
    <div className="tb-trend-chart" aria-label="Debit versus credit trend">
      <div className="tb-chart-scale">
        <span>{money(max, currency)}</span>
        <span>{money(max / 2, currency)}</span>
        <span>{money(0, currency)}</span>
      </div>
      <div className="tb-chart-bars">
        {points.map((point) => (
          <div className="tb-chart-bucket" key={point.bucket} title={`${point.label}: debit ${money(point.debit, currency)}, credit ${money(point.credit, currency)}`}>
            <div>
              <span className="debit" style={{ height: `${Math.max(4, (Number(point.debit || 0) / max) * 100)}%` }} />
              <span className="credit" style={{ height: `${Math.max(4, (Number(point.credit || 0) / max) * 100)}%` }} />
            </div>
            <small>{point.label.slice(5)}</small>
          </div>
        ))}
      </div>
    </div>
  );
};

const TypeBars = ({ rows = [], currency }) => {
  const max = Math.max(1, ...rows.map((row) => Number(row.absoluteBalance || 0)));
  if (!rows.length) return <div className="tb-empty-state compact">No account type balances for this period.</div>;
  return (
    <div className="tb-type-bars">
      {rows.map((row) => (
        <div key={row.accountType}>
          <span>{row.label}</span>
          <strong>{money(row.absoluteBalance, currency)}</strong>
          <i><b style={{ width: `${Math.max(4, (Number(row.absoluteBalance || 0) / max) * 100)}%` }} /></i>
        </div>
      ))}
    </div>
  );
};

const TrialAccountCard = ({ row, currency }) => (
  <article className="tb-mobile-card">
    <div>
      <strong>{row.accountCode}</strong>
      <span className={row.reviewStatus === "review" ? "review" : "normal"}>{row.reviewStatus === "review" ? "Review" : "Normal"}</span>
    </div>
    <h3>{row.accountName}</h3>
    <small>{labelize(row.accountType)} - {labelize(row.accountSubtype)}</small>
    <dl>
      <div><dt>Opening</dt><dd>DR {money(row.openingDebit, currency)} / CR {money(row.openingCredit, currency)}</dd></div>
      <div><dt>Period</dt><dd>DR {money(row.periodDebit, currency)} / CR {money(row.periodCredit, currency)}</dd></div>
      <div><dt>Closing</dt><dd>DR {money(row.closingDebit, currency)} / CR {money(row.closingCredit, currency)}</dd></div>
    </dl>
    {row.reviewReason ? <p>{row.reviewReason}</p> : null}
    <Link to={`/admin/business-accounting/general-ledger?accountCode=${encodeURIComponent(row.accountCode)}&view=account`}>
      View Ledger
    </Link>
  </article>
);

const AdminTrialBalancePage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [trialBalance, setTrialBalance] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");

  const filters = useMemo(() => ({
    tab: searchParams.get("tab") || "all",
    search: searchParams.get("search") || "",
    accountType: searchParams.get("accountType") || "",
    accountSubtype: searchParams.get("accountSubtype") || "",
    status: searchParams.get("status") || "all",
    activity: searchParams.get("activity") || "all",
    balanceSide: searchParams.get("balanceSide") || "all",
    fromDate: searchParams.get("fromDate") || monthStartIso(),
    toDate: searchParams.get("toDate") || todayIso(),
    page: searchParams.get("page") || "1",
    limit: searchParams.get("limit") || "25"
  }), [searchParams]);

  const activeTab = ACCOUNT_TABS.find((tab) => tab.key === filters.tab) || ACCOUNT_TABS[0];
  const query = useMemo(() => ({
    search: filters.search,
    accountType: filters.accountType || activeTab.type,
    accountSubtype: filters.accountSubtype,
    status: filters.status,
    activity: filters.activity,
    balanceSide: filters.balanceSide,
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    page: filters.page,
    limit: filters.limit,
    sortBy: "accountCode",
    sortDirection: "asc"
  }), [activeTab.type, filters]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const [trialResult, healthResult] = await Promise.all([
        fetchTrialBalance(query),
        fetchAccountingHealth()
      ]);
      setTrialBalance(trialResult);
      setHealth(healthResult);
    } catch (err) {
      setError(err.message || "Unable to load Trial Balance.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setSearchInput(filters.search);
  }, [filters.search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== filters.search) updateQuery(setSearchParams, { search: searchInput, page: 1 });
    }, 400);
    return () => clearTimeout(timer);
  }, [filters.search, searchInput, setSearchParams]);

  const totals = trialBalance?.totals || {};
  const summary = trialBalance?.summary || {};
  const pagination = trialBalance?.pagination || {};
  const rows = trialBalance?.items || [];
  const currency = summary.baseCurrency || summary.baseCurrencies?.[0] || "USD";
  const hasData = Boolean(summary.hasData);
  const balanceStatus = hasData ? (trialBalance?.balanced ? "Balanced" : "Needs Attention") : "No Data";

  const resetFilters = () => {
    setSearchInput("");
    setSearchParams({
      fromDate: monthStartIso(),
      toDate: todayIso(),
      tab: "all",
      status: "all",
      activity: "all",
      balanceSide: "all",
      page: "1",
      limit: filters.limit
    });
  };

  const exportTrialBalance = async () => {
    setExporting(true);
    setError("");
    try {
      const exportData = await fetchTrialBalance({ ...query, page: 1, limit: 1000 });
      downloadCsv(exportData.items || [], exportData.totals || {}, query);
    } catch (err) {
      setError(err.message || "Unable to export Trial Balance.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="trial-balance-page">
      <header className="tb-page-header">
        <div>
          <nav aria-label="Breadcrumb">Business Accounting / <strong>Trial Balance</strong></nav>
          <h1>Trial Balance</h1>
          <p>Review opening balances, period movements, and closing balances across all ledger accounts.</p>
        </div>
        <div className="tb-header-actions">
          <label>
            <BsCalendar3 />
            <input type="date" value={filters.fromDate} onChange={(event) => updateQuery(setSearchParams, { fromDate: event.target.value, page: 1 })} aria-label="From date" />
            <span>-</span>
            <input type="date" value={filters.toDate} onChange={(event) => updateQuery(setSearchParams, { toDate: event.target.value, page: 1 })} aria-label="To date" />
          </label>
          <Button variant="outline-secondary" disabled title="Compare period needs a dedicated comparison contract">
            Compare Period
          </Button>
          <Button variant="outline-primary" onClick={exportTrialBalance} disabled={exporting}>
            {exporting ? <Spinner size="sm" /> : <BsDownload />} Export
          </Button>
          <Button variant="outline-secondary" onClick={() => window.print()}>
            <BsPrinter /> Print
          </Button>
          <Button variant="outline-secondary" onClick={() => load({ silent: true })} disabled={refreshing}>
            {refreshing ? <Spinner size="sm" /> : <BsArrowClockwise />} Refresh
          </Button>
        </div>
      </header>

      <ErrorAlert error={error} />
      {loading ? <Skeleton /> : null}

      {!loading ? (
        <>
          <section className="tb-kpi-grid primary">
            <KpiCard label="Total Debit" value={money(totals.debit, currency)} detail="Closing debit total" tone="debit" icon={BsWallet2} />
            <KpiCard label="Total Credit" value={money(totals.credit, currency)} detail="Closing credit total" tone="credit" icon={BsWallet2} />
            <KpiCard label="Difference" value={money(totals.difference, currency)} detail={balanceStatus} tone={trialBalance?.balanced ? "balanced" : "review"} icon={BsBarChartLine} />
            <KpiCard label="Balance Status" value={balanceStatus} detail={hasData ? `${number(summary.totalAccounts)} accounts evaluated` : "Not evaluated"} tone={trialBalance?.balanced ? "balanced" : "review"} icon={trialBalance?.balanced ? BsCheck2Circle : BsExclamationTriangle} />
          </section>

          <section className="tb-kpi-grid secondary">
            <KpiCard label="Accounts with Activity" value={number(summary.accountsWithActivity)} detail="Posted movement in period" tone="activity" icon={BsBriefcase} />
            <KpiCard label="Debit-Balance Accounts" value={number(summary.debitBalanceAccounts)} detail="Closing debit side" tone="debit" icon={BsWallet2} />
            <KpiCard label="Credit-Balance Accounts" value={number(summary.creditBalanceAccounts)} detail="Closing credit side" tone="credit" icon={BsWallet2} />
            <KpiCard label="Accounts Requiring Review" value={number(summary.reviewAccounts)} detail="Abnormal balance side" tone={summary.reviewAccounts ? "review" : "balanced"} icon={summary.reviewAccounts ? BsExclamationTriangle : BsCheck2Circle} />
          </section>

          <section className="tb-analytics-grid">
            <article className="tb-panel tb-trend-panel">
              <div className="tb-panel-title">
                <h2>Debit vs Credit Trend</h2>
                <span><i className="debit" /> Debit <i className="credit" /> Credit</span>
              </div>
              <TrendChart trend={trialBalance?.trend} currency={currency} />
            </article>

            <article className="tb-panel">
              <div className="tb-panel-title">
                <h2>Balance by Account Type</h2>
              </div>
              <TypeBars rows={summary.byType || []} currency={currency} />
            </article>

            <article className="tb-panel tb-health-panel">
              <h2>Trial Balance Health</h2>
              <dl>
                <div><dt>Ledger Integrity</dt><dd>{trialBalance?.balanced ? "Balanced" : "Review"}</dd></div>
                <div><dt>Journal Balance</dt><dd>{health?.checks?.unbalancedJournals || 0} issues</dd></div>
                <div><dt>Accounts Review</dt><dd>{summary.reviewAccounts || 0} accounts</dd></div>
              </dl>
              <span className={`tb-health-badge ${trialBalance?.balanced && !summary.reviewAccounts ? "healthy" : "review"}`}>
                {trialBalance?.balanced && !summary.reviewAccounts ? "Healthy" : "Needs Attention"}
              </span>
            </article>
          </section>

          <section className="tb-register-panel">
            <div className="tb-tabs" role="tablist" aria-label="Trial balance account type filters">
              {ACCOUNT_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={filters.tab === tab.key ? "active" : ""}
                  onClick={() => updateQuery(setSearchParams, { tab: tab.key, accountType: "", page: 1 })}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="tb-filter-bar">
              <label className="tb-search">
                <BsSearch />
                <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search by account code or account name..." aria-label="Search Trial Balance" />
              </label>
              <Form.Select value={filters.accountType || activeTab.type} onChange={(event) => updateQuery(setSearchParams, { accountType: event.target.value, tab: "all", page: 1 })} aria-label="Filter by account type">
                <option value="">All Account Types</option>
                <option value="ASSET">Assets</option>
                <option value="LIABILITY">Liabilities</option>
                <option value="EQUITY">Equity</option>
                <option value="REVENUE">Income</option>
                <option value="EXPENSE">Expenses</option>
                <option value="OTHER">Other</option>
              </Form.Select>
              <Form.Select value={filters.status} onChange={(event) => updateQuery(setSearchParams, { status: event.target.value, page: 1 })} aria-label="Filter by review status">
                <option value="all">All Account Status</option>
                <option value="normal">Normal</option>
                <option value="review">Needs Review</option>
              </Form.Select>
              <Form.Select value={filters.activity} onChange={(event) => updateQuery(setSearchParams, { activity: event.target.value, page: 1 })} aria-label="Filter by activity">
                {ACTIVITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Form.Select>
              <Button variant="outline-secondary" disabled title="Subtype and materiality filters need a dedicated backend contract">
                <BsFilter /> More Filters
              </Button>
              <Button variant="outline-secondary" onClick={resetFilters}>
                <BsArrowClockwise /> Reset
              </Button>
            </div>

            {rows.length ? (
              <>
                <div className="tb-table-scroll">
                  <table className="tb-table">
                    <thead>
                      <tr>
                        <th><input type="checkbox" aria-label="Select all Trial Balance rows" disabled /></th>
                        <th>Code</th>
                        <th>Account Name</th>
                        <th>Type</th>
                        <th className="text-end">Opening DR</th>
                        <th className="text-end">Opening CR</th>
                        <th className="text-end">Period DR</th>
                        <th className="text-end">Period CR</th>
                        <th className="text-end">Closing DR</th>
                        <th className="text-end">Closing CR</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.accountCode}>
                          <td><input type="checkbox" aria-label={`Select account ${row.accountCode}`} disabled /></td>
                          <td><Link to={`/admin/business-accounting/general-ledger?accountCode=${encodeURIComponent(row.accountCode)}&view=account`}>{row.accountCode}</Link></td>
                          <td>{row.accountName}</td>
                          <td>{labelize(row.accountType)}</td>
                          <td className="text-end">{money(row.openingDebit, currency)}</td>
                          <td className="text-end">{money(row.openingCredit, currency)}</td>
                          <td className="text-end">{money(row.periodDebit, currency)}</td>
                          <td className="text-end">{money(row.periodCredit, currency)}</td>
                          <td className="text-end">{money(row.closingDebit, currency)}</td>
                          <td className="text-end">{money(row.closingCredit, currency)}</td>
                          <td><span className={`tb-status ${row.reviewStatus}`}>{row.reviewStatus === "review" ? "Review" : "Normal"}</span></td>
                          <td><Link className="tb-row-action" to={`/admin/business-accounting/general-ledger?accountCode=${encodeURIComponent(row.accountCode)}&view=account`}>View Ledger</Link></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th colSpan="4">Total</th>
                        <th className="text-end">{money(totals.openingDebit, currency)}</th>
                        <th className="text-end">{money(totals.openingCredit, currency)}</th>
                        <th className="text-end">{money(totals.periodDebit, currency)}</th>
                        <th className="text-end">{money(totals.periodCredit, currency)}</th>
                        <th className="text-end">{money(totals.closingDebit, currency)}</th>
                        <th className="text-end">{money(totals.closingCredit, currency)}</th>
                        <th colSpan="2">{balanceStatus}</th>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="tb-mobile-list">
                  {rows.map((row) => <TrialAccountCard key={row.accountCode} row={row} currency={currency} />)}
                </div>
              </>
            ) : (
              <div className="tb-empty-state">
                <BsWallet2 />
                <strong>Trial Balance not yet available.</strong>
                <p>No posted accounting activity exists for the selected period.</p>
                <div>
                  <Link to="/admin/business-accounting/chart-of-accounts">View Chart of Accounts</Link>
                  <Link to="/admin/business-accounting/journal-entries">View Journal Entries</Link>
                </div>
              </div>
            )}

            <footer className="tb-mobile-totals">
              <strong>Trial Balance Totals</strong>
              <span>Closing Debit {money(totals.closingDebit, currency)}</span>
              <span>Closing Credit {money(totals.closingCredit, currency)}</span>
              <span>Difference {money(totals.difference, currency)}</span>
              <b>{balanceStatus}</b>
            </footer>

            <footer className="tb-pagination">
              <span>Showing {number(pagination.from || 0)} to {number(pagination.to || 0)} of {number(pagination.total || 0)} accounts</span>
              <div>
                <Button variant="outline-secondary" disabled={!pagination.hasPrevious} onClick={() => updateQuery(setSearchParams, { page: Number(filters.page || 1) - 1 })}>Prev</Button>
                <strong>{pagination.page || 1}</strong>
                <Button variant="outline-secondary" disabled={!pagination.hasNext} onClick={() => updateQuery(setSearchParams, { page: Number(filters.page || 1) + 1 })}>Next</Button>
                <Form.Select value={filters.limit} onChange={(event) => updateQuery(setSearchParams, { limit: event.target.value, page: 1 })} aria-label="Rows per page">
                  {LIMITS.map((limit) => <option key={limit} value={limit}>{limit} / page</option>)}
                </Form.Select>
              </div>
            </footer>
          </section>
        </>
      ) : null}
    </div>
  );
};

export default AdminTrialBalancePage;
