import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let server, PriceDisplay, AvailabilityOptionCard;
before(async () => {
  server = await createServer({ configFile: false, esbuild: { jsx: "automatic" }, server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true }, appType: "custom" });
  PriceDisplay = (await server.ssrLoadModule("/src/components/tours/single/PriceDisplay.jsx")).default;
  AvailabilityOptionCard = (await server.ssrLoadModule("/src/components/tours/single/availabilityPicker/AvailabilityOptionCard.jsx")).default;
});
after(async () => { await server?.close(); });

test("option displays a group price and its actual limit", () => {
  const html = renderToStaticMarkup(React.createElement(PriceDisplay, { amount: 20, pricingType: "per_group", maxPerBooking: 5 }));
  assert.match(html, />From</);
  assert.match(html, /\$20/);
  assert.match(html, /per group up to 5/);
  assert.doesNotMatch(html, /per person/);
});

test("availability cards distinguish group prices from per-person preview totals", () => {
  for (const [pricingType, total, label] of [["per_group", 20, "per group up to 5"], ["per_person", 60, "per person"]]) {
    const html = renderToStaticMarkup(React.createElement(AvailabilityOptionCard, { option: {
      name: "Transfer", liveAvailability: { lowestPriceForTwo: total, pricingType, maxPerBooking: 5, comparedAdults: 3, currency: "USD" }
    } }));
    assert.match(html, /From \$20/);
    assert.ok(html.includes(label));
  }
});

test("a selected per-person booking total is never labelled per person", () => {
  const html = renderToStaticMarkup(React.createElement(PriceDisplay, { amount: 60, pricingType: "per_person", mode: "live_total" }));
  assert.match(html, /Total for selected passengers/);
  assert.doesNotMatch(html, /per person|Starting from/);
});
