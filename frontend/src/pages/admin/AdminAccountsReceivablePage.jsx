import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Form, Spinner } from "react-bootstrap";
import { BsArrowClockwise, BsCalendar3, BsCashCoin, BsCheck2Circle, BsDownload, BsExclamationTriangle, BsFileEarmarkText, BsFilter, BsPlusLg, BsSearch, BsWallet2 } from "react-icons/bs";
import { Link, useSearchParams } from "react-router-dom";
import { fetchAccountsReceivableDashboard } from "../../api/adminApi";
import ErrorAlert from "../../components/common/ErrorAlert";
import { formatCurrency } from "../../utils/formatters";

const TABS = [["all", "All Invoices"], ["outstanding", "Outstanding"], ["overdue", "Overdue"], ["paid", "Paid"], ["draft", "Drafts"]];
const LIMITS = [10, 25, 50, 100];
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => { const value = new Date(); return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1)).toISOString().slice(0, 10); };
const labelize = (value = "") => String(value || "").toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
const money = (value, currency) => value === null || value === undefined ? "Separated by currency" : formatCurrency(Number(value || 0), currency || "USD");
const date = (value) => value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : "Not set";
const updateQuery = (setter, updates) => setter((current) => { const next = new URLSearchParams(current); Object.entries(updates).forEach(([key, value]) => value === "" ? next.delete(key) : next.set(key, String(value))); return next; });
const Kpi = ({ icon: Icon, label, value, detail, tone }) => <article className={`ap-kpi ${tone}`}><span><Icon /></span><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div></article>;

const AgingChart = ({ values, currency }) => {
  if (!values) return <div className="ap-empty compact">Select one currency to view receivables aging.</div>;
  const rows = [["Current", values.current], ["31-60 days", values.days31to60], ["61-90 days", values.days61to90], ["91+ days", values.days91plus]];
  const max = Math.max(1, ...rows.map(([, value]) => Number(value || 0)));
  return <div className="ap-aging-chart" aria-label="Aging of receivables"><div className="ap-chart-bars">{rows.map(([label, value]) => <div key={label}><strong>{money(value, currency)}</strong><i style={{ height: `${Math.max(4, Number(value || 0) / max * 100)}%` }} /><span>{label}</span></div>)}</div></div>;
};

const CustomerChart = ({ rows = [], currency }) => {
  const total = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  if (!rows.length) return <div className="ap-empty compact">No comparable customer balances for this period.</div>;
  return <div className="ap-supplier-chart"><div className="ap-donut" aria-label="Receivables by customer"><strong>{money(total, currency)}</strong><small>Outstanding</small></div><div className="ap-supplier-legend">{rows.map((row, index) => <div key={row.name}><i className={`c${index + 1}`} /><span>{row.name}</span><strong>{total ? `${(Number(row.amount) / total * 100).toFixed(1)}%` : "0%"}</strong></div>)}</div></div>;
};

const AdminAccountsReceivablePage = () => {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState(params.get("search") || "");
  const filters = useMemo(() => ({ fromDate: params.get("fromDate") || monthStart(), toDate: params.get("toDate") || today(), search: params.get("search") || "", customer: params.get("customer") || "", status: params.get("status") || "all", currency: params.get("currency") || "", dueFrom: params.get("dueFrom") || "", dueTo: params.get("dueTo") || "", sortBy: params.get("sortBy") || "issueDate", sortOrder: params.get("sortOrder") || "desc", page: params.get("page") || "1", limit: params.get("limit") || "10" }), [params]);
  const load = useCallback(async (silent = false) => { silent ? setRefreshing(true) : setLoading(true); setError(""); try { setData(await fetchAccountsReceivableDashboard(filters)); } catch (err) { setError(err.message || "Unable to load Accounts Receivable."); } finally { setLoading(false); setRefreshing(false); } }, [filters]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const timer = setTimeout(() => { if (search !== filters.search) updateQuery(setParams, { search, page: 1 }); }, 400); return () => clearTimeout(timer); }, [search, filters.search, setParams]);
  const summary = data?.summary || {};
  const pagination = data?.pagination || {};
  const currency = summary.reportingCurrency || summary.currencies?.[0]?.currency || "USD";
  const tabs = data?.tabCounts || {};
  const reset = () => { setSearch(""); setParams({ fromDate: monthStart(), toDate: today(), status: "all", page: "1", limit: filters.limit }); };
  const exportCsv = () => {
    const rows = data?.items || [];
    const csv = [["Date", "Invoice", "Customer", "Booking Reference", "Description", "Due Date", "Amount", "Paid", "Refunded", "Balance", "Currency", "Status"], ...rows.map((row) => [row.issueDate, row.invoiceNumber, row.customer?.name, row.bookingReference, row.description, row.dueDate, row.amount, row.paidAmount, row.refundedAmount, row.outstandingAmount, row.reportingCurrency, row.displayStatus])].map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "accounts-receivable.csv"; anchor.click(); URL.revokeObjectURL(url);
  };

  return <main className="accounts-receivable-page">
    <header className="ap-header"><div><nav>Business Accounting / <strong>Receivables (AR)</strong></nav><h1>Accounts Receivable (AR)</h1><p>Manage customer invoices, payments, and outstanding balances.</p></div><div className="ap-header-actions"><label><BsCalendar3 /><input type="date" value={filters.fromDate} onChange={(event) => updateQuery(setParams, { fromDate: event.target.value, page: 1 })} /><span>-</span><input type="date" value={filters.toDate} onChange={(event) => updateQuery(setParams, { toDate: event.target.value, page: 1 })} /></label><Button variant="outline-primary" onClick={exportCsv}><BsDownload /> Export CSV</Button><Button variant="outline-secondary" onClick={() => load(true)} disabled={refreshing}>{refreshing ? <Spinner size="sm" /> : <BsArrowClockwise />} Refresh</Button><Button disabled title={data?.capabilities?.createStandaloneInvoiceReason || "Standalone invoicing is unavailable"}><BsPlusLg /> New Invoice</Button></div></header>
    <ErrorAlert error={error} />
    {loading ? <div className="ap-skeleton">{Array.from({ length: 8 }).map((_, index) => <span key={index} />)}</div> : <>
      <section className="ap-kpis"><Kpi icon={BsFileEarmarkText} label="Total Customer Invoices" value={summary.invoiceCount || 0} detail="Authoritative invoices in selected period" tone="blue" /><Kpi icon={BsWallet2} label={`Total Amount${currency ? ` (${currency})` : ""}`} value={money(summary.totalAmount, currency)} detail={summary.mixedCurrencies ? "Separated by reporting currency" : "Invoice accounting amount"} tone="green" /><Kpi icon={BsExclamationTriangle} label={`Outstanding${currency ? ` (${currency})` : ""}`} value={money(summary.outstanding, currency)} detail="Canonical invoice balance due" tone="red" /><Kpi icon={BsCheck2Circle} label="Collected This Month" value={money(summary.collectedThisMonth, currency)} detail="Verified and allocated payments only" tone="green" /></section>
      {summary.mixedCurrencies ? <section className="ap-currency-strip">{summary.currencies.map((row) => <span key={row.currency}><strong>{row.currency}</strong> Invoiced {money(row.amount, row.currency)} · Outstanding {money(row.outstanding, row.currency)}</span>)}</section> : null}
      <section className="ap-analytics"><article className="ap-panel"><h2>Aging of Receivables</h2><AgingChart values={data?.aging} currency={currency} /></article><article className="ap-panel"><h2>Receivables by Customer</h2><CustomerChart rows={data?.customers} currency={currency} /></article><article className="ap-panel ap-account-summary"><h2>Account Summary</h2><dl><div><dt>AR Subledger</dt><dd>{money(data?.reconciliation?.subledgerBalance, currency)}</dd></div><div><dt>General Ledger AR</dt><dd>{money(data?.reconciliation?.generalLedgerBalance, currency)}</dd></div><div><dt>Difference</dt><dd>{money(data?.reconciliation?.difference, currency)}</dd></div><div><dt>Active Customers</dt><dd>{summary.activeCustomers || 0}</dd></div></dl><span className={data?.reconciliation?.status === "RECONCILED" ? "ok" : "review"}>{labelize(data?.reconciliation?.status || "unavailable")}</span></article></section>
      {data?.dataQuality?.length ? <div className="ap-quality"><BsExclamationTriangle /><div><strong>AR data needs attention</strong>{data.dataQuality.slice(0, 3).map((issue) => <p key={`${issue.code}-${issue.reference || "global"}`}>{issue.reference ? `${issue.reference}: ` : ""}{issue.message}</p>)}</div></div> : null}
      <section className="ap-register"><div className="ap-tabs">{TABS.map(([key, label]) => <button key={key} className={filters.status === key ? "active" : ""} onClick={() => updateQuery(setParams, { status: key, page: 1 })}>{label} ({tabs[key === "draft" ? "drafts" : key] || 0})</button>)}</div>
        <div className="ap-filters"><label><BsSearch /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by customer, invoice number, reference..." /></label><Form.Select value={filters.customer} onChange={(event) => updateQuery(setParams, { customer: event.target.value, page: 1 })} aria-label="Customer"><option value="">All Customers</option>{(data?.filterOptions?.customers || []).map((name) => <option key={name} value={name}>{name}</option>)}</Form.Select><Form.Select value={filters.currency} onChange={(event) => updateQuery(setParams, { currency: event.target.value, page: 1 })}><option value="">All Currencies</option><option>TZS</option><option>USD</option></Form.Select><Form.Select value={`${filters.sortBy}:${filters.sortOrder}`} onChange={(event) => { const [sortBy, sortOrder] = event.target.value.split(":"); updateQuery(setParams, { sortBy, sortOrder, page: 1 }); }} aria-label="Sort invoices"><option value="issueDate:desc">Newest invoices</option><option value="dueDate:asc">Due date</option><option value="customer:asc">Customer</option><option value="amount:desc">Highest amount</option><option value="balance:desc">Highest balance</option></Form.Select><Button variant="outline-secondary" disabled title="Due-date range and advanced lifecycle filters are not available in the compact toolbar"><BsFilter /> More Filters</Button><Button variant="outline-secondary" onClick={reset}><BsArrowClockwise /> Reset</Button></div>
        {data?.items?.length ? <><div className="ap-table-wrap"><table><thead><tr><th>Date</th><th>Invoice #</th><th>Customer</th><th>Reference</th><th>Description</th><th>Due Date</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead><tbody>{data.items.map((row) => <tr key={row.id || row.invoiceNumber}><td>{date(row.issueDate)}</td><td><Link to={`/invoice/${encodeURIComponent(row.bookingReference)}`}><strong>{row.invoiceNumber}</strong></Link></td><td>{row.customer?.name}</td><td>{row.bookingReference || "-"}</td><td>{row.description}</td><td className={row.overdue ? "overdue-date" : ""}>{date(row.dueDate)}{row.overdue ? <small>Overdue</small> : null}</td><td className="num">{money(row.amount, row.reportingCurrency)}</td><td className="num">{money(row.paidAmount, row.reportingCurrency)}</td><td className="num">{money(row.outstandingAmount, row.reportingCurrency)}</td><td><span className={`ap-status ${row.displayStatus}`}>{labelize(row.displayStatus)}</span></td><td><Link to={`/admin/business-accounting/general-ledger?accountCode=1100&search=${encodeURIComponent(row.invoiceNumber)}&view=account`}>Ledger</Link></td></tr>)}</tbody></table></div>
          <div className="ap-mobile-list">{data.items.map((row) => <article key={row.id || row.invoiceNumber}><div><strong>{row.customer?.name}</strong><span className={`ap-status ${row.displayStatus}`}>{labelize(row.displayStatus)}</span></div><h3>{row.invoiceNumber}</h3><p>{row.description}</p><dl><div><dt>Reference</dt><dd>{row.bookingReference || "-"}</dd></div><div><dt>Invoice Date</dt><dd>{date(row.issueDate)}</dd></div><div><dt>Due</dt><dd>{date(row.dueDate)}{row.overdue ? " · Overdue" : ""}</dd></div><div><dt>Amount</dt><dd>{money(row.amount, row.reportingCurrency)}</dd></div><div><dt>Paid</dt><dd>{money(row.paidAmount, row.reportingCurrency)}</dd></div><div><dt>Outstanding</dt><dd>{money(row.outstandingAmount, row.reportingCurrency)}</dd></div></dl><Link to={`/invoice/${encodeURIComponent(row.bookingReference)}`}>View Invoice</Link></article>)}</div></> : <div className="ap-empty"><BsCashCoin /><strong>No customer invoices found.</strong><p>{filters.search || filters.status !== "all" ? "No invoices match the selected filters." : "Booking Accounting will create receivables when invoice evidence is available."}</p>{filters.search || filters.status !== "all" ? <Button onClick={reset}>Reset Filters</Button> : null}</div>}
        <footer className="ap-pagination"><span>Showing {pagination.from || 0}-{pagination.to || 0} of {pagination.total || 0} invoices</span><div><Button variant="outline-secondary" disabled={!pagination.hasPrevious} onClick={() => updateQuery(setParams, { page: Number(filters.page) - 1 })}>Previous</Button><strong>{pagination.page || 1}</strong><Button variant="outline-secondary" disabled={!pagination.hasNext} onClick={() => updateQuery(setParams, { page: Number(filters.page) + 1 })}>Next</Button><Form.Select value={filters.limit} onChange={(event) => updateQuery(setParams, { limit: event.target.value, page: 1 })}>{LIMITS.map((size) => <option key={size} value={size}>{size} / page</option>)}</Form.Select></div></footer>
      </section>
    </>}
  </main>;
};

export default AdminAccountsReceivablePage;
