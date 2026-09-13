import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server, components;
before(async () => {
  server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  components = await server.ssrLoadModule('/src/components/admin/reportCenter/ReportCenterComponents.jsx');
});
after(async () => { await server?.close(); });
const render = (name, props) => renderToStaticMarkup(React.createElement(components[name], props));

test('preview loading and errors hide stale financial values and offer retry', () => {
  const data = { data: { totals: { revenue: 987654 } } };
  const loading = render('ReportPreview', { state: { loading: true, data } });
  assert.match(loading, /Loading report data/);
  assert.doesNotMatch(loading, /987,654/);
  const error = render('ReportPreview', { state: { error: 'Service unavailable', data, retry() {} } });
  assert.match(error, /Unable to load report preview/);
  assert.match(error, /Retry/);
  assert.doesNotMatch(error, /987,654/);
});

test('preview sections and financial currency come from response', () => {
  const html = render('ReportPreview', { state: { data: { currency: 'USD', data: { totals: { revenue: 120 }, sections: { financial: {} } } } } });
  assert.match(html, /USD.*120\.00/);
  assert.match(html, /Financial summary/);
  assert.doesNotMatch(html, /Customer Insights|Top Performing Products/);
});

test('history supports mobile cards and disables unsupported archived actions', () => {
  const props = { resource: { data: { items: [{ id: '1', reportType: 'DAILY', reportTitle: 'Daily report', format: 'PDF', status: 'completed', generatedAt: '2026-09-09T09:00:00Z', filters: { period: 'THIS_MONTH' } }] } }, reports: [{ type: 'DAILY', supportedExports: ['PDF'] }], canExport: true, page: 1 };
  const unavailable = render('ExportHistory', props);
  assert.match(unavailable, /rc-history-cards/);
  assert.match(unavailable, /Not retained/);
  assert.doesNotMatch(unavailable, /aria-label="Regenerate/);
  props.resource.data.items[0].period = { fromIso: '2026-08-01T00:00:00Z', toIso: '2026-09-01T00:00:00Z' };
  assert.match(render('ExportHistory', props), /aria-label="Regenerate/);
  assert.doesNotMatch(render('ExportHistory', { ...props, canExport: false }), /aria-label="Regenerate/);
});
