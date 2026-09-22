export const PERIOD_OPTIONS = [
  ['TODAY', 'Today'], ['YESTERDAY', 'Yesterday'], ['THIS_WEEK', 'This week'],
  ['LAST_WEEK', 'Last week'], ['THIS_MONTH', 'This month'], ['LAST_MONTH', 'Last month'],
  ['THIS_QUARTER', 'This quarter'], ['LAST_QUARTER', 'Last quarter'],
  ['THIS_YEAR', 'This year'], ['LAST_YEAR', 'Last year'], ['CUSTOM', 'Custom range']
];

export const hasValue = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
export const formatNumber = (value, digits = 0) => hasValue(value)
  ? new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(Number(value)) : '—';
export const formatPercentage = (value) => hasValue(value) ? `${formatNumber(value, 1)}%` : '—';
export const formatCompactNumber = (value) => hasValue(value)
  ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value)) : '—';
export const formatMoney = (value, currency, compact = false) => {
  if (!hasValue(value) || !currency) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, currencyDisplay: 'code',
    ...(compact ? { notation: 'compact', maximumFractionDigits: 1 } : {})
  }).format(Number(value));
};
export const dateLabel = (value, timeZone = 'Africa/Dar_es_Salaam', options = {}) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone, ...options }).format(new Date(value));
};
export const periodLabel = (range) => range?.fromIso && range?.toIso
  ? `${dateLabel(range.fromIso, range.timeZone)} – ${dateLabel(new Date(new Date(range.toIso).getTime() - 1), range.timeZone)}` : 'Select a reporting period';
export const humanize = (value = '') => String(value).replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());

export const mergeTrend = (financial = [], operational = []) => {
  const points = new Map();
  financial.forEach((row) => points.set(row.date, { date: row.date, revenue: Number(row.revenue), bookings: 0 }));
  operational.forEach((row) => points.set(row.date, { ...(points.get(row.date) || { date: row.date, revenue: 0 }), bookings: Number(row.bookings) }));
  return [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
};

// Reports can describe the same affected records. Never sum duplicate warning counts.
export const mergeWarnings = (...groups) => {
  const result = new Map();
  groups.flat().filter(Boolean).forEach((warning) => {
    const old = result.get(warning.code);
    if (!old || Number(warning.count) > Number(old.count)) result.set(warning.code, warning);
  });
  const rank = { critical: 0, warning: 1, info: 2 };
  return [...result.values()].sort((a, b) => (rank[a.severity] ?? 2) - (rank[b.severity] ?? 2));
};

export const warningAction = (code = '') => {
  if (code === 'DIRECT_BOOKING_COSTS_INCOMPLETE') return ['/admin/booking-accounting/expenses', 'Review booking expenses'];
  if (/COST|TEMPLATE/.test(code)) return ['/admin/booking-accounting/cost-templates', 'Review costs'];
  if (/INVOICE/.test(code)) return ['/admin/booking-accounting/invoices', 'Review invoices'];
  if (/PAYMENT|RECONCIL|CURRENCY|FX/.test(code)) return ['/admin/booking-accounting/reconciliation', 'Reconcile'];
  if (/SYNC/.test(code)) return ['/admin/operations/bokun-sync/sync-logs', 'Review sync'];
  if (/POSTING|JOURNAL/.test(code)) return ['/admin/business-accounting/accounting-reconciliation', 'Review accounting'];
  return ['/admin/audit-control/data-quality', 'Review'];
};

export const generateInsights = (financial, operational) => {
  const insights = [];
  const revenue = financial?.kpis?.revenue?.comparison;
  if (revenue?.comparisonValid) insights.push({
    id: 'revenue', tone: revenue.percentageChange >= 0 ? 'positive' : 'negative',
    title: `Revenue ${revenue.percentageChange >= 0 ? 'increased' : 'decreased'} ${formatPercentage(Math.abs(revenue.percentageChange))}`,
    detail: 'Compared with the previous equivalent period, on the same accounting basis.'
  });
  const products = [...(financial?.products || [])].sort((a, b) => Number(b.revenue) - Number(a.revenue));
  if (products[0] && Number(products[0].revenue) > 0) insights.push({
    id: 'product', tone: 'neutral', title: `${products[0].productTitle || products[0].productId} leads product revenue`,
    detail: `${formatMoney(products[0].revenue, financial.currency)} in the selected accounting period.`
  });
  const channels = [...(financial?.channels || [])].filter((row) => Number(row.revenue) > 0 && hasValue(row.margin)).sort((a, b) => Number(b.margin) - Number(a.margin));
  if (channels[0]) insights.push({
    id: 'channel', tone: 'neutral', title: `${humanize(channels[0].channel)} has the highest booking margin`,
    detail: `${formatPercentage(channels[0].margin)} before company operating expenses. Review missing-cost warnings before drawing conclusions.`
  });
  if (hasValue(operational?.operations?.cancellationRate) && operational.operations.totalBookings > 0) insights.push({
    id: 'cancellations', tone: 'neutral', title: `${formatPercentage(operational.operations.cancellationRate)} cancellation rate`,
    detail: `${formatNumber(operational.operations.cancelledBookings)} of ${formatNumber(operational.operations.totalBookings)} bookings in this period.`
  });
  return insights;
};

export const chartScale = (values) => {
  const valid = values.filter(hasValue).map(Number);
  const min = Math.min(0, ...valid), max = Math.max(0, ...valid);
  return { min, max: max === min ? min + 1 : max, span: max === min ? 1 : max - min };
};
