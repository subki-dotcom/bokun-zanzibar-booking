import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";

let server, footer, site, pages, providers;
before(async () => {
  server = await createServer({ configFile: false, esbuild: { jsx: "automatic" }, server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: "custom" });
  footer = (await server.ssrLoadModule("/src/components/common/siteFooter/SiteFooter.jsx")).default;
  site = await server.ssrLoadModule("/src/config/site.js");
  pages = await server.ssrLoadModule("/src/config/sitePages.js");
  providers = await server.ssrLoadModule("/src/context/PaymentProvidersContext.jsx");
});
after(async () => { await server?.close(); });

const render = (props = {}) =>
  renderToStaticMarkup(
    React.createElement(MemoryRouter, null, React.createElement(providers.PaymentProvidersProvider, null, React.createElement(footer, props)))
  );

test("every footer link has its own destination; only the plain tour list points at /tours", () => {
  const all = [...site.FOOTER_LINKS.experiences, ...site.FOOTER_LINKS.company, ...site.FOOTER_LINKS.help];
  const targets = all.map((link) => link.to);
  assert.equal(new Set(targets).size, targets.length);
  assert.deepEqual(all.filter((link) => link.to === "/tours").map((link) => link.label), ["All tours"]);
});

test("footer pages exist: About, Contact, FAQ, Cancellation policy, Terms, Privacy", () => {
  for (const path of ["/about", "/contact", "/faq", "/cancellation-policy", "/terms", "/privacy"]) {
    assert.ok(pages.sitePageFor(path), path);
  }
  assert.equal(pages.sitePageFor("/nope"), null);
});

test("the full footer: CTA, columns, contact and newsletter; Safari Blue waits for a search hit", () => {
  const html = render();
  assert.match(html, /role="contentinfo"/);
  assert.match(html, /Planning a trip to Zanzibar\?/);
  for (const title of ["Top experiences", "Company", "Help", "Contact"]) assert.match(html, new RegExp(title));
  assert.match(html, /href="\/tours\?q=mnemba"/);
  assert.match(html, /href="\/login">Agent login/);
  assert.doesNotMatch(html, /Safari Blue/);
  assert.match(html, /Email for our newsletter/);
  assert.doesNotMatch(html, /bokun|bókun/i);
});

test("the compact footer has no CTA, columns or newsletter", () => {
  const html = render({ compact: true });
  assert.match(html, /sf-compact/);
  assert.match(html, /href="\/terms"/);
  assert.doesNotMatch(html, /Planning a trip|Top experiences|newsletter/i);
});

test("style keys and labels both name a travel style", () => {
  assert.equal(site.styleLabel("cultural"), "Cultural tours");
  assert.equal(site.styleLabel("Safari trips"), "Safari trips");
  assert.equal(site.styleLabel("all"), "all");
});

test("the travel agency schema lists only configured social links and no rating without reviews", () => {
  const agency = site.travelAgencySchema(null);
  assert.equal(agency["@type"], "TravelAgency");
  assert.equal(agency.aggregateRating, undefined);
  assert.ok(!(agency.sameAs || []).some((url) => !url));
});
