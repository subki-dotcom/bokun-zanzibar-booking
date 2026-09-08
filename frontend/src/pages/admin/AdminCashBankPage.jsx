import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Form, Spinner } from "react-bootstrap";
import {
  BsArrowClockwise,
  BsArrowDownLeft,
  BsArrowLeftRight,
  BsArrowUpRight,
  BsBank,
  BsCalendar3,
  BsCashStack,
  BsDownload,
  BsExclamationTriangle,
  BsFilter,
  BsPlusLg,
  BsSearch,
  BsWallet2
} from "react-icons/bs";
import { Link, useSearchParams } from "react-router-dom";
import { fetchCashBankDashboard } from "../../api/adminApi";
import ErrorAlert from "../../components/common/ErrorAlert";
import { formatCurrency } from "../../utils/formatters";

const LIMITS = [10, 25, 50, 100];
const TABS = [["all", "All Transactions"], ["inflow", "Inflows"], ["outflow", "Outflows"], ["transfer", "Transfers"]];
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => {
  const value = new Date();
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1)).toISOString().slice(0, 10);
};
const labelize = (value = "") => String(value || "").toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
const money = (value, currency) => value === null || value === undefined ? "Separated by currency" : formatCurrency(Number(value || 0), currency || "USD");
const date = (value) => value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : "Not set";
const updateQuery = (setter, updates) => setter((current) => {
  const next = new URLSearchParams(current);
  Object.entries(updates).forEach(([key, value]) => value === "" ? next.delete(key) : next.set(key, String(value)));
  return next;
});

const Kpi = ({ icon: Icon, label, value, detail, tone }) => (
  <article className={`cb-kpi ${tone}`}>
    <span><Icon /></span>
    <div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div>
  </article>
);

const FlowChart = ({ rows = [], currency = "" }) => {
  const visible = currency ? rows.filter((row) => row.currency === currency) : rows;
  if (!visible.length) return <div className="cb-empty compact">No cash movement is available for this period.</div>;
  const max = Math.max(1, ...visible.flatMap((row) => [Number(row.inflow || 0), Number(row.outflow || 0)]));
  return <div className="cb-flow-chart" aria-label={`Cash inflow and outflow trend${currency ? ` in ${currency}` : ""}`}>
    <div className="cb-chart-legend"><span className="in">Inflows</span><span className="out">Outflows</span></div>
    <div className="cb-chart-bars">{visible.slice(-8).map((row) => <div key={`${row.currency}-${row.bucket}`}>
      <span className="bars"><i className="in" style={{ height: `${Math.max(3, Number(row.inflow || 0) / max * 100)}%` }} /><i className="out" style={{ height: `${Math.max(3, Number(row.outflow || 0) / max * 100)}%` }} /></span>
      <small>{row.bucket.slice(5)}</small>
    </div>)}</div>
  </div>;
};

const MovementIcon = ({ row }) => row.isInternalTransfer ? <BsArrowLeftRight /> : row.direction === "inflow" ? <BsArrowDownLeft /> : <BsArrowUpRight />;

const AdminCashBankPage = () => {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState(params.get("search") || "");
  const filters = useMemo(() => ({
    fromDate: params.get("fromDate") || monthStart(),
    toDate: params.get("toDate") || today(),
    search: params.get("search") || "",
    accountCode: params.get("accountCode") || "",
    direction: params.get("direction") || "all",
    postingType: params.get("postingType") || "",
    currency: params.get("currency") || "",
    page: params.get("page") || "1",
    limit: params.get("limit") || "10"
  }), [params]);
  const load = useCallback(async (silent = false) => {
    silent ? setRefreshing(true) : setLoading(true);
    setError("");
    try { setData(await fetchCashBankDashboard(filters)); }
    catch (err) { setError(err.message || "Unable to load Cash & Bank."); }
    finally { setLoading(false); setRefreshing(false); }
  }, [filters]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== filters.search) updateQuery(setParams, { search, page: 1 });
    }, 400);
    return () => clearTimeout(timer);
  }, [search, filters.search, setParams]);

  const summary = data?.summary || {};
  const pagination = data?.pagination || {};
  const currency = filters.currency || summary.reportingCurrency || summary.movementTotals?.[0]?.currency || summary.balanceTotals?.[0]?.currency || "";
  const tabs = data?.tabCounts || {};
  const reset = () => {
    setSearch("");
    setParams({ fromDate: monthStart(), toDate: today(), direction: "all", page: "1", limit: filters.limit });
  };
  const exportCsv = () => {
    const rows = data?.items || [];
    const csv = [["Date", "Reference", "Description", "Account", "Type", "Inflow", "Outflow", "Currency", "Running Balance", "Reconciliation"], ...rows.map((row) => [row.postingDate, row.sourceReference || row.entryNumber, row.description, `${row.accountCode} ${row.accountName}`, row.typeLabel, row.inflow, row.outflow, row.baseCurrency, row.balanceAfterTransaction, row.reconciliationStatus])]
      .map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "cash-bank-transactions.csv"; anchor.click(); URL.revokeObjectURL(url);
  };

  return <main className="cash-bank-page">
    <header className="cb-header">
      <div><nav>Business Accounting / <strong>Cash &amp; Bank</strong></nav><h1>Cash &amp; Bank</h1><p>View ledger-backed cash accounts, movements, transfers, and reconciliation readiness.</p></div>
      <div className="cb-header-actions">
        <label><BsCalendar3 /><input type="date" value={filters.fromDate} onChange={(event) => updateQuery(setParams, { fromDate: event.target.value, page: 1 })} /><span>-</span><input type="date" value={filters.toDate} onChange={(event) => updateQuery(setParams, { toDate: event.target.value, page: 1 })} /></label>
        <Button variant="outline-primary" onClick={exportCsv} disabled={!data?.items?.length}><BsDownload /> Export CSV</Button>
        <Button variant="outline-secondary" onClick={() => load(true)} disabled={refreshing}>{refreshing ? <Spinner size="sm" /> : <BsArrowClockwise />} Refresh</Button>
        <Button disabled title={data?.capabilities?.createTransactionReason || "Use the approved source workflow"}><BsPlusLg /> New Transaction</Button>
      </div>
    </header>
    <ErrorAlert error={error} />
    {loading ? <div className="cb-skeleton">{Array.from({ length: 8 }).map((_, index) => <span key={index} />)}</div> : <>
      <section className="cb-kpis">
        <Kpi icon={BsWallet2} label="Total Cash & Bank Balance" value={money(summary.totalBalance, summary.reportingCurrency)} detail={summary.mixedCurrencies ? "Currencies shown separately below" : "Posted ledger balance as of selected date"} tone="blue" />
        <Kpi icon={BsArrowDownLeft} label="External Inflows" value={money(summary.inflow, summary.reportingCurrency)} detail="Excludes internal transfers" tone="green" />
        <Kpi icon={BsArrowUpRight} label="External Outflows" value={money(summary.outflow, summary.reportingCurrency)} detail="Excludes internal transfers" tone="red" />
        <Kpi icon={BsBank} label="Active Cash Accounts" value={summary.activeAccounts || 0} detail={`${summary.bankAccounts || 0} bank / ${summary.cashAccounts || 0} cash / ${summary.clearingAccounts || 0} clearing`} tone="purple" />
      </section>

      {summary.mixedCurrencies ? <section className="cb-currency-strip">{summary.balanceTotals?.map((row) => <span key={row.currency}><strong>{row.currency}</strong> Balance {money(row.amount, row.currency)}</span>)}{summary.movementTotals?.map((row) => <span key={`flow-${row.currency}`}><strong>{row.currency}</strong> In {money(row.inflow, row.currency)} / Out {money(row.outflow, row.currency)}</span>)}</section> : null}

      <section className="cb-overview">
        <article className="cb-panel cb-accounts"><div className="cb-panel-title"><h2>Account Balances</h2><small>From posted journal lines</small></div>{data?.accounts?.length ? <div className="cb-account-list">{data.accounts.map((account) => <button key={account.code} className={filters.accountCode === account.code ? "active" : ""} onClick={() => updateQuery(setParams, { accountCode: filters.accountCode === account.code ? "" : account.code, currency: account.currency || "", page: 1 })}><span className={account.subtype === "CASH" ? "cash" : account.subtype === "PROVIDER_CLEARING" ? "gateway" : "bank"}>{account.subtype === "CASH" ? <BsCashStack /> : <BsBank />}</span><div><strong>{account.name}</strong><small>{account.code} · {account.typeLabel}</small></div><b>{account.balance === null ? "Currency review" : money(account.balance, account.currency)}</b></button>)}</div> : <div className="cb-empty compact">No active cash or bank accounts exist in the Chart of Accounts.</div>}</article>
        <article className="cb-panel"><div className="cb-panel-title"><h2>Cash Flow</h2><small>{currency || "Select a currency"}</small></div><FlowChart rows={data?.trend} currency={currency} /><div className="cb-flow-totals"><span>Inflows <strong>{money(summary.inflow, summary.reportingCurrency)}</strong></span><span>Outflows <strong>{money(summary.outflow, summary.reportingCurrency)}</strong></span><span>Net <strong>{money(summary.netCashFlow, summary.reportingCurrency)}</strong></span></div></article>
        <article className="cb-panel cb-recent"><div className="cb-panel-title"><h2>Recent Transactions</h2><button onClick={() => document.getElementById("cash-bank-register")?.scrollIntoView({ behavior: "smooth" })}>View all</button></div>{data?.recentTransactions?.length ? data.recentTransactions.map((row) => <div className={`cb-recent-row ${row.direction}`} key={row.id}><span><MovementIcon row={row} /></span><div><strong>{row.description || row.typeLabel}</strong><small>{row.sourceReference || row.entryNumber} · {row.accountName}</small></div><b>{row.direction === "outflow" ? "-" : row.direction === "inflow" ? "+" : ""}{money(row.amount, row.baseCurrency)}</b></div>) : <div className="cb-empty compact">No recent cash transactions.</div>}</article>
      </section>

      <section className="cb-reconciliation"><BsExclamationTriangle /><div><strong>Statement reconciliation is not available yet</strong><p>{data?.reconciliation?.reason}</p></div><Button variant="outline-secondary" disabled title="A stored bank or provider statement balance is required">Reconcile</Button></section>

      <section className="cb-register" id="cash-bank-register">
        <div className="cb-tabs">{TABS.map(([key, label]) => <button key={key} className={filters.direction === key ? "active" : ""} onClick={() => updateQuery(setParams, { direction: key, page: 1 })}>{label} ({tabs[key === "inflow" ? "inflows" : key === "outflow" ? "outflows" : key === "transfer" ? "transfers" : "all"] || 0})</button>)}</div>
        <div className="cb-filters"><label><BsSearch /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reference, account, or description..." /></label><Form.Select value={filters.accountCode} onChange={(event) => updateQuery(setParams, { accountCode: event.target.value, page: 1 })}><option value="">All Accounts</option>{data?.filterOptions?.accounts?.map((account) => <option key={account.code} value={account.code}>{account.code} - {account.name}</option>)}</Form.Select><Form.Select value={filters.postingType} onChange={(event) => updateQuery(setParams, { postingType: event.target.value, page: 1 })}><option value="">All Types</option>{data?.filterOptions?.postingTypes?.map((type) => <option key={type} value={type}>{labelize(type)}</option>)}</Form.Select><Form.Select value={filters.currency} onChange={(event) => updateQuery(setParams, { currency: event.target.value, page: 1 })}><option value="">All Currencies</option>{Array.from(new Set([...(summary.balanceTotals || []), ...(summary.movementTotals || [])].map((row) => row.currency))).map((code) => <option key={code} value={code}>{code}</option>)}</Form.Select><Button variant="outline-secondary" disabled title="All persisted transaction filters are already shown"><BsFilter /> More Filters</Button><Button variant="outline-secondary" onClick={reset}><BsArrowClockwise /> Reset</Button></div>
        {data?.items?.length ? <><div className="cb-table-wrap"><table><thead><tr><th>Date</th><th>Reference</th><th>Description</th><th>Account</th><th>Type</th><th>Inflow</th><th>Outflow</th><th>Balance</th><th>Reconciliation</th><th>Action</th></tr></thead><tbody>{data.items.map((row) => <tr key={row.id}><td>{date(row.postingDate)}</td><td><strong>{row.sourceReference || row.entryNumber}</strong></td><td>{row.description || "-"}</td><td>{row.accountCode} {row.accountName}</td><td><span className={`cb-type ${row.direction}`}>{row.typeLabel}</span></td><td className="num in">{Number(row.inflow) ? money(row.inflow, row.baseCurrency) : "-"}</td><td className="num out">{Number(row.outflow) ? money(row.outflow, row.baseCurrency) : "-"}</td><td className="num">{row.balanceAfterTransaction === null ? "Account view only" : money(row.balanceAfterTransaction, row.baseCurrency)}</td><td><span className="cb-status">Unreconciled</span></td><td><Link to={`/admin/business-accounting/general-ledger?accountCode=${encodeURIComponent(row.accountCode)}&search=${encodeURIComponent(row.sourceReference || row.entryNumber)}&view=account`}>Ledger</Link></td></tr>)}</tbody></table></div><div className="cb-mobile-list">{data.items.map((row) => <article key={row.id}><div><span className={`cb-movement ${row.direction}`}><MovementIcon row={row} /></span><div><strong>{row.description || row.typeLabel}</strong><small>{row.sourceReference || row.entryNumber} · {date(row.postingDate)}</small></div><b>{row.direction === "outflow" ? "-" : row.direction === "inflow" ? "+" : ""}{money(row.amount, row.baseCurrency)}</b></div><dl><div><dt>Account</dt><dd>{row.accountCode} {row.accountName}</dd></div><div><dt>Type</dt><dd>{row.typeLabel}</dd></div><div><dt>Balance</dt><dd>{row.balanceAfterTransaction === null ? "Filter one account" : money(row.balanceAfterTransaction, row.baseCurrency)}</dd></div></dl><Link to={`/admin/business-accounting/general-ledger?accountCode=${encodeURIComponent(row.accountCode)}&search=${encodeURIComponent(row.sourceReference || row.entryNumber)}&view=account`}>View Ledger</Link></article>)}</div></> : <div className="cb-empty"><BsWallet2 /><strong>No cash transactions found.</strong><p>{filters.search || filters.direction !== "all" || filters.accountCode ? "No posted journal lines match these filters." : "Posted cash and bank movements will appear here."}</p><Button variant="outline-primary" onClick={reset}>Reset Filters</Button></div>}
        <footer className="cb-pagination"><span>Showing {pagination.from || 0}-{pagination.to || 0} of {pagination.total || 0} transactions</span><div><Button variant="outline-secondary" disabled={!pagination.hasPrevious} onClick={() => updateQuery(setParams, { page: Number(filters.page) - 1 })}>Previous</Button><strong>{pagination.page || 1}</strong><Button variant="outline-secondary" disabled={!pagination.hasNext} onClick={() => updateQuery(setParams, { page: Number(filters.page) + 1 })}>Next</Button><Form.Select value={filters.limit} onChange={(event) => updateQuery(setParams, { limit: event.target.value, page: 1 })}>{LIMITS.map((limit) => <option key={limit} value={limit}>{limit} / page</option>)}</Form.Select></div></footer>
      </section>
    </>}
  </main>;
};

export default AdminCashBankPage;
