import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";

let server, header, data, site, contact;
before(async () => {
  server = await createServer({ configFile: false, esbuild: { jsx: "automatic" }, server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: "custom" });
  header = (await server.ssrLoadModule("/src/components/common/siteHeader/SiteHeader.jsx")).default;
  data = await server.ssrLoadModule("/src/components/common/siteHeader/headerData.js");
  site = await server.ssrLoadModule("/src/config/site.js");
  contact = (await server.ssrLoadModule("/src/pages/public/ContactPage.jsx")).default;
});
after(async () => { await server?.close(); });

// Router links use layout effects, which React reports on the server; that warning is not a test failure.
const quiet = (fn) => {
  const original = console.error;
  console.error = (message, ...rest) => {
    if (!String(message).includes("useLayoutEffect does nothing on the server")) original(message, ...rest);
  };
  try {
    return fn();
  } finally {
    console.error = original;
  }
};
const render = (path, element) => quiet(() => renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [path] }, element)));

test("the main navigation is Home · Tours & activities · Transfers · Safaris · Contact · My booking", () => {
  assert.deepEqual(site.MAIN_NAV.map((item) => item.label), ["Home", "Tours & activities", "Transfers", "Safaris", "Contact", "My booking"]);
  assert.deepEqual(site.MAIN_NAV.map((item) => item.to), ["/", "/tours", "/tours?category=transfers", "/tours?category=safari", "/contact", "/my-booking"]);
});

test("the current page is worked out from the address", () => {
  assert.equal(data.activeNavKey("/"), "home");
  assert.equal(data.activeNavKey("/tours"), "tours");
  assert.equal(data.activeNavKey("/tours/mnemba-123"), "tours");
  assert.equal(data.activeNavKey("/tours", "?category=transfers"), "transfers");
  assert.equal(data.activeNavKey("/tours", "?category=Safari%20trips"), "safaris");
  assert.equal(data.activeNavKey("/contact"), "contact");
  assert.equal(data.activeNavKey("/my-booking/ZNZ-1"), "booking");
  assert.equal(data.activeNavKey("/faq"), "");
});

test("menu links: hidden when their search finds nothing, Safari Blue waits for a match, prices only where asked", () => {
  const blue = { label: "Safari Blue", search: "safari-blue", hideUntilFound: true };
  const airport = { label: "Airport to hotel", search: "airport", price: true };
  assert.equal(data.showMenuLink(blue, null), false);
  assert.equal(data.showMenuLink(airport, null), true);
  assert.equal(data.showMenuLink(blue, { "safari-blue": { count: 2 } }), true);
  assert.equal(data.showMenuLink(airport, { airport: { count: 0 } }), false);
  assert.equal(data.showMenuLink({ label: "All", to: "/tours" }, {}), true);
  assert.equal(data.menuLinkPrice(airport, { airport: { count: 3, fromPrice: 15 } }), 15);
  assert.equal(data.menuLinkPrice({ ...airport, price: false }, { airport: { count: 3, fromPrice: 15 } }), 0);
  assert.ok(data.menuSearches().includes("mnemba"));
});

test("default header: skip link first, banner, main navigation with the current page, no staff login", () => {
  const html = render("/tours?category=safari", React.createElement(header));
  assert.ok(html.indexOf("Skip to content") < html.indexOf("<header"));
  assert.match(html, /role="banner"/);
  assert.match(html, /<nav class="sh-nav" aria-label="Main">/);
  assert.match(html, /aria-current="page" href="\/tours\?category=safari"/);
  assert.match(html, /aria-expanded="false"[^>]*>Tours &amp; activities/);
  assert.match(html, /wa\.me\/\d+\?text=Hello%2C%20I(?:'|&#x27;)d%20like%20help%20planning%20a%20Zanzibar%20trip/);
  assert.doesNotMatch(html, /Agent\/Admin Login|Agent login/);
  assert.doesNotMatch(html, /bokun|bókun/i);
});

test("transparent header on the home page", () => {
  const html = render("/", React.createElement(header, { variant: "transparent" }));
  assert.match(html, /class="sh sh-transparent is-transparent"/);
  assert.match(html, /aria-current="page" href="\/">Home/);
});

test("checkout header: steps, help line, secure checkout and no site navigation", () => {
  const html = render("/booking/x", React.createElement(header, { variant: "checkout", step: 2 }));
  assert.match(html, /Details<span class="sh-visually-hidden"> \(done\)/);
  assert.match(html, /aria-current="step"/);
  assert.match(html, /Need help\? <a href="tel:/);
  assert.match(html, /Secure checkout/);
  assert.doesNotMatch(html, /sh-nav|Skip to content/);
  const done = render("/booking/confirmed/x", React.createElement(header, { variant: "checkout", step: 3 }));
  assert.doesNotMatch(done, /aria-current="step"/);
});

test("contact page: contacts, hours and a labelled form with a hidden robot trap", () => {
  const html = render("/contact", React.createElement(contact));
  assert.match(html, /<h1>Contact us<\/h1>/);
  for (const label of ["Name", "Email", "Message"]) assert.match(html, new RegExp(`<label for="[^"]+">${label}`));
  assert.match(html, /href="tel:/);
  assert.match(html, /href="mailto:/);
  assert.match(html, /Opening hours/);
  assert.match(html, /class="cp-trap" aria-hidden="true"/);
});
