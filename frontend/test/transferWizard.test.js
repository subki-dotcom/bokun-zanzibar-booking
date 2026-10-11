import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { sharedResolve } from "../../shared/vite.shared.js";
import { composePhone, emptyTransferForm, lastBookableDate } from "../src/utils/transferBooking.js";
import {
  DRAFT_KEY,
  PRIVATE_VEHICLE,
  STEPS,
  clearDraft,
  detailFieldsFor,
  furthestStep,
  loadDraft,
  relevantForm,
  saveDraft,
  stepErrors,
  stepIndex
} from "../src/utils/transferWizard.js";

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const now = new Date("2099-05-01T00:00:00Z");
const priced = { status: "PRICED", total: "45.00", legs: [{ direction: "OUTBOUND", price: "45.00" }] };
const roundTripPriced = { status: "PRICED", total: "90.00", legs: [{ direction: "OUTBOUND", price: "45.00" }, { direction: "RETURN", price: "45.00" }] };
const quoteRequired = { status: "QUOTE_REQUIRED", total: null, legs: [{ direction: "OUTBOUND", price: null }] };
const tripDone = (overrides = {}) => ({
  ...emptyTransferForm(),
  pickupLocationId: "a".repeat(24),
  dropoffLocationId: "b".repeat(24),
  travelDate: "2099-06-01",
  travelTime: "10:30",
  adults: 2,
  children: 1,
  largeBags: 2,
  smallBags: 1,
  ...overrides
});
const detailsDone = (overrides = {}) => tripDone({ vehicleOption: PRIVATE_VEHICLE, fullName: "Emma Johnson", email: "emma@example.com", phone: "+44 7700 900123", ...overrides });
const locations = [
  { id: "a".repeat(24), name: "Zanzibar Airport", type: "AIRPORT" },
  { id: "b".repeat(24), name: "Stone Town Hotel", type: "HOTEL" }
];

let server;
before(async () => {
  server = await createServer({ configFile: false, resolve: sharedResolve, esbuild: { jsx: "automatic" }, server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: "custom" });
});
after(async () => {
  await server?.close();
});

const renderStep = async (name, props) => {
  const steps = await server.ssrLoadModule("/src/pages/public/transfers/steps.jsx");
  return renderToStaticMarkup(React.createElement(steps[name], { set: () => () => {}, errors: {}, locations, ...props }));
};

test("the four steps are Trip, Vehicle, Details and Pay, and unknown step names open the first", () => {
  assert.deepEqual(STEPS.map((step) => step.label), ["Trip", "Vehicle", "Details", "Pay"]);
  assert.equal(stepIndex("pay"), 3);
  assert.equal(stepIndex("nonsense"), 0);
  assert.equal(stepIndex(null), 0);
});

test("each step checks only its own fields", () => {
  const trip = stepErrors(0, emptyTransferForm(), { now });
  assert.deepEqual(Object.keys(trip).sort(), ["dropoffLocationId", "pickupLocationId", "travelDate"]);
  assert.deepEqual(stepErrors(0, tripDone(), { now }), {}, "contact details are not asked for on step one");
  assert.ok(stepErrors(0, tripDone({ adults: 0 }), { now }).adults);
  assert.ok(stepErrors(0, tripDone({ largeBags: 50 }), { now }).largeBags);
  assert.ok(stepErrors(0, tripDone({ tripType: "ROUND_TRIP" }), { now }).returnDate);
  assert.ok(stepErrors(0, tripDone({ travelDate: "2099-06-01" }), { now, maxAdvanceDays: 7 }).travelDate);

  assert.ok(stepErrors(1, tripDone(), { quote: null }).vehicleOption, "no quote yet");
  assert.ok(stepErrors(1, tripDone(), { quote: priced }).vehicleOption, "a priced trip needs the vehicle chosen");
  assert.deepEqual(stepErrors(1, tripDone({ vehicleOption: PRIVATE_VEHICLE }), { quote: priced }), {});
  assert.deepEqual(stepErrors(1, tripDone(), { quote: quoteRequired }), {}, "a quote request needs no vehicle");

  assert.deepEqual(Object.keys(stepErrors(2, tripDone(), { now })).sort(), ["email", "fullName", "phone"]);
  assert.deepEqual(stepErrors(2, detailsDone(), { now }), {});
  assert.ok(stepErrors(2, detailsDone({ flightNumber: "HELLO" }), { now }).flightNumber);
});

test("the customer cannot skip ahead of the first unfinished step", () => {
  const ready = { now, quote: priced, quoteState: "ready" };
  assert.equal(furthestStep(emptyTransferForm(), ready), 0);
  assert.equal(furthestStep(tripDone(), { now, quote: null, quoteState: "loading" }), null, "waits for the quote instead of guessing");
  assert.equal(furthestStep(tripDone(), { now, quote: null, quoteState: "error" }), 1);
  assert.equal(furthestStep(tripDone(), ready), 1);
  assert.equal(furthestStep(tripDone({ vehicleOption: PRIVATE_VEHICLE }), ready), 2);
  assert.equal(furthestStep(detailsDone(), ready), 3);
  assert.equal(furthestStep(detailsDone({ vehicleOption: "" }), { now, quote: quoteRequired, quoteState: "ready" }), 3);
});

test("details follow the chosen places: flight for airports, addresses for hotels and areas", () => {
  assert.deepEqual(detailFieldsFor("AIRPORT", "HOTEL"), { flight: true, flightFirst: true, pickupAddress: false, dropoffAddress: true });
  assert.deepEqual(detailFieldsFor("HOTEL", "AIRPORT"), { flight: true, flightFirst: false, pickupAddress: true, dropoffAddress: false });
  assert.deepEqual(detailFieldsFor("PORT", "AREA"), { flight: false, flightFirst: false, pickupAddress: false, dropoffAddress: true });
  // Hidden details are not sent, and a one-way trip sends no return time.
  const sent = relevantForm(
    detailsDone({ flightNumber: "PW 1", pickupAddress: "left from earlier", dropoffAddress: "Emerson Spice", returnDate: "2099-06-09", returnTime: "08:00", phoneCountry: "+44", phoneNational: "7700 900123" }),
    detailFieldsFor("PORT", "HOTEL")
  );
  assert.equal(sent.flightNumber, "");
  assert.equal(sent.pickupAddress, "");
  assert.equal(sent.dropoffAddress, "Emerson Spice");
  assert.equal(sent.returnDate, "");
  assert.equal(sent.phone, "+44 7700 900123");
});

test("the phone is the country code plus the number, or a number typed with its own code", () => {
  assert.equal(composePhone("+44", " 7700 900123 "), "+44 7700 900123");
  assert.equal(composePhone("+255", "+1 555 0100"), "+1 555 0100");
  assert.equal(composePhone("", "0712 345 678"), "0712 345 678");
  assert.equal(lastBookableDate(730, new Date("2026-10-11T08:00:00Z")), "2028-10-10");
  assert.equal(lastBookableDate(undefined), "");
});

test("the draft survives a refresh in the same tab, never keeps the spam trap, and is cleared after booking", () => {
  const store = new Map();
  globalThis.window = { sessionStorage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) } };
  try {
    saveDraft(detailsDone({ website: "bot" }));
    assert.equal(JSON.parse(store.get(DRAFT_KEY)).website, undefined);
    const restored = loadDraft();
    assert.equal(restored.fullName, "Emma Johnson");
    assert.equal(restored.website, "");
    store.set(DRAFT_KEY, "{not json");
    assert.equal(loadDraft(), null);
    store.set(DRAFT_KEY, JSON.stringify({ adults: "lots", fullName: 7 }));
    assert.equal(loadDraft().adults, 1, "a damaged value falls back to the default");
    clearDraft();
    assert.equal(store.has(DRAFT_KEY), false);
  } finally {
    delete globalThis.window;
  }
  assert.equal(loadDraft(), null, "works without browser storage");
});

test("step two offers the priced private vehicle with the server's total, or a quote request", async () => {
  const pricedHtml = await renderStep("VehicleStep", { form: tripDone({ vehicleOption: PRIVATE_VEHICLE }), quote: roundTripPriced, quoteState: "ready" });
  assert.match(pricedHtml, /Choose your vehicle/);
  assert.match(pricedHtml, /Private vehicle/);
  assert.match(pricedHtml, /USD 90\.00/);
  assert.match(pricedHtml, /per vehicle, both ways/);
  assert.match(pricedHtml, /aria-checked="true"/);
  // No vehicle names, prices or service claims that the business has not configured.
  for (const invented of ["Sedan", "Minivan", "Minibus", "$25", "Free cancellation", "Meet and greet", "Flight tracking", "Air conditioning"]) {
    assert.equal(pricedHtml.includes(invented), false, invented);
  }
  const quoteHtml = await renderStep("VehicleStep", { form: tripDone(), quote: quoteRequired, quoteState: "ready" });
  assert.match(quoteHtml, /Request a Quote/);
  assert.match(quoteHtml, /secure link to pay online/);
  assert.equal(/USD \d/.test(quoteHtml), false);
});

test("step three asks for the flight first when the trip starts at the airport", async () => {
  const html = await renderStep("DetailsStep", { form: detailsDone(), fields: detailFieldsFor("AIRPORT", "HOTEL") });
  for (const label of ["Your details", "Full name", "Email address", "Phone", "Country code", "This number is on WhatsApp", "Flight number", "Hotel name or exact drop-off address", "Special requests"]) {
    assert.ok(html.includes(label), label);
  }
  assert.equal(html.includes("exact pickup address"), false, "an airport needs no pickup address");
  assert.ok(html.indexOf("Flight number") < html.indexOf("drop-off address"));
  assert.match(html, /type="email"/);
  assert.match(html, /type="tel"/);
  assert.match(html, /aria-hidden="true"><label for="transfer-website">/, "honeypot is hidden from people");
  // Extras are not sold until they are configured and priced on the server.
  for (const extra of ["Child seat", "Extra stop", "Extra luggage", "+$"]) assert.equal(html.includes(extra), false, extra);
});

test("step four is online payment only, and says so honestly before online payment opens", async () => {
  const props = { form: detailsDone(), quote: priced, quoteState: "ready", goTo: () => {}, fields: detailFieldsFor("AIRPORT", "HOTEL") };
  const closed = await renderStep("ReviewStep", { ...props, payment: { methods: ["PESAPAL"], onlineAvailable: false } });
  assert.match(closed, /Review and pay/);
  assert.match(closed, /Pay online with Pesapal/);
  assert.match(closed, /confirmed only after Pesapal confirms the payment/);
  assert.match(closed, /Online payment is not open yet/);
  assert.match(closed, /Nothing has been saved or charged/);
  for (const offline of ["Cash on arrival", "Bank transfer", "Pay later", "Pay on arrival"]) assert.equal(closed.toLowerCase().includes(offline.toLowerCase()), false, offline);
  assert.equal((closed.match(/aria-label="Edit /g) || []).length, 3, "trip, vehicle and details can each be edited");
  const open = await renderStep("ReviewStep", { ...props, payment: { methods: ["PESAPAL"], onlineAvailable: true } });
  assert.equal(open.includes("Online payment is not open yet"), false);
  const request = await renderStep("ReviewStep", { ...props, form: detailsDone({ vehicleOption: "" }), quote: quoteRequired, payment: { onlineAvailable: false } });
  assert.match(request, /Review your request/);
  assert.match(request, /No payment now/);
  assert.equal(request.includes("Online payment is not open yet"), false, "a quote request is not blocked by the payment phase");
});

test("the final button pays online or sends a quote request, and is disabled while online payment is closed", () => {
  const page = read("src/pages/public/TransfersPage.jsx");
  assert.match(page, /const canSubmit = !priced \|\| Boolean\(options\?\.payment\?\.onlineAvailable\);/);
  assert.match(page, /disabled=\{submitting \|\| quoteState !== "ready" \|\| !canSubmit\}/);
  assert.match(page, /`Pay \$\{formatUsd\(quote\.total\)\} with Pesapal`/);
  assert.match(page, /"Send quote request"/);
  // The price is checked with the server again right before the booking is created.
  assert.ok(page.indexOf("await fetchTransferQuote(quoteRequestFor(submitted))") < page.indexOf("await createTransferBooking(payload"));
  assert.match(page, /clearDraft\(\);\s*navigate\(bookingLink/);
});

test("the styles are mobile first, use tokens, and respect reduced motion", () => {
  const css = read("src/pages/public/transfers.css");
  assert.match(css, /--tw-teal-700:/);
  assert.match(css, /--tw-orange:/);
  assert.match(css, /--tw-touch: 44px;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  // Base styles are for phones; only very narrow phones (counters one per row) get a max-width rule.
  const wizard = css.slice(0, css.indexOf("Booking status page"));
  assert.deepEqual(wizard.match(/@media \(max-width[^)]*\)/g), ["@media (max-width: 399.98px)"]);
});
