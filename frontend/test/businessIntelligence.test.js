import test from 'node:test';
import assert from 'node:assert/strict';
import { chartScale, formatMoney, formatPercentage, generateInsights, mergeTrend, mergeWarnings, periodLabel, PERIOD_OPTIONS } from '../src/components/admin/bi/biHelpers.js';

test('BI formatting distinguishes missing metrics from zero and respects reporting currency', () => {
  assert.equal(formatMoney(null, 'TZS'), '—');
  assert.equal(formatMoney(10, undefined), '—');
  assert.match(formatMoney(1250.5, 'EUR'), /EUR.*1,250.50/);
  assert.match(formatMoney(0, 'USD'), /USD.*0.00/);
  assert.equal(formatPercentage(null), '—');
  assert.equal(formatPercentage(0), '0%');
});

test('trend combines matching series chronologically without combining monetary and count units', () => {
  assert.deepEqual(mergeTrend([{ date: '2026-09-02', revenue: '25.5' }], [{ date: '2026-09-01', bookings: 3 }, { date: '2026-09-02', bookings: 2 }]), [
    { date: '2026-09-01', revenue: 0, bookings: 3 }, { date: '2026-09-02', revenue: 25.5, bookings: 2 }
  ]);
  assert.deepEqual(chartScale([-20, 40]), { min: -20, max: 40, span: 60 });
  assert.equal(chartScale([0, 0]).span, 1);
});

test('warning records are not double counted across widgets', () => {
  const rows = mergeWarnings([{ code: 'MISSING_COST', count: 5, severity: 'warning' }], [{ code: 'MISSING_COST', count: 5, severity: 'warning' }, { code: 'UNBALANCED', count: 1, severity: 'critical' }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].code, 'UNBALANCED');
  assert.equal(rows[1].count, 5);
});

test('insights only use supported comparisons, actual rankings, and observed cancellation rate', () => {
  assert.deepEqual(generateInsights(null, null), []);
  const result = generateInsights({ currency: 'USD', kpis: { revenue: { comparison: { comparisonValid: false, percentageChange: null } } }, products: [{ productTitle: 'Second', revenue: 50 }, { productTitle: 'First', revenue: 100 }], channels: [{ channel: 'DIRECT_WEBSITE', revenue: 100, margin: null }] }, { operations: { totalBookings: 10, cancelledBookings: 2, cancellationRate: 20 } });
  assert.equal(result.length, 2);
  assert.match(result[0].title, /First leads/);
  assert.match(result[1].title, /20%/);
  assert.ok(result.every((row) => !/industry|AI|highest booking margin/.test(row.detail + row.title)));
});

test('periods include all requested presets and date label respects exclusive end in reporting timezone', () => {
  assert.equal(PERIOD_OPTIONS.length, 11);
  assert.ok(PERIOD_OPTIONS.some(([value]) => value === 'LAST_QUARTER'));
  assert.equal(periodLabel({ fromIso: '2026-07-31T21:00:00Z', toIso: '2026-08-31T21:00:00Z', timeZone: 'Africa/Dar_es_Salaam' }), '01 Aug 2026 – 31 Aug 2026');
});
