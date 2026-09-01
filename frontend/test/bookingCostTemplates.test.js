import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const source = fs.readFileSync(
  path.join(process.cwd(), "src", "pages", "admin", "BookingCostTemplates.jsx"),
  "utf8"
);

test("Booking cost template UI uses the real admin API helpers", () => {
  assert.ok(source.includes("fetchBookingAccountingCostTemplates"));
  assert.ok(source.includes("createBookingAccountingCostTemplate"));
  assert.ok(source.includes("updateBookingAccountingCostTemplate"));
  assert.ok(source.includes("previewBookingAccountingCostTemplate"));
  assert.ok(source.includes("syncBokunProductCatalog"));
  assert.equal(source.includes("Mnemba Snorkeling Tour"), false);
  assert.equal(source.includes("Product ID: 123456"), false);
});

test("Booking cost template UI includes mobile-specific option cards", () => {
  assert.ok(source.includes("cost-template-mobile-list"));
  assert.ok(source.includes("No Bokun product options match these filters."));
  assert.ok(source.includes("Add Cost"));
});

test("Booking cost template sync reloads all synced options instead of leaving filtered empty state", () => {
  assert.ok(source.includes("defaultDashboardFilters"));
  assert.ok(source.includes("Showing all synced options now."));
  assert.ok(source.includes("Show all synced options"));
  assert.ok(source.includes("filtersHideSyncedOptions"));
});
