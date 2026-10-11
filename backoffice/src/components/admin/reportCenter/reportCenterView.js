import { dateLabel, formatMoney, formatNumber, formatPercentage, humanize } from '../bi/biHelpers.js';

export const getPath = (source, path = '') => path.split('.').filter(Boolean).reduce((value, key) => value?.[key], source);
export const unwrap = (value) => value && typeof value === 'object' && 'value' in value ? (value.supported === false ? null : value.value) : value;
export const inferRows = (data = {}) => {
  for (const rows of [data.rows, data.items, data.products, data.channels, data.trends?.combined]) if (Array.isArray(rows)) return rows;
  const summary = { ...data.totals, ...data.managementSummary, ...data.kpis, ...data.financialBreakdown, ...data.answers };
  return Object.keys(summary).length ? [summary] : [];
};
export const resolveCell = (column, row, data) => {
  const source = column.source || column.key;
  const relative = source.replace(/^(rows|items|products|channels|trends\.combined)\./, '');
  return getPath(row, relative) ?? getPath(data, source) ?? row?.[column.key];
};
export const displayValue = (input, type, currency) => {
  const value = unwrap(input);
  if (value === null || value === undefined || value === '') return '—';
  if (type === 'money') return currency ? formatMoney(value, currency) : formatNumber(value, 2);
  if (type === 'percent') return formatPercentage(value);
  if (type === 'number') return formatNumber(value, 2);
  if (type === 'date') return dateLabel(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return value.label || value.reason || 'See exported details';
  return String(value);
};

const metric = (label, type, value) => ({ label, type, value: unwrap(value), comparison: value?.comparison });
export const previewMetrics = (result) => {
  const data = result?.data || {};
  if (data.managementSummary) {
    const s = data.managementSummary, k = data.sections?.financial?.kpis || {};
    return [metric('Bookings created', 'number', s.bookingsCreated), metric('Total revenue', 'money', k.revenue || s.bookedRevenue), metric('Direct booking costs', 'money', s.directBookingCosts), metric('Gross profit', 'money', k.grossProfit || s.grossProfit), metric('Net profit', 'money', k.netProfit || s.netProfit), metric('Profit margin', 'percent', k.profitMargin || s.profitMargin)];
  }
  if (data.kpis?.revenue) {
    const k = data.kpis;
    return [metric('Confirmed bookings', 'number', k.totalConfirmedBookings || k.confirmedBookings), metric('Total revenue', 'money', k.revenue), metric('Collected revenue', 'money', k.collectedRevenue), metric('Gross profit', 'money', k.grossProfit), metric('Net profit', 'money', k.netProfit), metric('Profit margin', 'percent', k.profitMargin)];
  }
  const totals = data.totals || data.managementSummary || data.kpis || {};
  return Object.entries(totals).filter(([, value]) => typeof unwrap(value) === 'number' || (typeof unwrap(value) === 'string' && /^-?\d+(\.\d+)?$/.test(unwrap(value)))).slice(0, 6).map(([key, value]) => metric(humanize(key.replace(/([a-z])([A-Z])/g, '$1 $2')), /margin|rate|percent/i.test(key) ? 'percent' : /revenue|profit|amount|cost|expense|income|balance|fee|contribution/i.test(key) ? 'money' : 'number', value));
};

export const reportSections = (result, definition) => {
  if (result?.data?.sections) return Object.keys(result.data.sections).map((key) => ({ key, label: ({ financial: 'Financial summary', bookingsCreated: 'Bookings overview', toursOperating: 'Tours operating', trends: 'Business trends', products: 'Product performance', channels: 'Channel performance' })[key] || humanize(key.replace(/([a-z])([A-Z])/g, '$1 $2')) }));
  return (definition?.sections || []).map((section) => typeof section === 'string' ? { key: section, label: section } : section);
};

export const filterReports = (reports, search, group = '') => {
  const term = search.trim().toLocaleLowerCase();
  return reports.filter((report) => (!group || report.group === group) && (!term || `${report.title} ${report.description}`.toLocaleLowerCase().includes(term)));
};

export const historicalFilters = (item) => {
  const filters = { ...(item.filters || {}) };
  const period = item.period || item.metadata?.period;
  if (period?.fromIso && period?.toIso) {
    // ISO endpoints already use an exclusive end; preserve them exactly.
    return { ...filters, period: 'CUSTOM', from: period.fromIso, to: period.toIso };
  }
  if (['CUSTOM', 'MULTI_YEAR'].includes(filters.period) && filters.from && filters.to) return filters;
  // A relative historic preset would silently regenerate a different period.
  return null;
};

export const historyPeriod = (item) => {
  const range = item.period || item.metadata?.period;
  if (range?.fromIso && range?.toIso) return `${dateLabel(range.fromIso, range.timeZone)} – ${dateLabel(new Date(new Date(range.toIso).getTime() - 1), range.timeZone)}`;
  if (item.filters?.from && item.filters?.to) return `${dateLabel(item.filters.from)} – ${dateLabel(item.filters.to)}`;
  return humanize(item.filters?.period || 'Period unavailable');
};

export const validDateRange = (from, to) => {
  const valid = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime()) && new Date(value).toISOString().slice(0, 10) === value;
  return valid(from) && valid(to) && from <= to;
};
