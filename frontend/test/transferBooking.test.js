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
  goToPesapal,
  quoteRequestFor,
  recallBookingAccess,
  rememberBookingAccess,
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

test("step one is a search bar: trip type, places, date, time, travelers and Search Availability, with no price yet", async () => {
  const html = await render("/src/pages/public/TransfersPage.jsx", "/transfers");
  for (const label of ["Search for availability", "One Way", "Two Ways", "Pick-up location", "Drop-off location", "Travel date", "Pick-up time (EAT)", "Travelers", "1 Adult", "Search Availability", "Zanzibar time (EAT, UTC+3)"]) {
    assert.ok(html.includes(label), label);
  }
  assert.match(html, /<h1 id="transfer-step-heading" tabindex="-1" class="visually-hidden">Search for availability<\/h1>/);
  assert.match(html, /aria-current="step"/);
  assert.match(html, /role="combobox"/);
  // Five steps, the first current; the travelers panel stays closed until opened.
  for (const step of ["Search", "Vehicle", "Details", "Payment", "Confirmed"]) assert.ok(html.includes(`tw-progress-label">${step}<`), step);
  assert.match(html, /aria-haspopup="dialog" aria-expanded="false"/);
  // Point to Point is not offered until stops are built.
  assert.equal(html.includes("Point to Point"), false);
  // Personal details belong to a later step, and no price exists until the server quotes one.
  assert.equal(html.includes("Full name"), false);
  assert.equal(/USD \d/.test(html), false);
});

test("later steps cannot be opened from the address bar before the trip is complete", async () => {
  const html = await render("/src/pages/public/TransfersPage.jsx", "/transfers?step=pay");
  assert.ok(html.includes("Search Availability"));
  assert.equal(html.includes("Secure Online Payment"), false);
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
  // The booking horizon set in Transfer Admin, the luggage limits and an international phone number.
  assert.match(validateTransferForm(filled({ travelDate: "2099-06-01" }), now, { maxAdvanceDays: 10 }).travelDate, /up to 10 days ahead/);
  assert.equal(validateTransferForm(filled({ travelDate: "2099-05-11" }), now, { maxAdvanceDays: 10 }).travelDate, undefined);
  assert.ok(validateTransferForm(filled({ largeBags: 41 }), now).largeBags);
  assert.ok(validateTransferForm(filled({ smallBags: 1.5 }), now).smallBags);
  assert.match(validateTransferForm(filled({ phone: "0712 345 678" }), now).phone, /country code/);
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

const memoryStorage = () => {
  const items = new Map();
  return { getItem: (key) => (items.has(key) ? items.get(key) : null), setItem: (key, value) => items.set(key, String(value)) };
};

test("going to Pesapal keeps the private link for this tab only and sends the customer to Pesapal's page", async () => {
  const storage = memoryStorage();
  rememberBookingAccess("TRF-ABCDEFGH", "secret-token", storage);
  assert.equal(recallBookingAccess("TRF-ABCDEFGH", storage), "secret-token");
  assert.equal(recallBookingAccess("TRF-OTHERREF", storage), "", "a token is only recalled for its own booking");
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  rememberBookingAccess("TRF-ABCDEFGH", "secret-token", broken);
  assert.equal(recallBookingAccess("TRF-ABCDEFGH", broken), "");

  const visited = [];
  const started = [];
  await goToPesapal({ reference: "TRF-ABCDEFGH", accessToken: "secret-token", start: async (...args) => (started.push(args), { redirectUrl: "https://pay.pesapal.com/iframe/x" }), assign: (url) => visited.push(url) });
  assert.deepEqual(started, [["TRF-ABCDEFGH", "secret-token"]]);
  assert.deepEqual(visited, ["https://pay.pesapal.com/iframe/x"]);
  await assert.rejects(goToPesapal({ reference: "TRF-ABCDEFGH", accessToken: "t", start: async () => { throw new Error("Pesapal down"); }, assign: (url) => visited.push(url) }), /Pesapal down/);
  assert.equal(visited.length, 1, "nothing opens when the server could not start the payment");
});

test("the payment return page asks the server, never trusts the address bar, and is not indexed", async () => {
  const routes = read("src/routes/AppRoutes.jsx");
  assert.match(routes, /<Route path="\/transfers\/payment\/return" element=\{<TransferPaymentReturnPage \/>\} \/>/);
  assert.match(read("src/layouts/PublicLayout.jsx"), /\\\/transfers\\\/payment\\\//);
  const checking = await render("/src/pages/public/TransferPaymentReturnPage.jsx", "/transfers/payment/return?OrderTrackingId=abc&OrderMerchantReference=TRF-ABCDEFGH-1A2B3C4D&OrderNotificationType=CALLBACKURL");
  assert.match(checking, /Checking your payment with Pesapal/);
  assert.equal(checking.includes("Booking Confirmed!"), false, "nothing is shown as confirmed before the server has verified it");
  assert.equal(checking.includes("Paid"), false);
  assert.match(checking, /aria-current="step"/, "the progress stays on the payment step while checking");
  const missing = await render("/src/pages/public/TransferPaymentReturnPage.jsx", "/transfers/payment/return");
  assert.match(missing, /Payment not found/);
  const page = read("src/pages/public/TransferPaymentReturnPage.jsx");
  assert.match(page, /result\.booking\?\.paymentStatus === "PAID" && result\.payment\.outcome === "APPLIED"/);
});

test("the booking page offers Pesapal only when the server says the booking can be paid", () => {
  const page = read("src/pages/public/TransferBookingStatusPage.jsx");
  assert.match(page, /\{booking\.canPay \? \(/);
  assert.match(page, /goToPesapal\(\{ reference: booking\.reference, accessToken, start: startTransferPayment \}\)/);
  for (const offline of ["Cash on arrival", "Bank transfer", "Pay later"]) assert.equal(page.includes(offline), false, offline);
});

test("popular routes show the server's starting price, Price on Request when unpriced, and only configured inclusions", async () => {
  const { default: PopularRoutes, approxDuration } = await server.ssrLoadModule("/src/pages/public/transfers/PopularRoutes.jsx");
  const place = (id, name, type) => ({ id: id.repeat(24), name, type });
  const routes = [
    { slug: "airport-to-nungwi", title: "Zanzibar Airport to Nungwi", tripType: "ONE_WAY", pickup: place("a", "Zanzibar Airport", "AIRPORT"), dropoff: place("b", "Nungwi", "AREA"), inclusions: ["PRIVATE_VEHICLE"], durationMinutes: null, price: { status: "PRICED", from: "50.00", currency: "USD", basis: "PER_VEHICLE" } },
    { slug: "airport-to-paje", title: "Zanzibar Airport to Paje", tripType: "ONE_WAY", pickup: place("a", "Zanzibar Airport", "AIRPORT"), dropoff: place("c", "Paje", "AREA"), inclusions: ["PRIVATE_VEHICLE", "PROFESSIONAL_DRIVER"], durationMinutes: 75, price: { status: "QUOTE_REQUIRED", from: null, currency: "USD", basis: "PER_VEHICLE" } }
  ];
  const html = renderToStaticMarkup(React.createElement(PopularRoutes, { routes, state: "ready", onBook: () => {} }));
  for (const text of ["Popular Transfer Routes", "Book reliable private airport and hotel transfers across Zanzibar.", "Zanzibar Airport to Nungwi", "Private Transfer · One Way", "Pickup", "Drop-off", "USD 50.00", "per vehicle", "Price on Request", "Approx. 1 h 15 min", "Professional driver"]) {
    assert.ok(html.includes(text), text);
  }
  assert.equal((html.match(/Book Now/g) || []).length, 2);
  assert.equal((html.match(/Duration/g) || []).length, 1, "a duration appears only when the route has one");
  for (const invented of ["Fuel included", "Luggage assistance", "USD 35", "Free cancellation"]) assert.equal(html.includes(invented), false, invented);
  assert.equal(approxDuration(45), "Approx. 45 min");
  assert.equal(approxDuration(null), "");
  assert.equal(renderToStaticMarkup(React.createElement(PopularRoutes, { routes: [], state: "ready", onBook: () => {} })), "", "no section without routes");
});

test("Book Now fills the same widget with the route's places as a one-way trip, and ?route= links open it", () => {
  const page = read("src/pages/public/TransfersPage.jsx");
  assert.match(page, /tripType: TRIP_TYPES\.ONE_WAY,\s*pickupLocationId: route\.pickup\.id,\s*dropoffLocationId: route\.dropoff\.id,/);
  assert.match(page, /setParams\(\{ route: route\.slug \}\)/);
  assert.match(page, /document\.getElementById\("transfer-travelDate"\)\?\.focus/);
  assert.match(page, /const linkedRoute = params\.get\("route"\);/);
  assert.match(page, /<PopularRoutes routes=\{popular\.routes\} state=\{popular\.state\} onBook=\{bookRoute\} \/>/);
  // No second checkout: the cards only fill the search; prices and booking stay with the widget and the server.
  const cards = read("src/pages/public/transfers/PopularRoutes.jsx");
  for (const forbidden of ["createTransferBooking", "startTransferPayment", "fetchTransferQuote"]) assert.equal(cards.includes(forbidden), false, forbidden);
});

test("the travelers panel shows the agreed age bands, luggage and that infants need a seat", () => {
  // The panel opens on demand, so its contents are checked in the component.
  const fields = read("src/pages/public/transfers/fields.jsx");
  for (const text of ["12+ years", "4–11 years", "0–3 years, need a seat", "Large luggage", "Small luggage", "Infants need their own seat, so they count towards the vehicle&apos;s capacity."]) {
    assert.ok(fields.includes(text), text);
  }
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
