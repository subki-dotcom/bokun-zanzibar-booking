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

test("tour reviews from Tripadvisor say so and link to them", () => {
  const html = renderToStaticMarkup(React.createElement(sections.Reviews, {
    rating: 4.7,
    reviewCount: 18,
    source: "Tripadvisor",
    url: "https://www.tripadvisor.co.uk/AttractionProductReview-g1-d2-Dolphins.html"
  }));
  assert.match(html, /4\.7/);
  assert.match(html, /18 reviews on Tripadvisor/);
  assert.match(html, /href="https:\/\/www\.tripadvisor\.co\.uk\/AttractionProductReview[^"]*" target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /verified/);
  const empty = renderToStaticMarkup(React.createElement(sections.Reviews, { rating: 0, reviewCount: 0 }));
  assert.match(empty, /No reviews yet/);
});

test("a tour whose Tripadvisor page has reviews but no score shows the count and a link, without stars", () => {
  const html = renderToStaticMarkup(React.createElement(sections.Reviews, {
    rating: 0,
    reviewCount: 0,
    listing: { url: "https://www.tripadvisor.com/AttractionProductReview-g1-d2-Mikumi.html", rating: 0, reviewCount: 1, scope: "product" }
  }));
  assert.match(html, /1 review on Tripadvisor/);
  assert.match(html, /Read it on Tripadvisor/);
  assert.doesNotMatch(html, /No reviews yet|tp-score/);
  const company = renderToStaticMarkup(React.createElement(sections.Reviews, {
    listing: { url: "https://www.tripadvisor.com/Attraction_Review-company.html", rating: 4.5, reviewCount: 19, scope: "company" }
  }));
  assert.match(company, /No reviews yet/);
});

test("ratings from another site are not marked up as the agency's own", async () => {
  const site = await server.ssrLoadModule("/src/config/site.js");
  assert.equal(site.travelAgencySchema({ rating: 4.5, count: 19, source: "Tripadvisor" }).aggregateRating, undefined);
  assert.equal(site.travelAgencySchema({ rating: 4.8, count: 20 }).aggregateRating.ratingValue, 4.8);
});
