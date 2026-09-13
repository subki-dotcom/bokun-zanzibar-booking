import BookingPaymentOverview from '../../components/invoice/BookingPaymentOverview';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BsArrowClockwise, BsBarChartLine, BsCashCoin, BsCart3, BsPeople, BsPieChart, BsReceipt, BsLightbulb, BsActivity, BsShieldCheck, BsCalendar3 } from 'react-icons/bs';
import useBISection from '../../components/admin/bi/useBISection';
import { BIBlock, BIKpi, BIMetricList, BITopProducts, BIRecentBookings, BIProductProfitability, BIWarnings, BIEmpty, BISkeleton, BIError } from '../../components/admin/bi/BIComponents';
import { ChannelPerformance, RevenueBookingTrend } from '../../components/admin/bi/BICharts';
import { PERIOD_OPTIONS, dateLabel, formatMoney, formatNumber, formatPercentage, generateInsights, mergeTrend, mergeWarnings, periodLabel } from '../../components/admin/bi/biHelpers';
import './businessIntelligence.css';

export default function AdminBusinessIntelligencePage() {
  const [query, setQuery] = useState({ period: 'THIS_MONTH', from: '', to: '' });
  const [periodChoice, setPeriodChoice] = useState('THIS_MONTH');
  const [draft, setDraft] = useState({ from: '', to: '' });
  const [dateError, setDateError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [showAllProducts, setShowAllProducts] = useState(false);
  const productsRef = useRef(null);
  const financial = useBISection('financial', query, refreshKey);
  const operational = useBISection('operations', query, refreshKey);
  const fin = financial.data, ops = operational.data;
  const currency = fin?.currency || ops?.currency;
  const range = fin?.period || ops?.period;
  const busy = financial.loading || operational.loading;
  const money = (value) => formatMoney(value, currency);
  const summary = fin?.financialSummary || {};
  const customers = ops?.customers || {};
  const operations = ops?.operations || {};
  const trends = useMemo(() => mergeTrend(fin?.trend, ops?.trend), [fin, ops]);
  const warnings = useMemo(() => mergeWarnings(fin?.warnings || [], ops?.warnings || []), [fin, ops]);
  const insights = useMemo(() => generateInsights(fin, ops), [fin, ops]);
  const products = useMemo(() => [...(fin?.products || [])].sort((a, b) => Number(b.revenue) - Number(a.revenue)), [fin]);
  const incompleteCosts = summary.costsIncomplete;
  const provisional = incompleteCosts ? 'Provisional • direct costs incomplete' : '';
  const choosePeriod = (value) => {
    setPeriodChoice(value);
    setDateError('');
    if (value !== 'CUSTOM') setQuery({ period: value, from: '', to: '' });
  };
  const applyRange = (event) => {
    event.preventDefault();
    if (!draft.from || !draft.to || draft.to < draft.from) {
      setDateError('Choose an end date on or after the start date.');
      return;
    }
    setDateError('');
    setQuery({ period: 'CUSTOM', ...draft });
  };
  const viewProducts = () => {
    setShowAllProducts(true);
    productsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    productsRef.current?.focus({ preventScroll: true });
  };

  return <div className="admin-business-intelligence-page bi-dashboard">
    <header className="bi-header">
      <div className="bi-header-copy"><p className="bi-breadcrumb">Reports &amp; Analytics <span>/</span> Business Intelligence</p><div className="bi-title"><span><BsBarChartLine aria-hidden="true" /></span><div><h1>Business Intelligence</h1><p>Executive analytics, sales, product performance, channel insights and financial metrics from the Riser ecosystem.</p></div></div></div>
      <div className="bi-header-actions">
        <button className="bi-date-button" type="button" onClick={() => choosePeriod('CUSTOM')} aria-expanded={periodChoice === 'CUSTOM'} aria-controls="bi-custom-range"><BsCalendar3 aria-hidden="true" />{busy ? 'Loading date range…' : periodLabel(range)}</button>
        <label className="bi-period"><span className="visually-hidden">Reporting period</span><select value={periodChoice} onChange={(event) => choosePeriod(event.target.value)}>{PERIOD_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button type="button" className="bi-refresh" onClick={() => setRefreshKey((value) => value + 1)} disabled={busy}><BsArrowClockwise aria-hidden="true" />{busy ? 'Loading…' : 'Refresh'}</button>
      </div>
    </header>
    {periodChoice === 'CUSTOM' && <form className="bi-custom-range" id="bi-custom-range" onSubmit={applyRange}><label>From<input type="date" required value={draft.from} onChange={(event) => setDraft((value) => ({ ...value, from: event.target.value }))} /></label><label>To<input type="date" required min={draft.from || undefined} value={draft.to} onChange={(event) => setDraft((value) => ({ ...value, to: event.target.value }))} /></label><button type="submit" className="bi-refresh">Apply range</button><span>Dates use {range?.timeZone || 'Africa/Dar_es_Salaam'}. The current report stays selected until you apply.</span>{dateError && <p role="alert">{dateError}</p>}</form>}
    <div className="bi-report-context"><span><i />Read-only executive report</span><span>{currency ? `Reporting currency: ${currency}` : 'Reporting currency loading'} · {range?.timeZone || 'Africa/Dar_es_Salaam'}</span></div>
    <div className="bi-kpi-grid">
      <BIKpi label="Total Revenue" value={money(fin?.kpis?.revenue?.value)} metric={fin?.kpis?.revenue} icon={BsCashCoin} tone="blue" state={financial} values={fin?.trend?.map((row) => row.revenue)} note="Booked revenue + other business income" />
      <BIKpi label="Total Bookings" value={formatNumber(ops?.kpis?.totalBookings?.value)} metric={ops?.kpis?.totalBookings} icon={BsCart3} tone="teal" state={operational} values={ops?.trend?.map((row) => row.bookings)} note="All recorded booking statuses" />
      <BIKpi label="Total Customers" value={formatNumber(ops?.kpis?.totalCustomers?.value)} metric={ops?.kpis?.totalCustomers} icon={BsPeople} tone="rose" state={operational} note="Distinct identified customers in this period" />
      <BIKpi label="Profit Margin" value={formatPercentage(fin?.kpis?.profitMargin?.value)} metric={fin?.kpis?.profitMargin} icon={BsPieChart} tone="purple" state={financial} note={provisional || 'Net profit / total revenue'} />
    </div>
    <BookingPaymentOverview query={query} analytics refreshKey={refreshKey} /><div className="bi-primary-grid">
      <BIBlock title="Revenue & Bookings Trend" className="bi-trend-panel">
        {busy ? <BISkeleton /> : !fin && !ops ? <><BIError title="financial trend" state={financial} /><BIError title="booking trend" state={operational} /></> : <>
          {financial.error && <BIError title="revenue series" state={financial} />}{operational.error && <BIError title="booking series" state={operational} />}
          {trends.length && trends.some((row) => row.revenue !== 0 || row.bookings !== 0) ? <RevenueBookingTrend rows={trends} currency={currency} granularity={fin?.granularity || ops?.granularity} revenueAvailable={Boolean(fin)} bookingsAvailable={Boolean(ops)} /> : <BIEmpty message="No revenue or booking activity for this period." />}
        </>}
        <p className="bi-footnote">Revenue uses accounting transaction dates; bookings use booking creation dates. Each series has its own axis.</p>
      </BIBlock>
      <BIBlock title="Channel Performance" state={financial} note="Source-linked booking contributions in the accounting period. Other company income and operating expenses are excluded.">
        {fin?.channels?.length ? <ChannelPerformance rows={fin.channels} currency={currency} /> : <BIEmpty message="No channel performance available for this period." />}
      </BIBlock>
      <BIBlock title="Top Performing Products" state={financial} action={<button type="button" className="bi-text-button" onClick={viewProducts}>View all</button>} note="Ranked by booked revenue. Unavailable profit means cost coverage is incomplete.">
        <BITopProducts products={products} currency={currency} onViewAll={viewProducts} />
      </BIBlock>
    </div>
    <div className="bi-summary-grid">
      <BIBlock title="Financial Summary" icon={BsReceipt} state={financial} note={provisional || 'Business Accounting source-linked contribution postings.'}>
        <BIMetricList rows={[
          ['Total revenue', money(summary.revenue)], ['Collected revenue', money(summary.collectedRevenue)],
          ['Refunds', money(summary.refundedAmount)], ['Total cost', money(summary.totalCost)],
          ['Gross profit', money(summary.grossProfit)], ['Net profit', money(summary.netProfit)],
          ['Profit margin', formatPercentage(fin?.kpis?.profitMargin?.value)]
        ]} />
        <details className="bi-accounting-basis"><summary>How these figures are calculated</summary><p>Total revenue is booked revenue plus other business income. Gross profit is collected revenue plus other business income, less refunds, provider fees, channel commission and posted direct costs. Net profit subtracts operating expenses. Margin is net profit divided by total revenue.</p><p>Template estimates are not posted expenses. Missing costs can overstate profit. No accounting records are created by this dashboard.</p></details>
      </BIBlock>
      <BIBlock title="Customer Insights" icon={BsPeople} state={operational} note="Customers are deduplicated by stable customer identity. Bookings without an identity are excluded from customer counts.">
        <BIMetricList rows={[
          ['Total customers', formatNumber(customers.totalCustomers)], ['New customers', formatNumber(customers.newCustomers), 'First recorded booking in this period'],
          ['Returning customers', formatNumber(customers.returningCustomers), 'Had a booking before this period'], ['Bookings per customer', formatNumber(customers.bookingsPerCustomer, 2)],
          ['Identified bookings', formatNumber(customers.identifiedBookings)],
          ['Average booking value', formatMoney(operations.averageBookingValue, operations.averageBookingValueCurrency), `${formatNumber(operations.averageBookingValueCount)} confirmed bookings in reporting currency`]
        ]} />
      </BIBlock>
      <BIBlock title="Operational Highlights" icon={BsActivity} state={operational} note="Booking activity uses the selected creation-date period; tours & activities is current catalogue inventory.">
        <BIMetricList rows={[
          ['Tours & activities', formatNumber(operations.totalProducts)], ['Confirmed bookings', formatNumber(operations.confirmedBookings)],
          ['Cancelled bookings', formatNumber(operations.cancelledBookings)], ['Cancellation rate', formatPercentage(operations.cancellationRate)],
          ['Average group size', formatNumber(operations.averageGroupSize, 1)]
        ]} />
      </BIBlock>
    </div>
    <div className="bi-lower-grid">
      <BIBlock title="Recent Bookings" state={operational} action={<Link to="/admin/operations/bookings">View all</Link>} note="Latest five bookings in the selected period. Amounts retain their original booking currency."><BIRecentBookings rows={ops?.recentBookings || []} timeZone={range?.timeZone} /></BIBlock>
      <BIBlock title="Key Insights" icon={BsLightbulb}>
        {busy ? <BISkeleton /> : <>{(financial.error || operational.error) && <p className="bi-footnote">Insights reflect only the sections that loaded successfully.</p>}{insights.length ? <ul className="bi-insights">{insights.map((insight) => <li key={insight.id}><span className={insight.tone}><BsBarChartLine aria-hidden="true" /></span><div><strong>{insight.title}</strong><p>{insight.detail}</p></div></li>)}</ul> : <BIEmpty message="More activity is needed to derive reliable insights." />}</>}
      </BIBlock>
    </div>
    <div ref={productsRef} tabIndex={-1} className="bi-profitability-anchor"><BIBlock title="Product Profitability" state={financial} action={products.length > 5 && <button type="button" className="bi-text-button" onClick={() => setShowAllProducts((value) => !value)}>{showAllProducts ? 'Show top 5' : `View all (${products.length})`}</button>} note="Posted costs use the existing contribution ledger. Actual direct costs are recorded booking expenses, shown separately for review. Gross profit and margin stay unavailable when posting costs are incomplete; template estimates and company overhead are never silently substituted."><BIProductProfitability rows={showAllProducts ? products : products.slice(0, 5)} currency={currency} /></BIBlock></div>
    <BIBlock title="Data Quality & Attention Required" icon={BsShieldCheck} action={<Link to="/admin/audit-control/data-quality">Data quality centre</Link>}>
      {busy ? <BISkeleton compact /> : <>{financial.error && <BIError title="financial quality checks" state={financial} />}{operational.error && <BIError title="booking quality checks" state={operational} />}{(fin || ops) && <BIWarnings rows={warnings} />}</>}
    </BIBlock>
    <footer className="bi-footer"><span>Riser Business Platform · Business Intelligence</span><span>{fin?.generatedAt || ops?.generatedAt ? `Updated ${dateLabel(fin?.generatedAt || ops?.generatedAt, range?.timeZone, { hour: '2-digit', minute: '2-digit' })}` : 'Awaiting analytics'}</span></footer>
  </div>;
}
