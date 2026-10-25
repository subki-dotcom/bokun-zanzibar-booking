import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";

let server;
before(async () => {
  server = await createServer({ configFile: false, esbuild: { jsx: "automatic" }, server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: "custom" });
});
after(async () => { await server?.close(); });

test("addresses without their own page get the plain app page, not the home page", () => {
  const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(vercel.rewrites, [{ source: "/(.*)", destination: "/app.html" }]);
  const prerender = fs.readFileSync(new URL("../scripts/prerender-public-pages.mjs", import.meta.url), "utf8");
  assert.match(prerender, /writeFile\(path\.join\(dist, "app\.html"\), template\)/);
});

test("an unknown address says the page is not found", async () => {
  const page = (await server.ssrLoadModule("/src/pages/public/NotFoundPage.jsx")).default;
  const original = console.error;
  console.error = () => {};
  try {
    const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(page)));
    assert.match(html, /<h1>Page not found<\/h1>/);
    assert.match(html, /href="\/tours"/);
  } finally {
    console.error = original;
  }
});

test("the home description fits in Google's snippet", async () => {
  const view = await server.ssrLoadModule("/src/components/homePage/HomeView.jsx");
  assert.ok(view.HOME_DESCRIPTION.length <= 160, `${view.HOME_DESCRIPTION.length} characters`);
  assert.ok(view.HOME_TITLE.length <= 70);
});
