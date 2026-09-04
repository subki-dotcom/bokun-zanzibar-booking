import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const pageSource = fs.readFileSync(
  path.join(process.cwd(), "src", "pages", "admin", "AdminBusinessAccountingPage.jsx"),
  "utf8"
);
const stylesSource = fs.readFileSync(path.join(process.cwd(), "src", "app", "styles.css"), "utf8");

test("management accounting dashboard uses the aggregated business accounting foundation contract", () => {
  assert.ok(pageSource.includes("fetchBusinessAccountingFoundation(query)"));
  assert.ok(pageSource.includes("Booking Net Contribution"));
  assert.ok(pageSource.includes("Other Business Income"));
  assert.ok(pageSource.includes("Company Expenses"));
  assert.ok(pageSource.includes("Company Net Profit"));
  assert.ok(pageSource.includes("Income vs Expenses"));
  assert.ok(pageSource.includes("Income Breakdown"));
  assert.ok(pageSource.includes("Expense Breakdown"));
  assert.ok(pageSource.includes("Recent Business Income"));
  assert.ok(pageSource.includes("Recent Business Expenses"));
  assert.ok(pageSource.includes("Source Link Strategy"));
});

test("management accounting dashboard keeps source strategy user-facing and supports real filters/export", () => {
  assert.ok(pageSource.includes("dateRange: period"));
  assert.ok(pageSource.includes("downloadCsv(foundation)"));
  assert.ok(pageSource.includes("SourceStrategy strategy={foundation?.sourceStrategy}"));
  assert.equal(pageSource.includes("fetchBusinessIncome({ limit: 10 })"), false);
  assert.equal(pageSource.includes("bookingAccountingFeedsBusinessAccounting"), false);
});

test("management accounting dashboard CSS includes responsive charts and mobile transaction cards", () => {
  assert.ok(stylesSource.includes(".management-accounting-kpi-grid"));
  assert.ok(stylesSource.includes(".management-accounting-analytics-grid"));
  assert.ok(stylesSource.includes(".management-accounting-mobile-transactions"));
  assert.ok(stylesSource.includes("@media (max-width: 767.98px)"));
  assert.ok(stylesSource.includes("@media (max-width: 360px)"));
  assert.ok(stylesSource.includes("grid-template-columns: 1fr"));
});
