import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { bookingAccountingModeFromPath } from "../src/pages/admin/bookingAccountingView.js";

const routesSource = fs.readFileSync(
  path.join(process.cwd(), "src", "routes", "AppRoutes.jsx"),
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
