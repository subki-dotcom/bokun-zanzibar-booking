import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { createServer } from 'vite';

let server, components, charts;
before(async () => {
  server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  components = await server.ssrLoadModule('/src/components/admin/bi/BIComponents.jsx');
  charts = await server.ssrLoadModule('/src/components/admin/bi/BICharts.jsx');
});
after(async () => { await server?.close(); });
const render = (component, props) => renderToStaticMarkup(React.createElement(StaticRouter, { location: '/admin/business-intelligence' }, React.createElement(component, props)));

test('BI widget renders loading and retry errors instead of misleading zero totals', () => {
  const loading = render(components.BIBlock, { title: 'Revenue', state: { loading: true }, children: 'SHOULD NOT APPEAR' });
  assert.match(loading, /Loading analytics/);
  assert.doesNotMatch(loading, /SHOULD NOT APPEAR/);
  const error = render(components.BIBlock, { title: 'Revenue', state: { loading: false, error: 'Network unavailable', retry() {} } });
  assert.match(error, /Unable to load Revenue/);
  assert.match(error, /Retry/);
  assert.match(error, /role="alert"/);
});

test('recent bookings render actual currency, existing register links, and mobile cards', () => {
  const html = render(components.BIRecentBookings, { rows: [{ id: 'a', bookingReference: 'BK-1', date: '2026-09-09T08:00:00Z', customer: 'Customer', productTitle: 'Tour', channel: 'VIATOR', amount: 120, currency: 'EUR', status: 'confirmed' }] });
  assert.match(html, /EUR.*120.00/);
  assert.match(html, /\/admin\/operations\/bookings\?search=BK-1/);
  assert.match(html, /bi-booking-cards/);
  assert.match(html, /Confirmed/);
});

test('product missing costs render unavailable profit and a coverage warning', () => {
  const html = render(components.BIProductProfitability, { currency: 'USD', rows: [{ productId: '1', productTitle: 'Tour', revenue: 100, bookings: 1, directCost: null, actualDirectCost: 40, grossProfit: null, margin: null }] });
  assert.match(html, /Cost coverage incomplete/);
  assert.match(html, /USD.*40.00/);
  assert.doesNotMatch(html, /USD.*60.00/);
});

test('chart provides accessible exact data and preserves unavailable series', () => {
  const html = render(charts.RevenueBookingTrend, { rows: [{ date: '2026-09-09', revenue: 100, bookings: 2 }], currency: 'USD', granularity: 'day', revenueAvailable: false });
  assert.match(html, /revenue unavailable/);
  assert.match(html, /View chart data/);
  assert.match(html, /tabindex="0"/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});
