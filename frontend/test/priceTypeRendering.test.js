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

test("availability cards show the live total for the chosen party, group prices as one total", () => {
  for (const [pricingType, total, label] of [["per_group", 20, "Total $20.00 for your group"], ["per_person", 60, "Total $60.00 for 3 adults"]]) {
    const html = renderToStaticMarkup(React.createElement(AvailabilityOptionCard, { option: {
      name: "Transfer", liveAvailability: { lowestPriceForTwo: total, pricingType, maxPerBooking: 5, comparedAdults: 3, currency: "USD" }
    } }));
    assert.ok(html.includes(label), html);
    assert.doesNotMatch(html, /Select option/, "one button per option");
  }
});

test("availability cards pick the first start time so the guest can book at once", () => {
  const html = renderToStaticMarkup(React.createElement(AvailabilityOptionCard, { option: {
    name: "Dolphins", bokunOptionId: "1",
    liveAvailability: { lowestPriceForTwo: 170, pricingType: "per_person", comparedAdults: 1, currency: "USD", slots: [{ time: "06:00", status: "available", capacityLeft: 9, startTimeId: "a" }, { time: "07:00", status: "available", capacityLeft: 9, startTimeId: "b" }] }
  } }));
  assert.match(html, /<option value="a:06:00:0" selected="">06:00/);
  assert.match(html, /Book this option/);
  assert.doesNotMatch(html, /<button[^>]*disabled[^>]*>Book this option/);
});

test("a selected per-person booking total is never labelled per person", () => {
  const html = renderToStaticMarkup(React.createElement(PriceDisplay, { amount: 60, pricingType: "per_person", mode: "live_total" }));
  assert.match(html, /Total for selected passengers/);
  assert.doesNotMatch(html, /per person|Starting from/);
});
