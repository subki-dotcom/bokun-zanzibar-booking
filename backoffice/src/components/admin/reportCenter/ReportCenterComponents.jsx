import { useEffect, useMemo, useState } from 'react';
import { BsArrowClockwise, BsCalendar3, BsCheckCircleFill, BsChevronRight, BsDownload, BsExclamationCircle, BsFileEarmarkBarGraph, BsPeople, BsSearch } from 'react-icons/bs';
import { formatNumber, humanize, dateLabel } from '../bi/biHelpers';
import { StatusBadge } from '../AdminDataWidgets';
import { displayValue, filterReports, getPath, historicalFilters, historyPeriod, inferRows, previewMetrics, reportSections, resolveCell } from './reportCenterView';

export function ReportSkeleton({ compact = false }) {
  return <div className={`rc-skeleton ${compact ? 'compact' : ''}`} role="status" aria-label="Loading report data"><span /><span /><span /></div>;
}
export function ReportEmpty({ children }) {
  return <div className="rc-empty"><BsFileEarmarkBarGraph aria-hidden="true" /><p>{children}</p></div>;
}
export function ReportError({ state, title }) {
  return <div className="rc-error" role="alert"><BsExclamationCircle aria-hidden="true" /><div><strong>{title || 'Unable to load this section'}</strong><p>{state.error}</p></div><button type="button" className="rc-button" onClick={state.retry}><BsArrowClockwise aria-hidden="true" />Retry</button></div>;
}
export function ReportKpiGrid({ resource }) {
  const definitions = [
    ['totalReportsGenerated', 'Total Reports Generated', BsFileEarmarkBarGraph, 'blue'],
    ['scheduledReports', 'Scheduled Reports', BsCalendar3, 'green'],
    ['exportsThisMonth', 'Exports This Month', BsDownload, 'blue'],
    ['activeUsers', 'Active Users', BsPeople, 'purple']
  ];
  return <div className="rc-kpi-grid">{definitions.map(([key, label, Icon, tone]) => {
    const metric = resource.data?.kpis?.[key];
    const comparison = metric?.comparison;
    return <section className={`rc-kpi ${tone}`} key={key} aria-label={label} aria-busy={resource.loading}>
      {resource.loading ? <ReportSkeleton compact /> : resource.error ? <ReportError state={resource} title={label} /> : <><span className="rc-kpi-icon"><Icon aria-hidden="true" /></span><div><h2>{label}</h2><strong>{metric?.supported === false ? '—' : formatNumber(metric?.value)}</strong>{comparison?.comparisonValid && <span className={`rc-change ${comparison.percentageChange < 0 ? 'negative' : ''}`}>{comparison.percentageChange < 0 ? '↓' : '↑'} {formatNumber(Math.abs(comparison.percentageChange), 1)}% <small>vs previous period</small></span>}<p>{metric?.description || (metric?.supported === false ? 'Not supported by the current system' : 'No historical comparison available')}</p></div></>}
    </section>;
  })}</div>;
}

export function ReportNavigator({ reports, groups, selectedType, onSelect, disabled }) {
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [group, setGroup] = useState('');
  useEffect(() => { const timer = setTimeout(() => setTerm(search), 180); return () => clearTimeout(timer); }, [search]);
  const filtered = useMemo(() => filterReports(reports, term, group), [reports, term, group]);
  const availableGroups = groups.filter((item) => reports.some((report) => report.group === item.key));
  return <aside className="rc-navigator" aria-label="Report navigation">
    <details className="rc-mobile-picker"><summary>Choose report <span>{reports.find((report) => report.type === selectedType)?.title || 'Reports'}</span></summary><label>Available reports<select value={selectedType} disabled={disabled} onChange={(event) => onSelect(event.target.value)}>{reports.map((report) => <option value={report.type} key={report.type}>{report.title}</option>)}</select></label></details>
    <div className="rc-report-browser"><h2>Reports <span>{reports.length}</span></h2><label className="rc-search"><BsSearch aria-hidden="true" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reports…" aria-label="Search reports" /></label><label className="rc-group-filter"><span className="visually-hidden">Report group</span><select value={group} onChange={(event) => setGroup(event.target.value)}><option value="">All report groups</option>{availableGroups.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</select></label>
      <nav className="rc-report-list" aria-label="Available report types">{filtered.length ? filtered.map((report) => <button type="button" key={report.type} className={selectedType === report.type ? 'selected' : ''} aria-current={selectedType === report.type ? 'true' : undefined} onClick={() => onSelect(report.type)} disabled={disabled}><BsFileEarmarkBarGraph aria-hidden="true" /><span><strong>{report.title}</strong><small>{report.description}</small></span><BsChevronRight aria-hidden="true" /></button>) : <ReportEmpty>No reports match your search.</ReportEmpty>}</nav>
    </div>
  </aside>;
}

export function ReportPreview({ state, definition }) {
  const [rowPage, setRowPage] = useState(1);
  const result = state.data;
  useEffect(() => setRowPage(1), [result]);
  const metrics = previewMetrics(result);
  const sections = reportSections(result, definition);
  const rows = inferRows(result?.data);
  const columns = definition?.columns?.length ? definition.columns : Object.keys(rows[0] || {}).map((key) => ({ key, label: humanize(key) }));
  const currency = result?.currency || null;
  const warnings = result?.dataQuality?.warnings || [];
  const totalPages = Math.max(1, Math.ceil(rows.length / 10));
  return <section className="rc-card rc-preview" aria-label="Report preview" aria-busy={state.loading}>
    <div className="rc-section-header"><div><h2>Report Preview</h2><p>Summary of the selected report and reporting period.</p></div>{result?.generatedAt && <span className="rc-updated">{dateLabel(result.generatedAt)}</span>}</div>
    {state.loading ? <ReportSkeleton /> : state.error ? <ReportError state={state} title="Unable to load report preview" /> : !result ? <ReportEmpty>Select a report to load its preview.</ReportEmpty> : <>
      {result.currencyNote && <p className="rc-currency-note">{result.currencyNote}</p>}
      {metrics.length ? <dl className="rc-preview-metrics">{metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{displayValue(metric.value, metric.type, currency)}</dd>{metric.comparison?.comparisonValid && <small className={`rc-change ${metric.comparison.percentageChange < 0 ? 'negative' : ''}`}>{metric.comparison.percentageChange < 0 ? '↓' : '↑'} {formatNumber(Math.abs(metric.comparison.percentageChange), 1)}%</small>}</div>)}</dl> : <ReportEmpty>{rows.length ? `${formatNumber(rows.length)} records available in report data below.` : 'No report data for this period.'}</ReportEmpty>}
      {warnings.length > 0 && <details className="rc-quality"><summary><BsExclamationCircle aria-hidden="true" /> Data quality requires attention ({warnings.length})</summary><ul>{warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.message || humanize(warning.code)}{warning.count !== undefined ? ` (${formatNumber(warning.count)})` : ''}</li>)}</ul></details>}
      <div className="rc-report-sections"><h3>Report Sections</h3><p>The selected report includes the following sections.</p>{sections.length ? <ul>{sections.map((section) => <li key={section.key}><BsCheckCircleFill aria-hidden="true" />{section.label}</li>)}</ul> : <p>Fields and included data are listed in the report table below.</p>}</div>
      <details className="rc-data-details"><summary>Report data <span>{formatNumber(rows.length)} rows</span></summary>{rows.length ? <><div className="rc-table-scroll" role="region" aria-label="Report data table" tabIndex={0}><table><thead><tr>{columns.map((column) => <th key={column.key}>{column.label || column.key}</th>)}</tr></thead><tbody>{rows.slice((rowPage - 1) * 10, rowPage * 10).map((row, index) => <tr key={index}>{columns.map((column) => <td key={column.key}>{displayValue(resolveCell(column, row, result.data), column.type, row.currency || row.baseCurrency || currency)}</td>)}</tr>)}</tbody></table></div>{totalPages > 1 && <div className="rc-pagination"><button type="button" disabled={rowPage === 1} onClick={() => setRowPage((page) => page - 1)}>Previous rows</button><span>{rowPage} / {totalPages}</span><button type="button" disabled={rowPage === totalPages} onClick={() => setRowPage((page) => page + 1)}>Next rows</button></div>}</> : <ReportEmpty>No rows returned for this report and period.</ReportEmpty>}</details>
      <details className="rc-source-details"><summary>Report basis & limitations</summary><p>Financial and operational dates follow this report’s existing accounting definitions. Preview and export use the same report service.</p><ul>{[...new Set([...(result.limitations || []), ...(result.data?.limitations || [])])].map((text) => <li key={text}>{text}</li>)}</ul>{getPath(result, 'sourceIntegrity.sourceOfTruth.financial') && <p>Financial source: {result.sourceIntegrity.sourceOfTruth.financial}</p>}</details>
    </>}
  </section>;
}

export function ExportHistory({ resource, reports, page, onPage, expanded, onExpand, onRegenerate, busy, canExport }) {
  const items = resource.data?.items || [];
  const paging = resource.data?.pagination || { page, totalPages: 1, total: items.length };
  const action = (item) => {
    const report = reports.find((entry) => entry.type === item.reportType);
    const supported = canExport && historicalFilters(item) && report?.supportedExports?.includes(item.format);
    return supported ? <button type="button" className="rc-history-action" disabled={busy} onClick={() => onRegenerate(item)} aria-label={`Regenerate ${item.reportTitle || humanize(item.reportType)} from ${dateLabel(item.generatedAt)}`}><BsArrowClockwise aria-hidden="true" />Regenerate</button> : <span className="rc-muted" title="Files are not retained. Original dates and a supported export format are required for regeneration.">Not retained</span>;
  };
  return <section className="rc-card rc-history" aria-label="Export history" aria-busy={resource.loading}><div className="rc-section-header"><div><h2>Export History</h2><p>Recent generated reports.</p></div><div className="rc-history-tools"><button type="button" className="rc-link-button" onClick={resource.retry} disabled={resource.loading} aria-label="Refresh export history"><BsArrowClockwise /></button><button type="button" className="rc-link-button" onClick={onExpand}>{expanded ? 'Show recent' : 'View all'}</button></div></div>
    {resource.loading ? <ReportSkeleton /> : resource.error ? <ReportError state={resource} title="Unable to load export history" /> : !items.length ? <ReportEmpty>No reports have been generated yet. Choose a report and select Generate Report.</ReportEmpty> : <>
      <div className="rc-table-scroll rc-history-table" tabIndex={0} role="region" aria-label="Export history table"><table><thead><tr><th>Date</th><th>Report</th><th>Format</th><th>Period</th><th>Generated by</th><th>Status</th><th>Actions</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{dateLabel(item.generatedAt)}</td><td><strong>{item.reportTitle || humanize(item.reportType)}</strong></td><td>{item.format}</td><td>{historyPeriod(item)}</td><td>{item.generatedByLabel || item.generatedBy || 'Unknown'}</td><td><StatusBadge value={item.status} /></td><td>{action(item)}</td></tr>)}</tbody></table></div>
      <div className="rc-history-cards">{items.map((item) => <article key={item.id}><div><strong>{item.reportTitle || humanize(item.reportType)}</strong><StatusBadge value={item.status} /></div><dl><div><dt>Date</dt><dd>{dateLabel(item.generatedAt)}</dd></div><div><dt>Format</dt><dd>{item.format}</dd></div><div><dt>Period</dt><dd>{historyPeriod(item)}</dd></div><div><dt>Generated by</dt><dd>{item.generatedByLabel || item.generatedBy || 'Unknown'}</dd></div></dl>{action(item)}</article>)}</div>
      {expanded && <div className="rc-pagination"><span>{formatNumber(paging.total)} exports · Page {paging.page} of {Math.max(1, paging.totalPages)}</span><div><button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button><button type="button" disabled={page >= paging.totalPages} onClick={() => onPage(page + 1)}>Next</button></div></div>}
    </>}
    <p className="rc-history-note">Files are delivered when generated and are not archived here. Regenerate uses the original dates with current records.</p>
  </section>;
}
