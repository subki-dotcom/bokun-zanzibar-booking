import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BsArrowClockwise, BsCalendar3, BsCheckCircleFill, BsClock, BsFileEarmarkBarGraph, BsInfoCircle } from 'react-icons/bs';
import { exportReportCenterReport, fetchReportCenterCatalog, fetchReportCenterSummary, fetchReportExportHistory, runReportCenterReport } from '../../api/adminApi';
import useAuth from '../../hooks/useAuth';
import { humanize, periodLabel } from '../../components/admin/bi/biHelpers';
import { ExportHistory, ReportEmpty, ReportError, ReportKpiGrid, ReportNavigator, ReportPreview, ReportSkeleton } from '../../components/admin/reportCenter/ReportCenterComponents';
import { historicalFilters, validDateRange } from '../../components/admin/reportCenter/reportCenterView';
import useReportResource from '../../components/admin/reportCenter/useReportResource';
import './reportCenter.css';

const FORMAT_LABELS = { PDF: 'PDF', EXCEL: 'Excel (.xls)', CSV: 'CSV', PRINT: 'Print / HTML' };
export default function AdminReportCenterPage() {
  const { user } = useAuth();
  const canExport = (user?.permissions || []).includes('report_center.export');
  const [selectedType, setSelectedType] = useState('');
  const [query, setQuery] = useState({ period: 'THIS_MONTH' });
  const [dateChoice, setDateChoice] = useState('THIS_MONTH');
  const [datesOpen, setDatesOpen] = useState(false);
  const [draftDates, setDraftDates] = useState({ from: '', to: '' });
  const [dateError, setDateError] = useState('');
  const [format, setFormat] = useState('PDF');
  const [granularity, setGranularity] = useState('DAY');
  const [historyPage, setHistoryPage] = useState(1);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState(null);
  const generationLock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const catalog = useReportResource(fetchReportCenterCatalog);
  const reports = useMemo(() => (catalog.data?.reports || []).filter((report) => report.availability === 'AVAILABLE'), [catalog.data]);
  const selected = reports.find((report) => report.type === selectedType);
  const hasGrouping = Boolean(selected?.filters?.includes('granularity'));
  const formats = selected?.supportedExports || [];
  const effectiveFormat = formats.includes(format) ? format : formats[0];
  const periods = catalog.data?.filterOptions?.periods || [];
  const groups = catalog.data?.filterOptions?.granularities || [];
  const effectiveGranularity = groups.includes(granularity) ? granularity : selected?.defaultFilters?.granularity;
  useEffect(() => {
    if (!selectedType && reports.length) {
      const first = reports[0];
      setSelectedType(first.type);
      setGranularity(first.defaultFilters?.granularity || 'DAY');
    }
  }, [reports, selectedType]);
  const reportFilters = useMemo(() => ({ ...query, ...(hasGrouping && effectiveGranularity ? { granularity: effectiveGranularity } : {}) }), [query, hasGrouping, effectiveGranularity]);
  const fetchPreview = useCallback((signal) => runReportCenterReport(selectedType, reportFilters, signal), [selectedType, reportFilters]);
  const preview = useReportResource(fetchPreview, Boolean(selected));
  const fetchSummary = useCallback((signal) => fetchReportCenterSummary(query, signal), [query]);
  const summary = useReportResource(fetchSummary);
  const fetchHistory = useCallback((signal) => fetchReportExportHistory({ page: historyPage, limit: historyExpanded ? 10 : 5 }, signal), [historyPage, historyExpanded]);
  const history = useReportResource(fetchHistory);
  const range = preview.data?.period || summary.data?.period;
  const busy = generating;

  const selectReport = (type) => {
    setSelectedType(type);
    setGranularity(reports.find((report) => report.type === type)?.defaultFilters?.granularity || 'DAY');
    setNotice(null);
  };
  const choosePeriod = (period) => {
    setDateChoice(period);
    setDateError('');
    if (['CUSTOM', 'MULTI_YEAR'].includes(period)) setDatesOpen(true);
    else { setQuery({ period }); setDatesOpen(false); }
  };
  const applyDates = (event) => {
    event.preventDefault();
    if (!validDateRange(draftDates.from, draftDates.to)) { setDateError('Enter valid dates, with the end on or after the start.'); return; }
    const period = dateChoice === 'MULTI_YEAR' ? 'MULTI_YEAR' : 'CUSTOM';
    setDateChoice(period);
    setQuery({ period, ...draftDates });
    setDateError('');
    setDatesOpen(false);
  };
  const generate = async (historicItem = null) => {
    if (generationLock.current || !canExport) return;
    const type = historicItem?.reportType || selectedType;
    const definition = reports.find((report) => report.type === type);
    const chosenFormat = historicItem?.format || effectiveFormat;
    const filters = historicItem ? historicalFilters(historicItem) : reportFilters;
    if (!definition || !filters || !definition.supportedExports?.includes(chosenFormat)) {
      setNotice({ kind: 'error', text: 'Select a supported report, format and valid reporting period.' });
      return;
    }
    generationLock.current = true;
    setGenerating(true);
    setNotice(null);
    try {
      const { blob, filename } = await exportReportCenterReport(type, { ...filters, format: chosenFormat });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = filename;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      if (mounted.current) setNotice({ kind: 'success', text: `${definition.title} generated. Your ${FORMAT_LABELS[chosenFormat] || chosenFormat} download is ready.` });
    } catch (error) {
      if (mounted.current) setNotice({ kind: 'error', text: error.timeout ? 'Generation timed out. Check export history before trying again; the server may still be processing the report.' : error.message || 'Report generation failed. Please try again.' });
    } finally {
      generationLock.current = false;
      if (mounted.current) {
        setGenerating(false);
        setHistoryPage(1);
        history.retry(); summary.retry();
      }
    }
  };
  const generateDisabled = busy || !selected || !effectiveFormat || !canExport || datesOpen;
  const generateButton = <button type="button" className="rc-button primary" disabled={generateDisabled} onClick={() => generate()}><BsFileEarmarkBarGraph aria-hidden="true" />{busy ? 'Generating…' : 'Generate Report'}</button>;
  const historyPanel = <ExportHistory resource={history} reports={reports} page={historyPage} onPage={setHistoryPage} expanded={historyExpanded} onExpand={() => { setHistoryExpanded((value) => !value); setHistoryPage(1); }} onRegenerate={generate} busy={busy} canExport={canExport} />;

  return <div className="admin-report-center-page rc-page">
    <header className="rc-header"><div><p className="rc-breadcrumb">Reports &amp; Analytics <span>/</span> Report Center</p><div className="rc-title"><span><BsFileEarmarkBarGraph aria-hidden="true" /></span><div><h1>Report Center</h1><p>Generate management reports, analyze KPIs, export history, and access all business insights.</p></div></div></div><div className="rc-header-actions"><button type="button" className="rc-button rc-date-button" aria-expanded={datesOpen} aria-controls="rc-date-range" disabled={busy} onClick={() => setDatesOpen((value) => !value)}><BsCalendar3 aria-hidden="true" />{range?.isBounded ? periodLabel(range) : humanize(query.period)}<span aria-hidden="true">⌄</span></button>{generateButton}</div></header>
    {datesOpen && <form className="rc-date-range rc-card" id="rc-date-range" onSubmit={applyDates}><label>Reporting period<select value={dateChoice} onChange={(event) => choosePeriod(event.target.value)} disabled={busy}>{periods.map((period) => <option key={period} value={period}>{humanize(period)}</option>)}</select></label><label>From<input type="date" required value={draftDates.from} onChange={(event) => setDraftDates((draft) => ({ ...draft, from: event.target.value }))} /></label><label>To<input type="date" required min={draftDates.from || undefined} value={draftDates.to} onChange={(event) => setDraftDates((draft) => ({ ...draft, to: event.target.value }))} /></label><button type="submit" className="rc-button primary" disabled={busy}>Apply dates</button><p>Custom dates are inclusive in Africa/Dar_es_Salaam. Apply to update the preview and generated-report count.</p>{dateError && <p role="alert" className="rc-negative">{dateError}</p>}</form>}
    <ReportKpiGrid resource={summary} />
    {notice && <div className={`rc-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.kind === 'success' ? <BsCheckCircleFill aria-hidden="true" /> : <BsInfoCircle aria-hidden="true" />}<span>{notice.text}</span><button type="button" aria-label="Dismiss notification" onClick={() => setNotice(null)}>×</button></div>}
    {catalog.loading ? <ReportSkeleton /> : catalog.error ? <ReportError state={catalog} title="Unable to load report catalog" /> : !reports.length ? <ReportEmpty>No reports are currently available.</ReportEmpty> : <div className="rc-workspace">
      <ReportNavigator reports={reports} groups={catalog.data.groups || []} selectedType={selectedType} onSelect={selectReport} disabled={busy} />
      <div className="rc-main">
        <section className="rc-card rc-selected" aria-label="Selected report configuration"><div className="rc-selected-header"><span className="rc-report-icon"><BsFileEarmarkBarGraph aria-hidden="true" /></span><div><h2>{selected?.title || 'Select a report'}</h2><p>{selected?.description}</p></div><span className={`rc-ready ${busy ? 'processing' : ''}`}><BsCheckCircleFill aria-hidden="true" />{busy ? 'Generating' : canExport ? 'Ready to Generate' : 'Preview only'}</span></div>
          <div className="rc-info"><BsInfoCircle aria-hidden="true" /><p>{selected?.periodProfile?.primaryQuestion || selected?.description || 'Select a report to explore its available metrics.'}</p></div>
          <div className="rc-filters"><label>Date Range<select aria-label="Report date range" value={dateChoice} onChange={(event) => choosePeriod(event.target.value)} disabled={busy}>{periods.map((period) => <option key={period} value={period}>{humanize(period)}</option>)}</select></label><label>Format<select value={effectiveFormat || ''} aria-label="Report format" onChange={(event) => setFormat(event.target.value)} disabled={busy || !formats.length}>{formats.map((item) => <option key={item} value={item}>{FORMAT_LABELS[item] || item}</option>)}</select></label><label>Group By<select value={hasGrouping ? effectiveGranularity || '' : ''} aria-label="Group report by" disabled={busy || !hasGrouping} onChange={(event) => setGranularity(event.target.value)}>{hasGrouping ? groups.map((value) => <option key={value} value={value}>{humanize(value)}</option>) : <option value="">Report default</option>}</select></label>{generateButton}<button type="button" className="rc-button" disabled title="Report scheduling is not supported by the current backend"><BsClock aria-hidden="true" />Schedule</button></div>
          <div className="rc-toolbar-note"><span>{!canExport ? 'Your account can preview reports but does not have export permission.' : 'Scheduling is not available. Generate a report to download it now.'}</span><button type="button" className="rc-link-button" onClick={preview.retry} disabled={busy || preview.loading || !selected}><BsArrowClockwise aria-hidden="true" />Refresh preview</button></div>
        </section>
        <ReportPreview state={preview} definition={selected} />
        {historyPanel}
      </div>
    </div>}
    {!catalog.loading && (catalog.error || !reports.length) && historyPanel}
  </div>;
}
