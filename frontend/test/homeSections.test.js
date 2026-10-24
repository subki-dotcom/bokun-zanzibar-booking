import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";

let server, home;
before(async () => {
  server = await createServer({ configFile: false, esbuild: { jsx: "automatic" }, server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: "custom" });
  home = await server.ssrLoadModule("/src/components/homePage/HomeSections.jsx");
});
after(async () => { await server?.close(); });

const render = (element) => renderToStaticMarkup(React.createElement(MemoryRouter, null, element));
const card = (overrides = {}) => ({
  id: "1", slug: "mnemba", title: "Mnemba snorkel", summary: "Snorkel at Mnemba.", image: "a.jpg", fromPrice: 70, currency: "USD",
  unit: "person", meta: ["3 hours", "Boat trip", "Hotel pickup"], badge: "Lunch included", rating: 0, reviewCount: 0, ...overrides
});

test("empty home data renders nothing instead of empty boxes", () => {
  assert.equal(render(React.createElement(home.CategoryTiles, { styles: [] })), "");
  assert.equal(render(React.createElement(home.FeaturedTours, { tours: [] })), "");
  assert.equal(render(React.createElement(home.BestSellers, { tours: [] })), "");
  assert.equal(render(React.createElement(home.SafariBanner, { safari: null })), "");
});

test("reviews and ratings only appear when real reviews exist", () => {
  assert.equal(render(React.createElement(home.ReviewsSection, { reviews: null })), "");
  assert.doesNotMatch(render(React.createElement(home.TourCard, { tour: card() })), /hp-rating/);
  assert.match(render(React.createElement(home.TourCard, { tour: card({ rating: 4.8, reviewCount: 12 }) })), /4\.8.*12 reviews/);
  const html = render(React.createElement(home.ReviewsSection, { reviews: { rating: 4.7, count: 31, source: "Tripadvisor", items: [] } }));
  assert.match(html, /31 reviews on Tripadvisor/);
});

test("style tiles show real counts, and transfers show their lowest price", () => {
  const html = render(React.createElement(home.CategoryTiles, {
    styles: [
      { key: "sea", label: "Sea tours", subtitle: "Mnemba", count: 15, image: "s.jpg" },
      { key: "transfers", label: "Transfers", subtitle: "Airport", count: 5, fromPrice: 11, currency: "USD", image: "t.jpg" }
    ]
  }));
  assert.match(html, /15 tours/);
  assert.match(html, /from \$11/);
  assert.match(html, /href="\/tours\?category=Sea%20tours"/);
});
