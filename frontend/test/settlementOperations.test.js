import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const detail = fs.readFileSync(new URL("../src/pages/admin/AdminSettlementDetailPage.jsx", import.meta.url), "utf8");
const importer = fs.readFileSync(new URL("../src/pages/admin/AdminSettlementImportPage.jsx", import.meta.url), "utf8");
const routes = fs.readFileSync(new URL("../src/routes/AppRoutes.jsx", import.meta.url), "utf8");

test("settlement detail exposes allocation reversal and audit history", () => {
  assert.match(routes, /settlements\/:settlementId/);
  for (const text of ["Expected Net", "Allocated", "Unallocated", "Add Allocation", "Reverse", "Audit History"]) assert.match(detail, new RegExp(text));
});

test("settlement import requires preview before commit", () => {
  assert.match(importer, /Preview Import/);
  assert.match(importer, /preview\.token/);
  assert.match(importer, /Commit Valid Rows/);
  assert.match(importer, /row\.classification/);
});
