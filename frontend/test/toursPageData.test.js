import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";

let server, data;
before(async () => {
  server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: "custom" });
  data = await server.ssrLoadModule("/src/components/tours/toursPage/toursPageData.js");
});
after(async () => { await server?.close(); });

test("the address becomes filters, older links included", () => {
  const filters = data.readFilters(new URLSearchParams("category=Sea%20tours&duration=half-day,full-day&price=20-300&sort=price_asc&q=mnemba&travelDate=2026-11-10&travelers=3&page=2"));
  assert.equal(filters.category, "sea");
  assert.deepEqual(filters.duration, ["half-day", "full-day"]);
  assert.equal(filters.priceMin, 20);
  assert.equal(filters.priceMax, 300);
  assert.equal(filters.sort, "price_asc");
  assert.equal(filters.date, "2026-11-10");
  assert.equal(filters.pax, 3);
  assert.equal(filters.page, 2);
  const plain = data.readFilters(new URLSearchParams("sort=bogus&date=tomorrow&pax=99"));
  assert.equal(plain.sort, "recommended");
  assert.equal(plain.date, "");
  assert.equal(plain.pax, 20);
});

test("filters become a clean address and a server query", () => {
  const filters = data.readFilters(new URLSearchParams("category=cultural&good=pickup,lunch&price=0-150"));
  assert.equal(data.writeFilters(filters).toString(), "category=cultural&price=0-150&good=pickup%2Clunch");
  assert.equal(data.writeFilters(data.readFilters(new URLSearchParams(""))).toString(), "");
  assert.deepEqual(data.apiQuery(filters, { page: 2, limit: 9 }), { page: "2", limit: "9", category: "cultural", good: "pickup,lunch", price: "0-150" });
  assert.equal(data.activeFilterCount(filters), 3);
  assert.equal(data.resultsKey({ ...filters, page: 1 }), data.resultsKey({ ...filters, page: 4 }));
});
