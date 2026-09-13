import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
let server, components;
before(async () => {
  server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  components = await server.ssrLoadModule('/src/components/invoice/BookingPaymentState.jsx');
});
after(async () => { await server?.close(); });
const render = (name, props) => renderToStaticMarkup(React.createElement(components[name], props));
test('customer paid remains distinct from pending settlement and no local cash receipt', () => {
  const html = render('PaymentTruthDetails', { record: {
    salesChannel: 'GetYourGuide', bookingPayment: { status: 'PAID', source: 'BOKUN', reportedPaidAmount: 100, currency: 'USD' },
    settlement: { status: 'PENDING', receivedAmount: 0, currency: 'USD', cashReceipt: { status: 'NONE' }, reconciliation: { supported: false } }
  } });
  assert.match(html, /Customer paid/);
  assert.match(html, /Settlement pending/);
  assert.match(html, /No local receipt recorded/);
  assert.match(html, /GetYourGuide/);
  assert.match(html, /USD.*100\.00/);
  assert.match(html, /does not confirm bank reconciliation/);
});
test('unknown customer payment never falls back to local invoice paid status', () => {
  const html = render('PaymentTruthDetails', { record: { paymentStatus: 'paid', amountPaid: 100 } });
  assert.match(html, /Payment status unavailable/);
  assert.doesNotMatch(html, /Customer paid/);
  assert.doesNotMatch(html, /USD/);
});
test('conflicts and stale sync are stated without secondary source text', () => {
  const html = render('PaymentTruthBadge', { payment: { status: 'PARTIALLY_PAID', source: 'MANUAL_OVERRIDE', stale: true, conflict: true } });
  assert.match(html, /Partially paid/);
  assert.doesNotMatch(html, /Manual override/);
  assert.match(html, /Sync may be outdated/);
  assert.match(html, /review required/);
});
test('settlement currencies display separately without combining or inferring gross amounts', () => {
  const html = render('PaymentTruthDetails', { record: { settlement: {
    status: 'RECEIVED', receivedByCurrency: [{ amount: 80, currency: 'USD' }, { amount: 30, currency: 'EUR' }], cashReceipt: { status: 'CONFIRMED' }
  } } });
  assert.match(html, /USD.*80\.00/);
  assert.match(html, /EUR.*30\.00/);
  assert.match(html, /Confirmed local receipt/);
  assert.doesNotMatch(html, /110/);
});
