import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Spinner } from "react-bootstrap";
import { BsArrowClockwise, BsBank, BsCalendar3, BsCashCoin, BsDownload, BsPieChartFill } from "react-icons/bs";
import { useSearchParams } from "react-router-dom";
import { exportLedgerBalanceSheet, fetchLedgerBalanceSheet } from "../../api/adminApi";
import { AccountingEquationCard, BalanceSheetSection, BalanceSheetSkeleton, BalanceStatusCard, SummaryCard, balanceIcons, balanceMoney } from "../../components/admin/balanceSheet/BalanceSheetComponents";
import "./balanceSheet.css";

const today = () => new Date().toISOString().slice(0, 10);

const AdminBalanceSheetPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const asOfDate = searchParams.get("asOfDate") || searchParams.get("toDate")?.slice(0, 10) || today();
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false); const [exporting, setExporting] = useState(false); const [error, setError] = useState("");
  const load = useCallback(async ({ silent = false } = {}) => { silent ? setRefreshing(true) : setLoading(true); setError(""); try { setData(await fetchLedgerBalanceSheet({ asOfDate })); } catch { setData(null); setError("Balance Sheet data could not be generated. Please verify the General Ledger and Trial Balance."); } finally { setLoading(false); setRefreshing(false); } }, [asOfDate]);
  useEffect(() => { load(); }, [load]);
  const summary = data?.summary || {}; const totals = data?.totals || {}; const sections = data?.sections || {}; const currency = summary.baseCurrency || "";
  const hasData = useMemo(() => [sections.assets, sections.liabilities, sections.equity].some((rows) => rows?.some((row) => Number(row.amount))), [sections]);
  const canConsolidate = summary.consolidationAvailable !== false && Boolean(currency);
  const changeDate = (value) => { const next = new URLSearchParams(searchParams); next.set("asOfDate", value); next.delete("toDate"); setSearchParams(next); };
  const runExport = async () => { setExporting(true); setError(""); try { const blob = await exportLedgerBalanceSheet({ asOfDate, format: "csv" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `balance-sheet-${asOfDate}.csv`; link.click(); URL.revokeObjectURL(url); } catch { setError("Balance Sheet export could not be generated."); } finally { setExporting(false); } };
  return <main className="bs-page"><header className="bs-header"><div><nav aria-label="Breadcrumb">Business Accounting / <strong>Balance Sheet</strong></nav><h1>Balance Sheet</h1><p>View your company’s financial position at a specific date — what the business owns, owes, and the resulting equity.</p></div><div className="bs-actions"><label><BsCalendar3 /><span><small>As at Date</small><input type="date" value={asOfDate} onChange={(event) => changeDate(event.target.value)} /></span></label><Button variant="outline-secondary" onClick={() => load({ silent: true })} disabled={refreshing}>{refreshing ? <Spinner size="sm" /> : <BsArrowClockwise />} Refresh</Button><Button onClick={runExport} disabled={exporting || !data || !canConsolidate} title={canConsolidate ? "Export Balance Sheet" : "Export requires one established base currency"}>{exporting ? <Spinner size="sm" /> : <BsDownload />} Export</Button></div></header>
    {error ? <div className="bs-error" role="alert"><span>{error}</span><Button size="sm" variant="outline-danger" onClick={() => load()}>Retry</Button></div> : null}
    {loading ? <BalanceSheetSkeleton /> : data ? <><section className="bs-summary-grid" aria-label="Balance Sheet totals"><SummaryCard label="Total Assets" value={balanceMoney(totals.assets, currency)} detail="What the company owns" icon={BsBank} /><SummaryCard label="Total Liabilities" value={balanceMoney(totals.liabilities, currency)} detail="What the company owes" tone="teal" icon={BsCashCoin} /><SummaryCard label="Total Equity" value={balanceMoney(totals.equity, currency)} detail="Owner interest and earnings" tone="amber" icon={BsPieChartFill} /><BalanceStatusCard balanced={data.balanced} difference={totals.difference} currency={currency} hasData={hasData && canConsolidate} /></section><div className="bs-layout"><BalanceSheetSection title="Assets" subtitle="What the company owns" rows={sections.assets} total={totals.assets} currency={currency} icon={balanceIcons.assets} /><div className="bs-right"><BalanceSheetSection title="Liabilities" subtitle="What the company owes" rows={sections.liabilities} total={totals.liabilities} currency={currency} icon={balanceIcons.liabilities} /><BalanceSheetSection title="Equity" subtitle="Owner’s investment and accumulated earnings" rows={sections.equity} total={totals.equity} currency={currency} icon={balanceIcons.equity} /></div></div><AccountingEquationCard currency={currency} mixedCurrencies={summary.mixedBaseCurrencies} /></> : null}
  </main>;
};
export default AdminBalanceSheetPage;
