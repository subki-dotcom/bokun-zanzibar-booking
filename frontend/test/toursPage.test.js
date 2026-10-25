import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";

let server, results, filtersUi, card;
before(async () => {
  server = await createServer({ configFile: false, esbuild: { jsx: "automatic" }, server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: "custom" });
  results = await server.ssrLoadModule("/src/components/tours/toursPage/ToursResults.jsx");
  filtersUi = await server.ssrLoadModule("/src/components/tours/toursPage/ToursFilters.jsx");
  card = (await server.ssrLoadModule("/src/components/tours/toursPage/TourCard.jsx")).default;
});
after(async () => { await server?.close(); });

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
const render = (element) => quiet(() => renderToStaticMarkup(React.createElement(MemoryRouter, null, element)));
const filters = { category: "sea", q: "", duration: [], time: [], good: [], priceMin: 0, priceMax: 0, sort: "price_asc", date: "", pax: 2, page: 2 };

test("page links keep the filters and work without JavaScript; progress is shown", () => {
  const html = render(React.createElement(results.LoadMore, { filters, shown: 18, total: 30, pages: 4, loadMore: () => {} }));
  assert.match(html, /You(&#x27;|')ve seen 18 of 30 tours/);
  assert.match(html, /href="\/tours\?category=sea&amp;sort=price_asc&amp;page=3"/);
  assert.match(html, /aria-current="page"[^>]*>2</);
  assert.match(html, /Show more tours/);
  assert.equal(render(React.createElement(results.LoadMore, { filters, shown: 0, total: 0, pages: 1 })), "");
});

test("sort pills mark the current order; other orders sit under More", () => {
  const html = render(React.createElement(results.SortPills, { value: "price_asc", onChange: () => {} }));
  assert.match(html, /aria-pressed="true"[^>]*>Price: low to high/);
  assert.match(html, /<option value="title_asc">Title A–Z<\/option>/);
});

test("the price slider can be used with a keyboard and says the price", () => {
  const html = render(React.createElement(filtersUi.PriceRangeFilter, { range: { min: 15, max: 5350 }, min: 0, max: 0, onChange: () => {} }));
  assert.match(html, /<legend>Price per person<\/legend>/);
  assert.match(html, /aria-label="Lowest price"[^>]*aria-valuetext="\$15"/);
  assert.match(html, /aria-label="Highest price"[^>]*aria-valuetext="\$500\+"/);
});

test("a card is one link to the tour, with the heart outside it and no rating without reviews", () => {
  const tour = { id: "1", slug: "mnemba", title: "Mnemba", image: "a.jpg", fromPrice: 70, currency: "USD", unit: "person", duration: "3 hours", meta: "Hotel pickup", freeCancellation: true, category: { key: "sea", label: "Sea tour" }, reviewCount: 0, rating: 0 };
  const html = render(React.createElement(card, { tour }));
  assert.equal((html.match(/<a /g) || []).length, 1);
  assert.match(html, /<\/a><button[^>]*aria-label="Save Mnemba to your wishlist"/);
  assert.match(html, /New on our site/);
  assert.match(html, /Free cancellation/);
});

test("no results: clear filters and WhatsApp", () => {
  const html = render(React.createElement(results.EmptyState, { onClear: () => {} }));
  assert.match(html, /No tours match these filters/);
  assert.match(html, /Clear filters/);
  assert.match(html, /wa\.me/);
});

test("phones: Filters shows how many are on; Sort says the order in short", async () => {
  const mobile = await server.ssrLoadModule("/src/components/tours/toursPage/ToursMobile.jsx");
  const html = render(React.createElement(mobile.MobileFilterBar, {
    filters: { ...filters, duration: ["half-day"], good: ["lunch"], sort: "price_desc" },
    onFilters: () => {},
    onSort: () => {},
    onDate: () => {}
  }));
  assert.match(html, /aria-label="2 on">2</);
  assert.match(html, /Sort: Highest price/);
  assert.match(html, /aria-label="Choose a date"/);
});
