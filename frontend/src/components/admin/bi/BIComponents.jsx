import { Link } from 'react-router-dom';
import { BsArrowClockwise, BsBarChartLine, BsExclamationCircle, BsArrowUpRight, BsArrowDownRight } from 'react-icons/bs';
import { dateLabel, formatMoney, formatNumber, formatPercentage, hasValue, humanize, warningAction } from './biHelpers';
import { Sparkline } from './BICharts';

export function BIEmpty({ message, action }) {
  return <div className="bi-empty"><BsBarChartLine aria-hidden="true" /><p>{message}</p>{action && <Link to={action[0]}>{action[1]}</Link>}</div>;
}

export function BISkeleton({ compact = false }) {
  return <div className={`bi-skeleton ${compact ? 'is-compact' : ''}`} role="status" aria-label="Loading analytics"><span /><span /><span /><span /></div>;
}

export function BIError({ title, state }) {
  return <div className="bi-error" role="alert"><BsExclamationCircle aria-hidden="true" /><strong>Unable to load {title}</strong><p>{state.error}</p><button type="button" onClick={state.retry}><BsArrowClockwise /> Retry</button></div>;
}

export function BIBlock({ title, icon: Icon, state, children, className = '', action, note }) {
  return <section className={`bi-panel ${className}`} aria-label={title} aria-busy={state?.loading || false}>
    <header className="bi-panel-heading"><h2>{Icon && <Icon aria-hidden="true" />}{title}</h2>{action}</header>
    {state?.loading ? <BISkeleton /> : state?.error ? <BIError title={title} state={state} /> : children}
    {note && !state?.loading && !state?.error && <p className="bi-footnote">{note}</p>}
  </section>;
}

export function BIComparison({ comparison }) {
  if (!comparison?.comparisonValid) return <span className="bi-comparison neutral">{comparison?.reason === 'ZERO_PREVIOUS_VALUE' ? 'No previous baseline' : 'Comparison unavailable'}</span>;
  const positive = Number(comparison.percentageChange) >= 0;
  const Icon = positive ? BsArrowUpRight : BsArrowDownRight;
  return <span className={`bi-comparison ${positive ? 'positive' : 'negative'}`}><Icon aria-hidden="true" />{formatPercentage(Math.abs(comparison.percentageChange))}<span>vs previous period</span></span>;
}

export function BIKpi({ label, value, metric, icon: Icon, tone, state, values = [], note }) {
  return <section className={`bi-kpi ${tone}`} aria-label={label} aria-busy={state.loading}>
    {state.loading ? <BISkeleton compact /> : state.error ? <BIError title={label} state={state} /> : <>
      <div className="bi-kpi-top"><span className="bi-kpi-icon"><Icon aria-hidden="true" /></span><div><h2>{label}</h2><strong className="bi-kpi-value">{value}</strong></div></div>
      <div className="bi-kpi-bottom"><BIComparison comparison={metric?.comparison} /><Sparkline values={values} /></div>
      {note && <small className="bi-kpi-note">{note}</small>}
    </>}
  </section>;
}

export function BIMetricList({ rows }) {
  return <dl className="bi-metric-list">{rows.map(([label, value, note]) => <div key={label}><dt>{label}{note && <small>{note}</small>}</dt><dd>{value}</dd></div>)}</dl>;
}

export function BITopProducts({ products, currency, onViewAll }) {
  if (!products.length) return <BIEmpty message="No product revenue for this period." />;
  return <><ol className="bi-top-products">{products.slice(0, 5).map((row, index) => <li key={row.productId || index}><span className="bi-product-rank">{index + 1}</span><div><strong>{row.productTitle || row.productId || 'Unmapped product'}</strong><small>{formatNumber(row.bookings)} bookings</small></div><div className="bi-product-money"><strong>{formatMoney(row.revenue, currency)}</strong><small>Gross profit {formatMoney(row.grossProfit, currency)}</small></div></li>)}</ol><button className="bi-inline-button" type="button" onClick={onViewAll}>View product profitability →</button></>;
}

export function BIRecentBookings({ rows, timeZone }) {
  if (!rows.length) return <BIEmpty message="No bookings found for this period." action={['/admin/operations/bookings', 'View booking register']} />;
  const bookingLink = (row) => `/admin/operations/bookings?search=${encodeURIComponent(row.bookingReference)}`;
  return <>
    <div className="bi-table-scroll bi-booking-table" role="region" aria-label="Recent bookings" tabIndex={0}><table><thead><tr><th>Date</th><th>Booking #</th><th>Customer / Product</th><th>Channel</th><th>Amount</th><th>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id || row.bookingReference}><td>{dateLabel(row.date, timeZone)}</td><td><Link to={bookingLink(row)}>{row.bookingReference}</Link></td><td><strong>{row.customer || 'Customer unavailable'}</strong><small>{row.productTitle}</small></td><td>{humanize(row.channel)}</td><td>{formatMoney(row.amount, row.currency)}</td><td><span className={`bi-status ${row.status}`}>{humanize(row.status)}</span></td></tr>)}</tbody></table></div>
    <div className="bi-booking-cards">{rows.map((row) => <article key={row.id || row.bookingReference}><div><Link to={bookingLink(row)}>{row.bookingReference}</Link><span className={`bi-status ${row.status}`}>{humanize(row.status)}</span></div><strong>{row.productTitle}</strong><p>{row.customer || 'Customer unavailable'}</p><dl><div><dt>Date</dt><dd>{dateLabel(row.date, timeZone)}</dd></div><div><dt>Channel</dt><dd>{humanize(row.channel)}</dd></div><div><dt>Amount</dt><dd>{formatMoney(row.amount, row.currency)}</dd></div></dl></article>)}</div>
  </>;
}

export function BIProductProfitability({ rows, currency }) {
  if (!rows.length) return <BIEmpty message="No product accounting data for this period." action={['/admin/booking-accounting/cost-templates', 'Review cost templates']} />;
  return <div className="bi-table-scroll" role="region" aria-label="Product profitability; scroll horizontally for all columns" tabIndex={0}><table><thead><tr><th>Product</th><th>Bookings</th><th>Revenue</th><th>Posted direct cost</th><th>Actual direct cost</th><th>Gross profit</th><th>Margin</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.productId || index}><td><strong>{row.productTitle || row.productId || 'Unmapped product'}</strong>{!hasValue(row.grossProfit) && <small className="bi-warning-text">Cost coverage incomplete</small>}</td><td>{formatNumber(row.bookings)}</td><td>{formatMoney(row.revenue, currency)}</td><td>{formatMoney(row.directCost, currency)}</td><td>{formatMoney(row.actualDirectCost, currency)}</td><td>{formatMoney(row.grossProfit, currency)}</td><td>{formatPercentage(row.margin)}</td></tr>)}</tbody></table></div>;
}

export function BIWarnings({ rows }) {
  if (!rows.length) return <BIEmpty message="No issues found by the available analytics checks for this period." />;
  return <ul className="bi-warnings">{rows.map((row) => {
    const action = warningAction(row.code);
    return <li key={row.code}><BsExclamationCircle aria-hidden="true" /><div><strong>{humanize(row.code)}</strong><p>{row.message}</p></div><span className={`bi-severity ${row.severity}`}>{humanize(row.severity)} · {formatNumber(row.count)}</span><Link to={action[0]}>{action[1]} →</Link></li>;
  })}</ul>;
}
