import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let server, sections;
before(async () => {
  server = await createServer({ configFile: false, esbuild: { jsx: "automatic" }, server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: "custom" });
  sections = await server.ssrLoadModule("/src/components/tours/tourPage/TourSections.jsx");
});
after(async () => { await server?.close(); });

const stops = [
  { title: "Kizimkazi", description: "Early-morning boat trip to see dolphins.", image: "k.jpg", meta: [] },
  { title: "Salaam Cave", description: "Swim with rescued sea turtles.", image: "s.jpg", meta: [] },
  { title: "Jozani Forest", description: "Red Colobus monkeys and the mangrove boardwalk.", image: "j.jpg", meta: [] },
  { title: "Beach", description: "Free time on the beach.", image: "", meta: [] }
];

test("itinerary stops show their description on phones as well as desktop", () => {
  const phone = renderToStaticMarkup(React.createElement(sections.ItineraryTimeline, { stops, compact: true }));
  assert.match(phone, /Early-morning boat trip to see dolphins\./);
  assert.match(phone, /Red Colobus monkeys/);
  // Phones show the first three stops until "See full itinerary".
  assert.doesNotMatch(phone, /Free time on the beach/);
  assert.match(phone, /See full itinerary/);
  const desktop = renderToStaticMarkup(React.createElement(sections.ItineraryTimeline, { stops, hasPickup: true }));
  assert.match(desktop, /Free time on the beach/);
  assert.match(desktop, /Pickup from your hotel/);
});
