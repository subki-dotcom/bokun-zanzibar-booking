import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { createServer } from 'vite';
let server, components;
before(async () => {
  server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  components = await server.ssrLoadModule('/src/components/invoice/InvoiceRegisterComponents.jsx');
});
after(async () => { await server?.close(); });
const render = (name, props) => renderToStaticMarkup(React.createElement(StaticRouter, {}, React.createElement(components[name], props)));
const row = { id: '1', invoiceNumber: 'INV-1', bookingReference: 'BK/123', clientName: 'Customer', paymentStatus: 'pending', bookingPayment: { status: 'PARTIALLY_PAID', source: 'BOKUN' }, settlement: { status: 'PENDING' }, currency: 'USD', total: 100, amountPaid: 70, amountRefunded: 5, balanceDue: 35 };

test('register renders usable mobile cards, actual currency and existing booking navigation', () => {
  const html = render('InvoiceTable', { items: [row], onView() {} });
  assert.match(html, /iv-mobile-card/);
  assert.match(html, /Partially paid/);
  assert.match(html, /Settlement pending/);
  assert.match(html, /Accounting balance/);
  assert.match(html, /USD.*35\.00/);
  assert.match(html, /\/admin\/operations\/bookings\?search=BK%2F123/);
  assert.match(html, /Actions for INV-1/);
});
test('KPI scope and unavailable totals are explicit', () => {
  assert.match(render('InvoiceSummaryCards', { items: [row] }), /1 invoices on this page/);
  const empty = render('InvoiceSummaryCards', { items: [] });
  assert.doesNotMatch(empty, /USD/);
  assert.match(render('InvoiceSummaryCards', { items: [], loading: true }), /Loading invoices/);
});
test('pagination exposes current page, full count and native page-size control', () => {
  const html = render('InvoicePagination', { page: 2, limit: 25, total: 116 });
  assert.match(html, /Showing 26–50 of 116 invoices/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /Rows per page/);
});
test('API failure renders retry with accessible alert', () => {
  const html = render('InvoiceError', { error: 'Unavailable', onRetry() {} });
  assert.match(html, /role="alert"/);
  assert.match(html, /Retry/);
});
