import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Form, Spinner } from "react-bootstrap";
import {
  BsArrowClockwise,
  BsBarChartLine,
  BsCalendar3,
  BsChevronLeft,
  BsChevronRight,
  BsDownload,
  BsEye,
  BsFilter,
  BsJournalText,
  BsLayers,
  BsSearch,
  BsThreeDots,
  BsWallet2
} from "react-icons/bs";
import { Link, useSearchParams } from "react-router-dom";
import {
  fetchAccountingHealth,
  fetchChartOfAccounts,
  fetchGeneralLedger
} from "../../api/adminApi";
import { formatDateTime } from "../../components/admin/AdminDataWidgets";
import ErrorAlert from "../../components/common/ErrorAlert";
import { formatCurrency } from "../../utils/formatters";

const SOURCE_OPTIONS = [
  "MANUAL",
  "BOOKING_ACCOUNTING",
  "BUSINESS_ACCOUNTING",
  "BOOKING",
  "INVOICE",
  "PAYMENT",
  "REFUND",
  "COMMISSION",
  "CASH_MOVEMENT"
];
const LIMITS = [10, 25, 50, 100];
const TABS = [
  { key: "all", label: "All Transactions" },
  { key: "account", label: "By Account" },
  { key: "journal", label: "By Journal" },
  { key: "source", label: "By Source" },
  { key: "month", label: "By Month" }
];

const labelize = (value = "") =>
  String(value || "")
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const todayIso = () => new Date().toISOString().slice(0, 10);

const monthStartIso = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
};

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

const downloadCsv = (rows = [], filters = {}) => {
  const csv = [
    ["Date", "Journal Number", "Account Code", "Account Name", "Reference", "Description", "Debit", "Credit", "Running Balance", "Source"].join(","),
    ...rows.map((row) =>
      [
        row.postingDate,
        row.entryNumber,
        row.accountCode,
        row.accountName,
        row.sourceReference,
        row.description,
        row.baseCurrencyDebit,
        row.baseCurrencyCredit,
        row.runningBalance ?? "",
        row.sourceLabel || row.sourceModule
      ].map(csvValue).join(",")
    )
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `general-ledger-${filters.fromDate || "all"}-${filters.toDate || todayIso()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

const KpiCard = ({ label, value, detail, tone, icon: Icon }) => (
  <section className={`gl-kpi-card ${tone}`}>
    <span><Icon /></span>
    <div>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  </section>
);

const Skeleton = () => (
  <div className="gl-skeleton-grid">
    {Array.from({ length: 4 }).map((_, index) => <span key={index} />)}
  </div>
);

const TrendChart = ({ trend = {}, currency }) => {
  const points = trend.points || [];
  const max = Math.max(
    1,
    ...points.flatMap((point) => [Number(point.debit || 0), Number(point.credit || 0)])
  );

  if (!points.length) {
    return <div className="gl-empty-state compact">No General Ledger activity for this period.</div>;
  }

  return (
    <div className="gl-trend-chart" aria-label="General ledger transaction trend">
      <div className="gl-chart-scale">
        <span>{money(max, currency)}</span>
        <span>{money(max / 2, currency)}</span>
        <span>{money(0, currency)}</span>
      </div>
      <div className="gl-chart-bars">
        {points.map((point) => (
          <div className="gl-chart-bucket" key={point.bucket} title={`${point.label}: debit ${money(point.debit, currency)}, credit ${money(point.credit, currency)}`}>
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

const LedgerLineCard = ({ row, currency, showRunning }) => (
  <article className="gl-mobile-card">
    <div>
      <span>{formatDateTime(row.postingDate)}</span>
      <Link to={`/admin/business-accounting/journal-entries?search=${encodeURIComponent(row.entryNumber)}`}>{row.entryNumber}</Link>
    </div>
    <strong>{row.accountCode} - {row.accountName}</strong>
    <p>{row.description || "-"}</p>
    <dl>
      <div><dt>Reference</dt><dd>{row.sourceReference || "-"}</dd></div>
      <div><dt>Debit</dt><dd>{Number(row.baseCurrencyDebit || 0) ? money(row.baseCurrencyDebit, currency) : "-"}</dd></div>
      <div><dt>Credit</dt><dd>{Number(row.baseCurrencyCredit || 0) ? money(row.baseCurrencyCredit, currency) : "-"}</dd></div>
      {showRunning ? <div><dt>Running</dt><dd>{money(row.runningBalance, currency)}</dd></div> : null}
    </dl>
    <Link className="gl-card-action" to={`/admin/business-accounting/journal-entries?search=${encodeURIComponent(row.entryNumber)}`}>
      View Journal
    </Link>
  </article>
);

const AdminGeneralLedgerRegisterPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [ledger, setLedger] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");
  const [exporting, setExporting] = useState(false);

  const filters = useMemo(() => ({
    view: searchParams.get("view") || "all",
    search: searchParams.get("search") || "",
    accountCode: searchParams.get("accountCode") || "",
    sourceModule: searchParams.get("sourceModule") || "",
    journal: searchParams.get("journal") || "",
    user: searchParams.get("user") || "",
    fromDate: searchParams.get("fromDate") || monthStartIso(),
    toDate: searchParams.get("toDate") || todayIso(),
    page: searchParams.get("page") || "1",
    limit: searchParams.get("limit") || "25",
    sortBy: searchParams.get("sortBy") || "postingDate",
    sortDirection: searchParams.get("sortDirection") || "desc"
  }), [searchParams]);

  const query = useMemo(() => ({
    search: filters.search,
    accountCode: filters.accountCode,
    sourceModule: filters.sourceModule,
    journal: filters.journal,
    user: filters.user,
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    page: filters.page,
    limit: filters.limit,
    sortBy: filters.sortBy,
    sortDirection: filters.sortDirection
  }), [filters]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const [ledgerResult, accountsResult, healthResult] = await Promise.all([
        fetchGeneralLedger(query),
        fetchChartOfAccounts({ status: "active", limit: 1000 }),
        fetchAccountingHealth()
      ]);
      setLedger(ledgerResult);
      setAccounts(accountsResult.items || []);
      setHealth(healthResult);
    } catch (err) {
      setError(err.message || "Unable to load General Ledger.");
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

  const summary = ledger?.summary || {};
  const pagination = ledger?.pagination || {};
  const currency = summary.baseCurrency || ledger?.items?.[0]?.baseCurrency || "USD";
  const isAccountView = filters.view === "account" || Boolean(filters.accountCode);
  const accountSummary = ledger?.accountSummary;
  const rows = ledger?.items || [];
  const totalDebit = summary.totalDebit || 0;
  const totalCredit = summary.totalCredit || 0;
  const difference = summary.difference || 0;

  const resetFilters = () => {
    setSearchInput("");
    setSearchParams({
      fromDate: monthStartIso(),
      toDate: todayIso(),
      view: "all",
      page: "1",
      limit: filters.limit
    });
  };

  const exportLedger = async () => {
    setExporting(true);
    setError("");
    try {
      const exportData = await fetchGeneralLedger({ ...query, page: 1, limit: 1000 });
      downloadCsv(exportData.items || [], query);
    } catch (err) {
      setError(err.message || "Unable to export General Ledger.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="general-ledger-register-page">
      <header className="gl-page-header">
        <div>
          <nav aria-label="Breadcrumb">Business Accounting / <strong>General Ledger</strong></nav>
          <h1>General Ledger</h1>
          <p>View all posted journal transactions and their impact on your accounts.</p>
        </div>
        <div className="gl-header-actions">
          <label>
            <BsCalendar3 />
            <input
              type="date"
              value={filters.fromDate}
              onChange={(event) => updateQuery(setSearchParams, { fromDate: event.target.value, page: 1 })}
              aria-label="From date"
            />
            <span>-</span>
            <input
              type="date"
              value={filters.toDate}
              onChange={(event) => updateQuery(setSearchParams, { toDate: event.target.value, page: 1 })}
              aria-label="To date"
            />
          </label>
          <Button variant="outline-primary" onClick={exportLedger} disabled={exporting}>
            {exporting ? <Spinner size="sm" /> : <BsDownload />} Export
          </Button>
          <Button
            variant="outline-secondary"
            onClick={() => updateQuery(setSearchParams, { view: "account", page: 1 })}
          >
            <BsLayers /> View by Account
          </Button>
        </div>
      </header>

      <ErrorAlert error={error} />
      {loading ? <Skeleton /> : null}

      {!loading ? (
        <>
          <section className="gl-kpi-grid">
            <KpiCard label="Total Transactions" value={number(summary.totalTransactions)} detail="Posted ledger lines" tone="transactions" icon={BsJournalText} />
            <KpiCard label={`Total Debit${currency ? ` (${currency})` : ""}`} value={money(totalDebit, currency)} detail={summary.mixedBaseCurrencies ? "Multiple base currencies detected" : "Selected period"} tone="debit" icon={BsWallet2} />
            <KpiCard label={`Total Credit${currency ? ` (${currency})` : ""}`} value={money(totalCredit, currency)} detail={summary.mixedBaseCurrencies ? "Multiple base currencies detected" : "Selected period"} tone="credit" icon={BsWallet2} />
            <KpiCard label="Accounts in Use" value={number(summary.accountsInUse)} detail={`${number(summary.journalsInUse)} journals in period`} tone="accounts" icon={BsBarChartLine} />
          </section>

          <section className="gl-analytics-grid">
            <article className="gl-panel gl-trend-panel">
              <div className="gl-panel-title">
                <h2>Transaction Trend</h2>
                <span><i className="debit" /> Debit <i className="credit" /> Credit</span>
              </div>
              <TrendChart trend={ledger?.trend} currency={currency} />
            </article>

            <article className="gl-panel">
              <div className="gl-panel-title">
                <h2>Top Accounts by Activity</h2>
                <Link to="/admin/business-accounting/chart-of-accounts">View All</Link>
              </div>
              {(ledger?.topAccounts || []).length ? (
                <table className="gl-compact-table">
                  <thead><tr><th>#</th><th>Account</th><th>Transactions</th><th className="text-end">Amount</th></tr></thead>
                  <tbody>
                    {ledger.topAccounts.map((account) => (
                      <tr key={account.accountCode}>
                        <td>{account.rank}</td>
                        <td>
                          <button type="button" onClick={() => updateQuery(setSearchParams, { accountCode: account.accountCode, view: "account", page: 1 })}>
                            {account.accountCode} {account.accountName}
                          </button>
                        </td>
                        <td>{number(account.transactions)}</td>
                        <td className="text-end">{money(account.amount, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="gl-empty-state compact">No account activity in this period.</div>}
            </article>

            <article className="gl-panel gl-summary-panel">
              <h2>Ledger Summary</h2>
              <dl>
                <div><dt>Total Debit</dt><dd>{money(totalDebit, currency)}</dd></div>
                <div><dt>Total Credit</dt><dd>{money(totalCredit, currency)}</dd></div>
                <div><dt>Difference</dt><dd>{money(difference, currency)}</dd></div>
              </dl>
              <span className={`gl-balance-badge ${summary.balanced ? "balanced" : "problem"}`}>
                {summary.balanced ? "Balanced" : "Needs Attention"}
              </span>
              <small>{health?.status === "PASS" ? "Accounting health checks are passing." : "Review accounting health checks."}</small>
            </article>
          </section>

          {isAccountView ? (
            <section className="gl-account-summary">
              <div>
                <span>Account Ledger</span>
                <strong>{accountSummary?.accountCode || filters.accountCode || "Select an account"} {accountSummary?.accountName || ""}</strong>
              </div>
              <dl>
                <div><dt>Opening Balance</dt><dd>{money(accountSummary?.openingBalance, accountSummary?.baseCurrency || currency)}</dd></div>
                <div><dt>Period Debits</dt><dd>{money(accountSummary?.periodDebit, accountSummary?.baseCurrency || currency)}</dd></div>
                <div><dt>Period Credits</dt><dd>{money(accountSummary?.periodCredit, accountSummary?.baseCurrency || currency)}</dd></div>
                <div><dt>Closing Balance</dt><dd>{money(accountSummary?.closingBalance, accountSummary?.baseCurrency || currency)}</dd></div>
              </dl>
            </section>
          ) : null}

          <section className="gl-register-panel">
            <div className="gl-tabs" role="tablist" aria-label="General ledger views">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={filters.view === tab.key ? "active" : ""}
                  onClick={() => updateQuery(setSearchParams, { view: tab.key, page: 1 })}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="gl-filter-bar">
              <label className="gl-search">
                <BsSearch />
                <input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Search by account, journal, reference, description..."
                  aria-label="Search ledger"
                />
              </label>
              <Form.Select value={filters.accountCode} onChange={(event) => updateQuery(setSearchParams, { accountCode: event.target.value, page: 1 })} aria-label="Filter by account">
                <option value="">All Accounts</option>
                {accounts.map((account) => <option key={account.code} value={account.code}>{account.code} {account.name}</option>)}
              </Form.Select>
              <Form.Select value={filters.sourceModule} onChange={(event) => updateQuery(setSearchParams, { sourceModule: event.target.value, page: 1 })} aria-label="Filter by source">
                <option value="">All Sources</option>
                {SOURCE_OPTIONS.map((source) => <option key={source} value={source}>{labelize(source)}</option>)}
              </Form.Select>
              <input
                className="form-control"
                value={filters.journal}
                onChange={(event) => updateQuery(setSearchParams, { journal: event.target.value, page: 1 })}
                placeholder="All Journals"
                aria-label="Filter by journal"
              />
              <input
                className="form-control"
                value={filters.user}
                onChange={(event) => updateQuery(setSearchParams, { user: event.target.value, page: 1 })}
                placeholder="All Users"
                aria-label="Filter by user"
              />
              <Button variant="outline-secondary" disabled title="Amount and document-type filters need a dedicated backend contract">
                <BsFilter /> More Filters
              </Button>
              <Button variant="outline-secondary" onClick={resetFilters}>
                <BsArrowClockwise /> Reset
              </Button>
            </div>

            {rows.length ? (
              <>
                <div className="gl-table-scroll">
                  <table className="gl-table">
                    <thead>
                      <tr>
                        <th><input type="checkbox" aria-label="Select all ledger rows" disabled /></th>
                        <th>Date</th>
                        <th>Journal #</th>
                        <th>Account</th>
                        <th>Reference</th>
                        <th>Description</th>
                        <th className="text-end">Debit{currency ? ` (${currency})` : ""}</th>
                        <th className="text-end">Credit{currency ? ` (${currency})` : ""}</th>
                        {isAccountView ? <th className="text-end">Running Balance</th> : null}
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id || `${row.entryNumber}-${row.accountCode}-${row.sourceReference}`}>
                          <td><input type="checkbox" aria-label={`Select ledger row ${row.entryNumber}`} disabled /></td>
                          <td>{formatDateTime(row.postingDate)}</td>
                          <td><Link to={`/admin/business-accounting/journal-entries?search=${encodeURIComponent(row.entryNumber)}`}>{row.entryNumber}</Link></td>
                          <td><button type="button" onClick={() => updateQuery(setSearchParams, { accountCode: row.accountCode, view: "account", page: 1 })}>{row.accountCode} {row.accountName}</button></td>
                          <td>{row.sourceReference || "-"}</td>
                          <td title={row.description}>{row.description || "-"}</td>
                          <td className="text-end">{Number(row.baseCurrencyDebit || 0) ? money(row.baseCurrencyDebit, row.baseCurrency || currency) : "-"}</td>
                          <td className="text-end">{Number(row.baseCurrencyCredit || 0) ? money(row.baseCurrencyCredit, row.baseCurrency || currency) : "-"}</td>
                          {isAccountView ? <td className="text-end">{money(row.runningBalance, row.baseCurrency || currency)}</td> : null}
                          <td>
                            <Link className="gl-row-action" to={`/admin/business-accounting/journal-entries?search=${encodeURIComponent(row.entryNumber)}`} aria-label={`View journal ${row.entryNumber}`}>
                              <BsEye />
                            </Link>
                            <button className="gl-row-action" type="button" disabled aria-label="More ledger actions"><BsThreeDots /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="gl-mobile-list">
                  {rows.map((row) => (
                    <LedgerLineCard key={row.id || `${row.entryNumber}-${row.accountCode}-${row.sourceReference}`} row={row} currency={row.baseCurrency || currency} showRunning={isAccountView} />
                  ))}
                </div>
              </>
            ) : (
              <div className="gl-empty-state">
                <BsJournalText />
                <strong>No General Ledger activity yet.</strong>
                <p>Posted journal entries will appear here.</p>
                <Link to="/admin/business-accounting/journal-entries">View Journal Entries</Link>
              </div>
            )}

            <footer className="gl-pagination">
              <span>Showing {number(pagination.from || 0)} to {number(pagination.to || 0)} of {number(pagination.total || 0)} transactions</span>
              <div>
                <Button variant="outline-secondary" disabled={!pagination.hasPrevious} onClick={() => updateQuery(setSearchParams, { page: Number(filters.page || 1) - 1 })}>
                  <BsChevronLeft />
                </Button>
                <strong>{pagination.page || 1}</strong>
                <Button variant="outline-secondary" disabled={!pagination.hasNext} onClick={() => updateQuery(setSearchParams, { page: Number(filters.page || 1) + 1 })}>
                  <BsChevronRight />
                </Button>
                <Form.Select value={filters.limit} onChange={(event) => updateQuery(setSearchParams, { limit: event.target.value, page: 1 })} aria-label="Rows per page">
                  {LIMITS.map((limit) => <option key={limit} value={limit}>{limit} / page</option>)}
                </Form.Select>
                <Button variant="outline-secondary" onClick={() => load({ silent: true })} disabled={refreshing}>
                  {refreshing ? <Spinner size="sm" /> : <BsArrowClockwise />}
                </Button>
              </div>
            </footer>
          </section>
        </>
      ) : null}
    </div>
  );
};

export default AdminGeneralLedgerRegisterPage;
