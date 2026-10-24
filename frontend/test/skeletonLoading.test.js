import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let server, Loader;
before(async () => {
  server = await createServer({ configFile: false, esbuild: { jsx: "automatic" }, server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: "custom" });
  Loader = (await server.ssrLoadModule("/src/components/common/Loader.jsx")).default;
});
after(async () => { await server?.close(); });

test("all shared page loading layouts announce loading and contain no interactive fake content", () => {
  for (const variant of ["page", "cards", "table", "form", "inline"]) {
    const html = renderToStaticMarkup(React.createElement(Loader, { variant, message: "Loading bookings..." }));
    assert.match(html, /role="status"/);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /aria-label="Loading bookings\.\.\."/);
    assert.match(html, /app-skeleton-line/);
    assert.doesNotMatch(html, /<button|<input|spinner-border/);
  }
});

test("payment verification keeps its explanatory status visible", () => {
  const html = renderToStaticMarkup(React.createElement(Loader, { showMessage: true, variant: "inline", message: "Confirming your payment..." }));
  assert.match(html, /class="app-skeleton-message">Confirming your payment/);
});
