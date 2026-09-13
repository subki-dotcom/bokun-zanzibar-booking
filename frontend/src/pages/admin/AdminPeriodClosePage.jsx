import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Form, Modal, Spinner } from "react-bootstrap";
import { Link } from "react-router-dom";
import { BsArrowClockwise, BsCalendar3, BsCheckCircleFill, BsChevronRight, BsExclamationTriangleFill, BsFileEarmarkBarGraph, BsJournalText, BsLockFill, BsPlusLg, BsSafe, BsXCircleFill } from "react-icons/bs";
import { closeAccountingPeriod, createAccountingPeriod, fetchAccountingPeriods, fetchPeriodCloseOverview } from "../../api/adminApi";
import { formatCurrency } from "../../utils/formatters";
import "./periodClose.css";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const isoDate = (value) => value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value)) : "—";
const dateTime = (value) => value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";
const periodName = (period = {}) => period.month ? `${MONTHS[period.month - 1]} ${period.year}` : period.label || period.periodKey || "Accounting period";
const statusLabel = (status = "") => ({ SOFT_CLOSED: "Review", READY_TO_CLOSE: "Ready to close", ATTENTION_REQUIRED: "Attention required" }[status] || status.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase()));
const reportUrl = (path, period) => `${path}?fromDate=${encodeURIComponent(period.startDate)}&toDate=${encodeURIComponent(period.endDate)}`;

const StatusBadge = ({ status }) => <span className={`pc-status is-${String(status || "unknown").toLowerCase()}`}>{statusLabel(status || "Unknown")}</span>;

const CheckIcon = ({ status }) => status === "PASS"
  ? <BsCheckCircleFill className="pc-check-pass" aria-label="Passed" />
  : status === "FAIL" ? <BsXCircleFill className="pc-check-fail" aria-label="Failed" /> : <BsExclamationTriangleFill className="pc-check-pending" aria-label="Not verified" />;

const HealthCard = ({ icon: Icon, label, value, detail, tone = "blue", status }) => (
  <article className={`pc-health-card is-${tone}`}>
    <span className="pc-health-icon"><Icon aria-hidden="true" /></span>
    <div><span className="pc-health-label">{label}</span><strong>{value}</strong><small>{detail}</small>{status ? <StatusBadge status={status} /> : null}</div>
  </article>
);

const PeriodSkeleton = () => <div className="pc-skeleton" role="status" aria-label="Loading accounting periods">{Array.from({ length: 5 }, (_, index) => <span key={index} />)}</div>;

const Checklist = ({ checks = [] }) => <div className="pc-check-list">{checks.map((check) => (
  <div className="pc-check" key={check.key}><CheckIcon status={check.status} /><div><strong>{check.label}</strong><small>{check.status === "NOT_VERIFIED" ? "Not verified" : check.count ? `${check.count} item${check.count === 1 ? "" : "s"} require attention` : check.detail || "Verified"}</small></div></div>
))}</div>;

const CloseModal = ({ overview, show, busy, error, onHide, onConfirm }) => {
  const [reason, setReason] = useState("");
  useEffect(() => { if (show) setReason(""); }, [show]);
  const ready = Boolean(overview?.checklist?.readyToClose);
  return <Modal show={show} onHide={busy ? undefined : onHide} centered size="lg" className="pc-modal">
    <Modal.Header closeButton={!busy}><Modal.Title>Close Accounting Period</Modal.Title></Modal.Header>
    <Modal.Body>
      <div className="pc-modal-period"><BsCalendar3 /><div><strong>{periodName(overview?.period)}</strong><span>{isoDate(overview?.period?.startDate)} – {isoDate(overview?.period?.endDate)}</span></div><StatusBadge status={overview?.period?.status} /></div>
      <h3>Pre-Close Checklist</h3><Checklist checks={overview?.checklist?.checks} />
      <div className={`pc-readiness-message ${ready ? "is-ready" : "is-blocked"}`}><strong>{ready ? "Ready to Close" : "Period cannot be closed"}</strong><span>{ready ? "All supported critical checks passed. Checks marked Not verified remain visible for your review." : "Resolve the accounting issues above before closing this period."}</span></div>
      {ready ? <Form.Group className="mt-3"><Form.Label>Closing reason</Form.Label><Form.Control as="textarea" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Confirm why this period is ready to close" /></Form.Group> : null}
      {error ? <div className="pc-inline-error" role="alert">{error}</div> : null}
    </Modal.Body>
    <Modal.Footer><Button variant="outline-secondary" onClick={onHide} disabled={busy}>Cancel</Button><Button variant="primary" onClick={() => onConfirm(reason)} disabled={!ready || reason.trim().length < 2 || busy}>{busy ? <Spinner size="sm" /> : <BsLockFill />} Close Period</Button></Modal.Footer>
  </Modal>;
};

const DetailsModal = ({ overview, onHide }) => {
  const summary = overview?.financialSummary || {};
  const currency = summary.baseCurrency;
  const showMoney = (value) => currency && value != null ? formatCurrency(value, currency) : value == null ? "Unavailable" : value;
  return <Modal show={Boolean(overview)} onHide={onHide} centered size="lg" className="pc-modal"><Modal.Header closeButton><Modal.Title>Period Details</Modal.Title></Modal.Header><Modal.Body>
    <div className="pc-detail-head"><div><span>Period</span><strong>{periodName(overview?.period)}</strong></div><div><span>Status</span><StatusBadge status={overview?.period?.status} /></div><div><span>Dates</span><strong>{isoDate(overview?.period?.startDate)} – {isoDate(overview?.period?.endDate)}</strong></div><div><span>Closed</span><strong>{dateTime(overview?.period?.closedAt)}</strong></div></div>
    <h3>Accounting Summary</h3><div className="pc-summary-grid">{[["Revenue", summary.revenue], ["Expenses", summary.expenses], ["Net profit", summary.netProfit], ["Cash movement", summary.cashMovement], ["Receivables", summary.receivables], ["Payables", summary.payables]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{showMoney(value)}</strong></div>)}</div>
    <h3>Validation Summary</h3><Checklist checks={overview?.checklist?.checks} />
  </Modal.Body></Modal>;
};

const NewPeriodModal = ({ show, busy, error, onHide, onCreate }) => {
  const now = new Date(); const [year, setYear] = useState(now.getUTCFullYear()); const [month, setMonth] = useState(now.getUTCMonth() + 1);
  return <Modal show={show} onHide={busy ? undefined : onHide} centered className="pc-modal"><Form onSubmit={(event) => { event.preventDefault(); onCreate({ year, month }); }}><Modal.Header closeButton={!busy}><Modal.Title>New Accounting Period</Modal.Title></Modal.Header><Modal.Body><div className="pc-new-period"><Form.Group><Form.Label>Month</Form.Label><Form.Select value={month} onChange={(event) => setMonth(Number(event.target.value))}>{MONTHS.map((label, index) => <option value={index + 1} key={label}>{label}</option>)}</Form.Select></Form.Group><Form.Group><Form.Label>Year</Form.Label><Form.Control type="number" min="2000" max="2100" value={year} onChange={(event) => setYear(Number(event.target.value))} /></Form.Group></div>{error ? <div className="pc-inline-error" role="alert">{error}</div> : null}</Modal.Body><Modal.Footer><Button variant="outline-secondary" onClick={onHide}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? <Spinner size="sm" /> : <BsPlusLg />} Create Period</Button></Modal.Footer></Form></Modal>;
};

const AdminPeriodClosePage = () => {
  const [periods, setPeriods] = useState([]); const [selectedId, setSelectedId] = useState(""); const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true); const [overviewLoading, setOverviewLoading] = useState(false); const [error, setError] = useState("");
  const [closeOpen, setCloseOpen] = useState(false); const [details, setDetails] = useState(null); const [newOpen, setNewOpen] = useState(false); const [action, setAction] = useState({ busy: false, error: "" });
  const loadOverview = useCallback(async (id) => { if (!id) return; setOverviewLoading(true); try { setOverview(await fetchPeriodCloseOverview(id)); } catch { setOverview(null); } finally { setOverviewLoading(false); } }, []);
  const load = useCallback(async () => { setLoading(true); setError(""); try { const result = await fetchAccountingPeriods(); const rows = [...(result?.items || [])].sort((a, b) => new Date(b.startDate) - new Date(a.startDate)); setPeriods(rows); const now = Date.now(); const current = rows.find((row) => now >= new Date(row.startDate).getTime() && now <= new Date(row.endDate).getTime()) || rows.find((row) => row.status === "OPEN") || rows[0]; setSelectedId((existing) => existing && rows.some((row) => row._id === existing) ? existing : current?._id || ""); if (current) await loadOverview(current._id); } catch { setError("We couldn't load accounting periods."); } finally { setLoading(false); } }, [loadOverview]);
  useEffect(() => { load(); }, [load]);
  const selected = useMemo(() => periods.find((row) => row._id === selectedId) || overview?.period || periods[0], [periods, selectedId, overview]);
  const selectPeriod = async (id) => { setSelectedId(id); await loadOverview(id); };
  const openDetails = async (period) => { setAction({ busy: true, error: "" }); try { setDetails(await fetchPeriodCloseOverview(period._id)); } catch { setError("We couldn't load period details."); } finally { setAction({ busy: false, error: "" }); } };
  const openClose = async (period) => { await selectPeriod(period._id); setCloseOpen(true); };
  const closePeriod = async (reason) => { setAction({ busy: true, error: "" }); try { await closeAccountingPeriod(selectedId, { reason: reason.trim() }); setCloseOpen(false); await load(); } catch (err) { setAction({ busy: false, error: err?.response?.data?.message || err.message || "Period could not be closed." }); return; } setAction({ busy: false, error: "" }); };
  const createPeriod = async (payload) => { setAction({ busy: true, error: "" }); try { const result = await createAccountingPeriod(payload); setNewOpen(false); await load(); if (result?.period?._id) await selectPeriod(result.period._id); } catch (err) { setAction({ busy: false, error: err?.response?.data?.message || err.message || "Period could not be created." }); return; } setAction({ busy: false, error: "" }); };
  const metrics = overview?.metrics || {}; const checklist = overview?.checklist; const reports = selected ? [{ label: "Trial Balance", path: "/admin/business-accounting/trial-balance" }, { label: "Profit & Loss", path: "/admin/business-accounting/profit-loss" }, { label: "Balance Sheet", path: "/admin/business-accounting/balance-sheet" }, { label: "Cash Flow", path: "/admin/business-accounting/cash-flow" }] : [];
  return <main className="pc-page">
    <header className="pc-header"><div><p>Business Accounting <BsChevronRight /> Period Close</p><h1>Period Close</h1><span>Manage accounting periods, verify financial readiness, and safely close completed reporting periods.</span></div>{selected ? <label className="pc-current"><BsCalendar3 /><span><small>Current Period</small><strong>{isoDate(selected.startDate)} – {isoDate(selected.endDate)}</strong></span><StatusBadge status={selected.status} /><select aria-label="Select accounting period" value={selectedId} onChange={(event) => selectPeriod(event.target.value)}>{periods.map((period) => <option key={period._id} value={period._id}>{periodName(period)}</option>)}</select></label> : null}</header>
    {error ? <div className="pc-error" role="alert"><span>{error}</span><Button size="sm" variant="outline-danger" onClick={load}>Retry</Button></div> : null}
    {loading ? <PeriodSkeleton /> : periods.length === 0 ? <section className="pc-empty"><BsCalendar3 /><h2>No accounting periods found.</h2><p>Create the first period to begin controlled financial closing.</p><Button onClick={() => setNewOpen(true)}><BsPlusLg /> Create First Period</Button></section> : <>
      <section className="pc-health-grid" aria-label="Accounting health metrics"><HealthCard icon={BsSafe} label="Chart of Accounts" value={overviewLoading ? "…" : metrics.chartOfAccounts ?? "—"} detail={metrics.activeAccounts == null ? "Unavailable" : `${metrics.activeAccounts} active accounts`} /><HealthCard icon={BsJournalText} label="Journal Entries" value={overviewLoading ? "…" : metrics.journalEntries ?? "—"} detail="Entries this period" tone="teal" /><HealthCard icon={BsFileEarmarkBarGraph} label="Trial Balance" value={metrics.trialBalance ? metrics.trialBalance.balanced ? "Balanced" : "Out of balance" : "Unavailable"} detail={`Difference: ${metrics.trialBalance?.difference ?? "—"}`} tone={metrics.trialBalance?.balanced ? "amber" : metrics.trialBalance ? "red" : "blue"} status={metrics.trialBalance ? metrics.trialBalance.balanced ? "BALANCED" : "ATTENTION_REQUIRED" : "NOT_VERIFIED"} /><HealthCard icon={BsCheckCircleFill} label="Accounting Health" value={statusLabel(metrics.accountingHealth || "NOT_VERIFIED")} detail={checklist ? `${checklist.blockingIssues} blocking issue${checklist.blockingIssues === 1 ? "" : "s"}` : "Readiness unavailable"} tone={checklist?.readyToClose ? "teal" : "red"} status={metrics.accountingHealth || "NOT_VERIFIED"} /></section>
      <section className="pc-period-card"><div className="pc-section-head"><div><h2><BsCalendar3 /> Accounting Periods</h2><p>View, review, and manage your financial reporting periods.</p></div><div><Button variant="outline-secondary" onClick={load}><BsArrowClockwise /> Refresh</Button><Button onClick={() => { setAction({ busy: false, error: "" }); setNewOpen(true); }}><BsPlusLg /> New Period</Button></div></div>
        <div className="pc-table-wrap"><table><thead><tr><th>Period</th><th>Start date</th><th>End date</th><th>Status</th><th>Closed by</th><th>Closed at</th><th>Reports</th><th>Actions</th></tr></thead><tbody>{periods.map((period) => <tr key={period._id}><td data-label="Period"><strong>{periodName(period)}</strong></td><td data-label="Start date">{isoDate(period.startDate)}</td><td data-label="End date">{isoDate(period.endDate)}</td><td data-label="Status"><StatusBadge status={period.status} /></td><td data-label="Closed by">{period.closedBy || "—"}</td><td data-label="Closed at">{dateTime(period.closedAt)}</td><td data-label="Reports">{["CLOSED", "LOCKED"].includes(period.status) ? <Link to={reportUrl("/admin/business-accounting/trial-balance", period)}><BsFileEarmarkBarGraph /> View Report</Link> : "—"}</td><td data-label="Actions"><div className="pc-row-actions">{period.status === "OPEN" || period.status === "SOFT_CLOSED" ? <Button size="sm" onClick={() => openClose(period)}><BsLockFill /> Close Period</Button> : <Button size="sm" variant="outline-secondary" onClick={() => openDetails(period)}>View Details</Button>}</div></td></tr>)}</tbody></table></div>
      </section>
      {selected ? <section className="pc-report-links" aria-label="Period reports"><strong>Reports for {periodName(selected)}</strong><div>{reports.map((report) => <Link key={report.label} to={reportUrl(report.path, selected)}>{report.label}<BsChevronRight /></Link>)}</div></section> : null}
      <section className="pc-guidance"><article><h2><BsCheckCircleFill /> Before Closing a Period</h2><ul><li>Ensure bookings, payments and refunds are imported and reconciled</li><li>Verify bank and cash transactions</li><li>Check that journal entries are balanced and posted</li><li>Review Trial Balance, Receivables and Payables</li><li>Review Profit & Loss and Balance Sheet</li></ul></article><article className="is-warning"><h2><BsExclamationTriangleFill /> Important</h2><p>Closing an accounting period locks normal financial posting activity for that reporting period. Review all financial information carefully before proceeding.</p><p>Only an authorized administrator may reopen a closed period, and the action is recorded in the audit trail.</p></article></section>
    </>}
    <CloseModal overview={overview} show={closeOpen} busy={action.busy} error={action.error} onHide={() => setCloseOpen(false)} onConfirm={closePeriod} /><DetailsModal overview={details} onHide={() => setDetails(null)} /><NewPeriodModal show={newOpen} busy={action.busy} error={action.error} onHide={() => setNewOpen(false)} onCreate={createPeriod} />
  </main>;
};

export default AdminPeriodClosePage;
