import test from 'node:test';
import assert from 'node:assert/strict';
import { displayValue, historicalFilters, previewMetrics, reportSections, filterReports, validDateRange, resolveCell } from '../src/components/admin/reportCenter/reportCenterView.js';

test('report money preserves explicit currency and distinguishes zero from unavailable', () => {
  assert.match(displayValue(12450, 'money', 'USD'), /USD.*12,450\.00/);
  assert.match(displayValue(245680000, 'money', 'TZS'), /TZS.*245,680,000/);
  assert.equal(displayValue({ value: 0, supported: false }, 'money', 'USD'), '—');
  assert.match(displayValue(0, 'money', 'USD'), /USD.*0\.00/);
  assert.doesNotMatch(displayValue(12, 'money', null), /USD|TZS/);
});

test('preview uses authoritative financial metrics without deriving profit in the browser', () => {
  const metrics = previewMetrics({ data: { managementSummary: { bookedRevenue: { value: 500 }, bookingsCreated: { value: 3 }, directBookingCosts: { value: 80 }, netProfit: { supported: false, value: 420 } }, sections: { financial: { kpis: { revenue: { value: 250 }, grossProfit: { value: 170 }, netProfit: { value: 90 }, profitMargin: { value: 36 } } } } } });
  assert.deepEqual(metrics.map((metric) => metric.value), [3, 250, 80, 170, 90, 36]);
  assert.equal(previewMetrics({ data: { managementSummary: { netProfit: { supported: false, value: 420 } } } })[4].value, null);
});

test('historic export regeneration preserves original exclusive ISO endpoints', () => {
  const range = { fromIso: '2026-07-31T21:00:00.000Z', toIso: '2026-08-31T21:00:00.000Z' };
  assert.deepEqual(historicalFilters({ filters: { period: 'THIS_MONTH', granularity: 'DAY' }, period: range }), { period: 'CUSTOM', granularity: 'DAY', from: range.fromIso, to: range.toIso });
  assert.equal(historicalFilters({ filters: { period: 'LAST_MONTH' } }), null);
});

test('sections and searchable reports reflect actual metadata', () => {
  assert.deepEqual(reportSections({ data: { sections: { financial: {}, toursOperating: {} } } }, {}).map((section) => section.label), ['Financial summary', 'Tours operating']);
  assert.equal(filterReports([{ title: 'Daily Management', description: 'Summary', group: 'management' }], ' DAILY ', 'management').length, 1);
  assert.equal(filterReports([{ title: 'Daily Management', description: 'Summary', group: 'management' }], 'tax').length, 0);
  assert.equal(resolveCell({ key: 'net', source: 'rows.netProfit' }, { netProfit: 0 }, {}), 0);
});

test('custom date validation rejects reversed and impossible dates', () => {
  assert.equal(validDateRange('2026-08-01', '2026-08-31'), true);
  assert.equal(validDateRange('2026-08-31', '2026-08-01'), false);
  assert.equal(validDateRange('2026-02-30', '2026-03-01'), false);
  assert.equal(validDateRange('', ''), false);
});
