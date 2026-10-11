import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";
let server, Page;
before(async () => {
  server = await createServer({ configFile: false, esbuild: { jsx: "automatic" }, server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: "custom" });
  Page = (await server.ssrLoadModule("/src/pages/public/PasswordRecoveryPage.jsx")).default;
});
after(async () => { delete globalThis.window; await server?.close(); });
const render = (mode) => renderToStaticMarkup(React.createElement(MemoryRouter, {}, React.createElement(Page, { mode })));

test("forgot password has labeled email input and a login return link", () => {
  const html = render("forgot");
  assert.match(html, /Forgot your password/);
  assert.match(html, /Admin \/ Staff/);
  assert.match(html, /for="recovery-email"/);
  assert.match(html, /type="email"/);
  assert.match(html, /Send reset link/);
  assert.match(html, /href="\/login"/);
});
test("missing reset credential offers a new link instead of a password form", () => {
  const html = render("reset");
  assert.match(html, /link is missing or invalid/);
  assert.match(html, /href="\/forgot-password"/);
  assert.doesNotMatch(html, /id="recovery-password"/);
});
test("valid email link renders two protected inputs without exposing the token in markup", () => {
  const token = "a".repeat(64);
  globalThis.window = { location: { hash: `#token=${token}` } };
  try {
    const html = render("reset");
    assert.equal((html.match(/type="password"/g) || []).length, 2);
    assert.equal((html.match(/autoComplete="new-password"/g) || []).length, 2);
    assert.match(html, /Save new password/);
    assert.ok(!html.includes(token));
  } finally { delete globalThis.window; }
});
