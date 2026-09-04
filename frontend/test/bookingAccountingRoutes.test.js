import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { bookingAccountingModeFromPath } from "../src/pages/admin/bookingAccountingView.js";

const routesSource = fs.readFileSync(
  path.join(process.cwd(), "src", "routes", "AppRoutes.jsx"),
  "utf8"
);
const bookingAccountingPageSource = fs.readFileSync(
  path.join(process.cwd(), "src", "pages", "admin", "AdminBookingAccountingPage.jsx"),
  "utf8"
);
const stylesSource = fs.readFileSync(
  path.join(process.cwd(), "src", "app", "styles.css"),
  "utf8"
);

test("Booking Accounting mode resolver maps submenu routes", () => {
  assert.equal(bookingAccountingModeFromPath("/admin/booking-accounting/dashboard"), "dashboard");
  assert.equal(bookingAccountingModeFromPath("/admin/booking-accounting/invoices"), "invoices");
  assert.equal(bookingAccountingModeFromPath("/admin/booking-accounting/refunds"), "refunds");
  assert.equal(bookingAccountingModeFromPath("/admin/booking-accounting/expenses"), "expenses");
  assert.equal(bookingAccountingModeFromPath("/admin/booking-accounting/cost-templates"), "cost-templates");
  assert.equal(bookingAccountingModeFromPath("/admin/booking-accounting/cost-templates/new"), "cost-template-new");
  assert.equal(bookingAccountingModeFromPath("/admin/booking-accounting/cost-templates/template-1"), "cost-template-view");
  assert.equal(bookingAccountingModeFromPath("/admin/booking-accounting/cost-templates/template-1/edit"), "cost-template-edit");
  assert.equal(bookingAccountingModeFromPath("/admin/booking-accounting/profitability"), "profitability");
  assert.equal(bookingAccountingModeFromPath("/admin/booking-accounting/reconciliation"), "reconciliation");
});

test("Booking Accounting routes no longer point to AdminUnavailablePage placeholders", () => {
  const bookingAccountingRouteLines = routesSource
    .split(/\r?\n/)
    .filter((line) => line.includes("path=\"/admin/booking-accounting/"));

  assert.ok(bookingAccountingRouteLines.length >= 10);
  for (const line of bookingAccountingRouteLines) {
    assert.equal(line.includes("AdminUnavailablePage"), false, line.trim());
  }
  assert.ok(routesSource.includes("AdminBookingAccountingPage"));
});

test("Booking Accounting dashboard uses the aggregated financial dashboard contract", () => {
  assert.ok(bookingAccountingPageSource.includes("BookingAccountingDashboard"));
  assert.ok(bookingAccountingPageSource.includes("summaryKpis"));
  assert.ok(bookingAccountingPageSource.includes("secondaryKpis"));
  assert.ok(bookingAccountingPageSource.includes("recentBookingFinancials"));
  assert.ok(bookingAccountingPageSource.includes("Revenue vs Direct Costs"));
  assert.ok(bookingAccountingPageSource.includes("Revenue by Channel"));
  assert.ok(bookingAccountingPageSource.includes("Top Profitable Products"));
  assert.equal(bookingAccountingPageSource.includes("title=\"Recent Invoices\""), false);
});

test("Booking Accounting dashboard has mobile financial cards and small-screen rules", () => {
  assert.ok(stylesSource.includes(".booking-accounting-dashboard-mobile-financials"));
  assert.ok(stylesSource.includes("@media (max-width: 767.98px)"));
  assert.ok(stylesSource.includes("@media (max-width: 479.98px)"));
  assert.ok(stylesSource.includes("@media (max-width: 340px)"));
  assert.ok(stylesSource.includes("grid-template-columns: 1fr"));
});
