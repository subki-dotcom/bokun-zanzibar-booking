import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server.js";
import { createServer } from "vite";
import { sharedResolve } from "../../shared/vite.shared.js";
import {
  accessTokenFromHash,
  bookingLink,
  bookingPayloadFor,
  emptyTransferForm,
  quoteRequestFor,
  validateTransferForm,
  zanzibarToday
} from "../src/utils/transferBooking.js";

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const filled = (overrides = {}) => ({
  ...emptyTransferForm(),
  pickupLocationId: "a".repeat(24),
  dropoffLocationId: "b".repeat(24),
  travelDate: "2099-06-01",
  travelTime: "10:30",
  adults: 2,
  children: 1,
  infants: 1,
  fullName: "Jane Doe",
  email: "jane@example.com",
  phone: "+255 712 345 678",
  ...overrides
});

let server;
before(async () => {
  server = await createServer({ configFile: false, resolve: sharedResolve, esbuild: { jsx: "automatic" }, server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: "custom" });
});
after(async () => {
  await server?.close();
});

const render = async (file, location) => {
  const { default: Page } = await server.ssrLoadModule(file);
  return renderToStaticMarkup(React.createElement(StaticRouter, { location }, React.createElement(Page)));
};

test("the header lists Transfers after Tours and before My Booking, and the footer links to it", () => {
  const layout = read("src/layouts/PublicLayout.jsx");
  const tours = layout.indexOf('to="/tours"');
  const transfers = layout.indexOf('to="/transfers"');
  const myBooking = layout.indexOf('to="/my-booking"');
  assert.ok(tours > 0 && tours < transfers && transfers < myBooking);
  assert.match(read("src/components/common/footer/Footer.jsx"), /\{ label: "Transfers", to: "\/transfers" \}/);
  assert.match(layout, /\\\/transfers\\\/booking\\\//, "booking status pages are noindex");
});

test("transfer pages are lazy routes beside the unchanged tour routes", () => {
  const routes = read("src/routes/AppRoutes.jsx");
  assert.match(routes, /const TransfersPage = lazy\(\(\) => import\("\.\.\/pages\/public\/TransfersPage"\)\);/);
  assert.match(routes, /<Route path="\/transfers" element=\{<TransfersPage \/>\} \/>/);
  assert.match(routes, /<Route path="\/transfers\/booking\/:reference" element=\{<TransferBookingStatusPage \/>\} \/>/);
  for (const tourRoute of ['path="/tours"', 'path="/tours/:slug"', 'path="/booking/:slug"', 'path="/payment/checkout/:reference"']) assert.ok(routes.includes(tourRoute), tourRoute);
});

test("the booking form has every requested field", async () => {
  const html = await render("/src/pages/public/TransfersPage.jsx", "/transfers");
  for (const label of ["One way", "Round trip", "Pickup location", "Drop-off location", "Travel date", "Pickup time", "Adults", "Children", "Infants", "Large bags", "Small bags", "Other luggage", "Flight number", "Hotel / exact pickup address", "Full name", "Email", "Phone / WhatsApp", "This number is on WhatsApp", "Special requests"]) {
    assert.ok(html.includes(label), label);
  }
  assert.match(html, /<h1>Zanzibar airport &amp; hotel transfers<\/h1>/);
  assert.match(html, /aria-hidden="true"><label for="transfer-website">/, "honeypot is hidden from people");
  // No price exists until the server quotes one.
  assert.equal(/USD \d/.test(html), false);
  assert.match(html, /Request a Quote|Choose pickup, drop-off and passengers to see the price/);
});

test("the status page does not open a booking from the reference alone", async () => {
  const html = await render("/src/pages/public/TransferBookingStatusPage.jsx", "/transfers/booking/TRF-ABCDEFGH");
  assert.match(html, /a booking opens only from the private link/);
  assert.equal(html.includes("Loading your booking"), false);
});

test("a price request is built only from complete trip and passenger details", () => {
  assert.equal(quoteRequestFor(emptyTransferForm()), null);
  assert.equal(quoteRequestFor(filled({ dropoffLocationId: "a".repeat(24) })), null);
  assert.equal(quoteRequestFor(filled({ adults: 0 })), null);
  assert.deepEqual(quoteRequestFor(filled()), {
    tripType: "ONE_WAY",
    pickupLocationId: "a".repeat(24),
    dropoffLocationId: "b".repeat(24),
    passengers: { adults: 2, children: 1, infants: 1 }
  });
});

test("form validation covers schedule, passengers and contact details", () => {
  const now = new Date("2099-05-01T00:00:00Z");
  assert.deepEqual(validateTransferForm(filled(), now), {});
  const errors = validateTransferForm(filled({ travelDate: "2099-04-01", adults: 0, email: "x", phone: "12", fullName: "J", flightNumber: "not a flight" }), now);
  assert.deepEqual(Object.keys(errors).sort(), ["adults", "email", "flightNumber", "fullName", "phone", "travelDate"]);
  assert.ok(validateTransferForm(filled({ tripType: "ROUND_TRIP" }), now).returnDate);
  assert.ok(validateTransferForm(filled({ tripType: "ROUND_TRIP", returnDate: "2099-06-01", returnTime: "09:00" }), now).returnDate);
  assert.deepEqual(validateTransferForm(filled({ tripType: "ROUND_TRIP", returnDate: "2099-06-05", returnTime: "09:00" }), now), {});
});

test("the booking payload never carries a price, only the total the customer saw for the server to check", () => {
  const payload = bookingPayloadFor(filled(), { status: "PRICED", total: "45.00" });
  assert.equal(payload.expectedTotal, "45.00");
  assert.equal("price" in payload || "total" in payload, false);
  assert.equal(payload.returnDate, undefined);
  assert.equal(bookingPayloadFor(filled(), { status: "QUOTE_REQUIRED", total: null }).expectedTotal, null);
  const roundTrip = bookingPayloadFor(filled({ tripType: "ROUND_TRIP", returnDate: "2099-06-05", returnTime: "09:00" }), { status: "PRICED", total: "90.00" });
  assert.equal(roundTrip.returnDate, "2099-06-05");
  assert.equal(bookingPayloadFor(filled(), null).website, undefined);
});

test("the private link keeps the access token in the URL fragment", () => {
  const link = bookingLink("TRF-ABCDEFGH", "tok_en-123");
  assert.equal(link, "/transfers/booking/TRF-ABCDEFGH#t=tok_en-123");
  assert.equal(accessTokenFromHash("#t=tok_en-123"), "tok_en-123");
  assert.equal(accessTokenFromHash(""), "");
  assert.equal(zanzibarToday(new Date("2026-10-11T22:30:00Z")), "2026-10-12");
});

test("the form shows the agreed age bands and that infants need a seat", async () => {
  const html = await render("/src/pages/public/TransfersPage.jsx", "/transfers");
  assert.ok(html.includes("12+ years"));
  assert.ok(html.includes("4–11 years"));
  assert.ok(html.includes("0–3 years · need a seat in the vehicle"));
});

test("flight numbers accept real airline formats and stay optional", async () => {
  const { FLIGHT_NUMBER_PATTERN } = await import("../src/utils/transferBooking.js");
  for (const valid of ["PW 1234", "KQ-488", "TK0605", "5H123", "ET815A", "ATC123"]) assert.ok(FLIGHT_NUMBER_PATTERN.test(valid), valid);
  for (const invalid of ["HELLO", "PW  12", "-PW1"]) assert.equal(FLIGHT_NUMBER_PATTERN.test(invalid), false, invalid);
  const now = new Date("2099-05-01T00:00:00Z");
  assert.equal(validateTransferForm(filled({ flightNumber: "" }), now).flightNumber, undefined);
  assert.equal(validateTransferForm(filled({ flightNumber: "kq-488" }), now).flightNumber, undefined);
});

test("/transfers is in the static sitemap and the SEO prerender, which fetches nothing for it", () => {
  assert.match(read("public/sitemap.xml"), /<loc>https:\/\/zanzibartoursandsafaris\.co\.tz\/transfers<\/loc>/);
  const prerender = read("scripts/prerender-public-pages.mjs");
  assert.match(prerender, /await writePage\(template, "\/transfers", metadata\(\{/);
  assert.match(prerender, /`\$\{siteUrl\}\/transfers`, \.\.\.details/);
  const block = prerender.slice(prerender.indexOf('writePage(template, "/transfers"'), prerender.indexOf("for (const tour of details)"));
  assert.equal(/requestJson|fetch\(/.test(block), false);
});
