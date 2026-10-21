// The redesigned Tour Bookings page (/admin/tour-admin/bookings): summary cards, filters, page sizes and the CSV
// export, rendered with the real routes and guards against an in-test Tour Operations server.
import test from "node:test";
import assert from "node:assert/strict";
import { createRenderHarness } from "./support/backOfficeRenderHarness.js";
import { TOUR_PERMISSIONS } from "../src/config/tourOperations.js";
import {
  bookingsCsv,
  datePresets,
  fetchAllPages,
  pageWindow,
  paymentStatusView,
  presetFor
} from "../src/components/admin/tourAdmin/tourBookingsView.js";

const TOUR_ADMIN = { id: "u-tour", fullName: "Tour Operator", email: "ops@example.test", role: "tour_admin", permissions: [TOUR_PERMISSIONS.OPERATIONS_READ, TOUR_PERMISSIONS.REQUESTS_READ] };
const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
const plusDays = (days) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

const booking = (n, overrides = {}) => ({
  id: `b${n}`, bookingReference: `ZNZ-17000000000${n}-100${n}`, origin: "WEBSITE", originBasis: "recorded", agentId: null,
  tour: { productTitle: n % 2 ? "Safari Blue" : "Prison Island", optionTitle: "Morning", travelDate: "2026-12-01", startTime: "09:30", pax: { adults: 2, children: 1, infants: 0, total: 3 } },
  customer: { firstName: "Jane", lastName: `Doe${n}`, email: `jane${n}@example.test`, phone: "+255700000001", country: "TZ", hotelName: "Hotel" },
  status: { booking: "confirmed", payment: "paid", supplier: "confirmed", supplierUpdatedAt: null, cancelledAt: null },
  supplierSync: { linkedToBokun: true, confirmationCode: "", bokunStatus: "confirmed", finalizationStatus: "", finalizationPending: false },
  createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z",
  ...overrides
});

// Totals for the summary cards, by the query each one sends.
const kpiTotal = (q) => {
  if (q.attention === "true") return 4;
  if (q.bookingStatus === "confirmed" && q.travelDateFrom === today) return 7;
  if (q.bookingStatus === "confirmed" && q.travelDateTo === plusDays(-1)) return 12;
  return null;
};

const defaultRoutes = () => ({
  "GET /auth/me": ({ user }) => user,
  "GET /tour-operations/bookings/products": () => ["Prison Island", "Safari Blue"],
  "GET /tour-operations/bookings": ({ query }) => {
    const q = Object.fromEntries(query.entries());
    if (q.limit === "1" && kpiTotal(q) !== null) return { items: [], page: 1, limit: 1, total: kpiTotal(q), hasMore: true };
    const all = Array.from({ length: 23 }, (_, index) => booking(index + 1));
    const filtered = q.productTitle ? all.filter((item) => item.tour.productTitle === q.productTitle) : all;
    const limit = Number(q.limit || 10);
    const page = Number(q.page || 1);
    return { items: filtered.slice((page - 1) * limit, page * limit), page, limit, total: filtered.length, hasMore: page * limit < filtered.length };
  }
});

// Tour Admin lives in the Website Tour Admin, so its pages render as the website mounts the admin.
const h = createRenderHarness({ websiteAdmin: true, defaultRoutes });
const { mount, text, waitFor, setValue, submit, click, button } = h;
const kpi = (label) => [...document.querySelectorAll(".tbk-kpi")].find((card) => card.textContent.includes(label))?.querySelector("strong")?.textContent;

test("summary cards are server totals: all bookings, confirmed in the next 30 days, needing attention, confirmed and past", async () => {
  await mount("/admin/tour-admin/bookings", TOUR_ADMIN);
  await waitFor(() => kpi("Completed Tours") === "12", "summary cards");
  assert.equal(kpi("Total Tours"), "23");
  assert.equal(kpi("Upcoming Tours"), "7");
  assert.equal(kpi("Needs Attention"), "4");
  const queries = h.calls.filter((call) => call.pathname === "/tour-operations/bookings" && call.query.get("limit") === "1").map((call) => Object.fromEntries(call.query.entries()));
  assert.ok(queries.some((q) => q.bookingStatus === "confirmed" && q.travelDateFrom === today && q.travelDateTo === plusDays(30)), "upcoming: confirmed, next 30 days");
  assert.ok(queries.some((q) => q.attention === "true"), "needs attention uses the server's definition");
  assert.ok(queries.some((q) => q.bookingStatus === "confirmed" && q.travelDateTo === plusDays(-1)), "completed: confirmed, travel date passed");
  // No create action: Tour Admin cannot create bookings.
  assert.doesNotMatch(document.querySelector(".tbk-head").textContent, /New Tour|Create/);
  assert.equal(document.querySelector(".tbk-head h1").textContent, "Tour Bookings");
  assert.equal(document.querySelector(".tbk-head p"), null, "no subtitle under the title");
});

test("a travel-date preset filters the list and the period cards; the tour filter uses the server's tours", async () => {
  await mount("/admin/tour-admin/bookings", TOUR_ADMIN);
  await waitFor(() => document.querySelectorAll(".tour-admin-bookings-table tbody tr").length === 10, "first page");
  assert.match(text(), /Showing 1–10 of 23 bookings/);
  await setValue(document.getElementById("tour-bookings-range"), "next-30");
  await waitFor(() => h.locationNow.includes(`travelDateFrom=${today}`) && h.locationNow.includes(`travelDateTo=${plusDays(30)}`), "range in the address bar");
  await waitFor(() => h.calls.some((call) => call.query.get("limit") === "1" && !call.query.get("bookingStatus") && !call.query.get("attention") && call.query.get("travelDateFrom") === today), "total card follows the range");

  await waitFor(() => document.querySelectorAll("#tour-bookings-product option").length === 3, "tour options");
  await setValue(document.getElementById("tour-bookings-product"), "Prison Island");
  await submit(document.querySelector(".tour-admin-filters"));
  await waitFor(() => h.calls.at(-1).query.get("productTitle") === "Prison Island", "tour filter sent");
  await waitFor(() => /Showing 1–10 of 11 bookings/.test(text()), "filtered total");
  assert.equal(h.calls.at(-1).query.get("travelDateFrom"), today, "filters work together");
});

test("export downloads every matching booking, not only the visible page", async () => {
  const downloads = [];
  const created = [];
  URL.createObjectURL = (blob) => { created.push(blob); return "blob:test"; };
  URL.revokeObjectURL = () => {};
  const click0 = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function recordDownload() { downloads.push(this.download); };
  try {
    await mount("/admin/tour-admin/bookings", TOUR_ADMIN);
    await waitFor(() => document.querySelectorAll(".tour-admin-bookings-table tbody tr").length === 10, "first page");
    await click(button("Export"));
    await waitFor(() => /Exported 23 bookings/.test(text()), "export done");
    assert.deepEqual(downloads, [`tour-bookings-${today}.csv`]);
    const csv = await created[0].text();
    assert.equal(csv.replace(/^﻿/, "").split("\r\n").length, 24, "header plus every booking");
    assert.ok(h.calls.some((call) => call.query.get("limit") === "100"), "pages of 100 for the export");
  } finally {
    window.HTMLAnchorElement.prototype.click = click0;
  }
});

test("labels, pager window, presets and CSV are built from the server's values", async () => {
  assert.equal(paymentStatusView("paid").label, "Paid");
  assert.equal(paymentStatusView("pending").label, "Unpaid");
  assert.equal(paymentStatusView("partial").label, "Partially paid");
  assert.equal(paymentStatusView("refunded").tone, "neutral");
  assert.deepEqual(pageWindow(1, 3), [1, 2, 3]);
  assert.deepEqual(pageWindow(9, 20), [7, 8, 9, 10, 11]);
  assert.deepEqual(pageWindow(20, 20), [16, 17, 18, 19, 20]);
  const presets = datePresets("2026-10-19");
  assert.deepEqual(presets.find((item) => item.id === "this-month"), { id: "this-month", label: "This month", from: "2026-10-01", to: "2026-10-31" });
  assert.equal(presetFor("", "", "2026-10-19"), "all");
  assert.equal(presetFor("2026-01-01", "2026-01-05", "2026-10-19"), "custom");

  const csv = bookingsCsv([booking(1, { customer: { firstName: "=HYPERLINK(\"x\")", lastName: "Doe, Jr", email: "a@b.test" } })]);
  const [header, row] = csv.split("\r\n");
  assert.match(header, /^Booking reference,Customer,Email/);
  assert.match(row, /"'=HYPERLINK\(""x""\) Doe, Jr"/, "formulas are neutralised and commas quoted");
  assert.match(row, /Not assigned$/);

  const pages = [];
  const result = await fetchAllPages(async (params) => { pages.push(params.page); return { items: Array.from({ length: params.page < 3 ? 100 : 20 }, () => ({})), hasMore: params.page < 3, total: 220 }; }, { search: "x" });
  assert.deepEqual(pages, [1, 2, 3]);
  assert.equal(result.rows.length, 220);
});
