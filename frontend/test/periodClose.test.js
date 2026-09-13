import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/admin/AdminPeriodClosePage.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/pages/admin/periodClose.css', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../src/routes/AppRoutes.jsx', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api/adminApi.js', import.meta.url), 'utf8');

test('period close route uses the dedicated production page and real APIs', () => {
  assert.match(routes, /AdminPeriodClosePage/);
  assert.match(routes, /GL_CLOSE_PERIOD/);
  assert.match(api, /periods\/\$\{encodeURIComponent\(periodId\)\}\/readiness/);
  assert.match(page, /fetchAccountingPeriods/);
  assert.match(page, /closeAccountingPeriod/);
  assert.doesNotMatch(page, /September 2026/);
});

test('close workflow exposes server readiness, explicit reason and unavailable checks', () => {
  assert.match(page, /Pre-Close Checklist/);
  assert.match(page, /readyToClose/);
  assert.match(page, /Closing reason/);
  assert.match(page, /Not verified/);
  assert.match(page, /Period cannot be closed/);
});

test('period close layout has mobile cards and tablet health grid', () => {
  assert.match(css, /@media\(max-width:1100px\)/);
  assert.match(css, /@media\(max-width:700px\)/);
  assert.match(css, /\.pc-table-wrap thead\{display:none\}/);
  assert.match(css, /content:attr\(data-label\)/);
});
