import { useEffect, useId, useRef, useState } from 'react';
import { chartScale, formatCompactNumber, formatMoney, formatNumber, formatPercentage, humanize } from './biHelpers';

export const CHART_COLORS = ['#1889f5', '#00a996', '#e9ad27', '#9060cf', '#ed8564', '#8faacb', '#417384'];

export function Sparkline({ values = [], color = '#008f89' }) {
  if (values.length < 2) return null;
  const { min, span } = chartScale(values);
  const points = values.map((value, index) => `${index * 78 / (values.length - 1)},${30 - (Number(value) - min) / span * 26}`).join(' ');
  return <svg className="bi-sparkline" viewBox="0 0 80 34" aria-hidden="true"><polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" /></svg>;
}

export function RevenueBookingTrend({ rows, currency, granularity, revenueAvailable = true, bookingsAvailable = true }) {
  const [active, setActive] = useState(null);
  const [width, setWidth] = useState(700);
  const chartRef = useRef(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    if (chartRef.current) observer.observe(chartRef.current);
    return () => observer.disconnect();
  }, []);
  const id = useId();
  const height = 270, left = 52, right = 32, top = 26, bottom = 40;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const { min, max, span } = chartScale(rows.map((row) => row.revenue));
  const bookingMax = Math.max(1, ...rows.map((row) => row.bookings));
  const y = (value) => top + (max - value) / span * plotHeight;
  const x = (index) => left + (index + 0.5) * plotWidth / Math.max(1, rows.length);
  const by = (value) => top + plotHeight * (1 - value / bookingMax);
  const shortLabel = (date) => {
    if (granularity === 'hour') return date.includes('T') ? date.split('T')[1].slice(0, 5) : date.slice(-5);
    const parts = date.slice(0, 10).split('-');
    if (granularity === 'month') return `${parts[1]}/${parts[0]?.slice(2)}`;
    return `${parts[2] || '01'}/${parts[1]}`;
  };
  const selected = rows[active];
  return <div className="bi-trend">
    <div className="bi-chart-legend"><span><i style={{ background: CHART_COLORS[0] }} />Revenue ({currency || 'unavailable'})</span><span><i style={{ background: CHART_COLORS[1] }} />Bookings</span></div>
    <div className="bi-chart-scroll" ref={chartRef} role="region" aria-label="Revenue and bookings chart" tabIndex={0}>
      <svg viewBox={`0 0 ${width} ${height}`} className="bi-trend-svg" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
        <title id={`${id}-title`}>{`Revenue and bookings by ${granularity}`}</title>
        <desc id={`${id}-desc`}>Blue bars show accounting revenue using the left axis. Teal line shows bookings using the right axis. Focus each period for exact values, or expand the chart data table.</desc>
        {[0, 1, 2, 3, 4].map((step) => {
          const value = max - step * span / 4;
          return <g key={step}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="#e8eef5" strokeDasharray="3 3" /><text x={left - 8} y={y(value) + 4} textAnchor="end">{revenueAvailable ? formatCompactNumber(value) : '—'}</text><text x={width - right + 6} y={y(value) + 4}>{bookingsAvailable ? formatCompactNumber(bookingMax * (4 - step) / 4) : '—'}</text></g>;
        })}
        <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} stroke="#c9d7e6" />
        {rows.map((row, index) => <g key={row.date}>
          {revenueAvailable && <rect x={x(index) - plotWidth / rows.length * .3} y={Math.min(y(row.revenue), y(0))} width={plotWidth / rows.length * .6} height={Math.max(0, Math.abs(y(row.revenue) - y(0)))} rx="3" fill={CHART_COLORS[0]} opacity={active === index ? 1 : .82} />}
          {index % Math.max(1, Math.ceil(rows.length / (width < 450 ? 4 : 8))) === 0 && <text x={x(index)} y={height - 12} textAnchor="middle">{shortLabel(row.date)}</text>}
        </g>)}
        {bookingsAvailable && <polyline points={rows.map((row, index) => `${x(index)},${by(row.bookings)}`).join(' ')} fill="none" stroke={CHART_COLORS[1]} strokeWidth="3" strokeLinejoin="round" />}
        {rows.map((row, index) => <g key={`hit-${row.date}`} tabIndex={0} role="img" aria-label={`${row.date}: revenue ${revenueAvailable ? formatMoney(row.revenue, currency) : 'unavailable'}, bookings ${bookingsAvailable ? formatNumber(row.bookings) : 'unavailable'}`} onFocus={() => setActive(index)} onBlur={() => setActive(null)} onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)}>
          <rect x={left + index * plotWidth / rows.length} y={top} width={plotWidth / rows.length} height={plotHeight} fill="transparent" />
          {bookingsAvailable && <circle cx={x(index)} cy={by(row.bookings)} r={active === index ? 6 : 3.5} fill={CHART_COLORS[1]} stroke="white" strokeWidth="2" />}
          <title>{`${row.date}\nRevenue: ${revenueAvailable ? formatMoney(row.revenue, currency) : 'Unavailable'}\nBookings: ${bookingsAvailable ? formatNumber(row.bookings) : 'Unavailable'}`}</title>
        </g>)}
      </svg>
    </div>
    <div className="bi-chart-readout" aria-live="polite">{selected ? <><strong>{selected.date}</strong><span>Revenue {revenueAvailable ? formatMoney(selected.revenue, currency) : 'unavailable'}</span><span>{bookingsAvailable ? formatNumber(selected.bookings) : '—'} bookings</span></> : <span>Hover or focus a period to explore • {granularity} intervals</span>}</div>
    <details className="bi-chart-data"><summary>View chart data</summary><div className="bi-table-scroll" tabIndex={0} role="region" aria-label="Trend data"><table><thead><tr><th>Period</th><th>Revenue</th><th>Bookings</th></tr></thead><tbody>{rows.map((row) => <tr key={row.date}><td>{row.date}</td><td>{revenueAvailable ? formatMoney(row.revenue, currency) : '—'}</td><td>{bookingsAvailable ? formatNumber(row.bookings) : '—'}</td></tr>)}</tbody></table></div></details>
  </div>;
}

export function ChannelPerformance({ rows, currency }) {
  const total = rows.reduce((sum, row) => sum + Math.max(0, Number(row.revenue)), 0);
  let offset = 0;
  return <>
    <div className="bi-channel-visual">
      <div className="bi-donut"><svg viewBox="0 0 180 180" role="img" aria-label={`Channel revenue distribution: ${formatMoney(total, currency)}. See channel table for values.`}>
        <circle cx="90" cy="90" r="70" fill="none" stroke="#edf2f7" strokeWidth="25" />
        {total > 0 && rows.map((row, index) => {
          const fraction = Math.max(0, Number(row.revenue)) / total * 100;
          const start = offset; offset += fraction;
          return <circle key={row.channel} cx="90" cy="90" r="70" fill="none" pathLength="100" stroke={CHART_COLORS[index % CHART_COLORS.length]} strokeWidth="25" strokeDasharray={`${Math.max(0, fraction - .5)} ${100 - Math.max(0, fraction - .5)}`} strokeDashoffset={-start} transform="rotate(-90 90 90)"><title>{`${humanize(row.channel)}: ${formatMoney(row.revenue, currency)}`}</title></circle>;
        })}
      </svg><div><strong>{formatMoney(total, currency, true)}</strong><span>Booking revenue</span></div></div>
      <ul className="bi-channel-legend">{rows.slice(0, 6).map((row, index) => <li key={row.channel}><i style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} /><span>{humanize(row.channel)}</span><strong>{formatPercentage(row.contributionPercentage)}</strong></li>)}{rows.length > 6 && <li>+ {rows.length - 6} channels in table</li>}</ul>
    </div>
    <details className="bi-chart-data"><summary>Channel revenue & profitability</summary><div className="bi-table-scroll" tabIndex={0} role="region" aria-label="Channel performance data"><table><thead><tr><th>Channel</th><th>Bookings</th><th>Revenue</th><th>Contribution</th><th>Gross profit</th><th>Margin</th></tr></thead><tbody>{rows.map((row) => <tr key={row.channel}><td>{humanize(row.channel)}</td><td>{formatNumber(row.bookings)}</td><td>{formatMoney(row.revenue, currency)}</td><td>{formatPercentage(row.contributionPercentage)}</td><td>{formatMoney(row.grossProfit, currency)}</td><td>{formatPercentage(row.margin)}</td></tr>)}</tbody></table></div></details>
  </>;
}
