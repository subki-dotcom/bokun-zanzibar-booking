import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { sharedResolve } from '../../shared/vite.shared.js';
let server;
before(async () => {
  server = await createServer({ configFile: false, resolve: sharedResolve, esbuild: { jsx: 'automatic' }, server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
});
after(async () => { await server?.close(); });
test('public invoice identifies an OTA collector without describing it as a gateway payment', async () => {
  const { default: PrintableInvoice } = await server.ssrLoadModule('/src/components/invoice/PrintableInvoice.jsx');
  const html = renderToStaticMarkup(React.createElement(PrintableInvoice, { invoice: { invoiceNumber: 'INV-OTA-1', bookingReference: 'GYG-1', issueDate: '2026-09-17', paymentStatus: 'paid', bookingStatus: 'confirmed', guestPaymentCollector: 'GetYourGuide', currency: 'USD', total: 22, amountPaid: 22, balanceDue: 0 } }));
  assert.match(html, /Payment Collected By/);
  assert.match(html, /GetYourGuide/);
  assert.match(html, /Payment was collected by GetYourGuide/);
  assert.match(html, /Guest Balance Due/);
  assert.doesNotMatch(html, /payment gateway/);
});
