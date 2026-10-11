import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildPaymentReconciliationQuery } from "../src/api/paymentReconciliationQuery.js";

const page = fs.readFileSync(new URL("../src/pages/admin/AdminPaymentsControlCenter.jsx", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../src/api/adminApi.js", import.meta.url), "utf8");

test("payment reconciliation page consumes financial control-center fields", () => {
  for (const label of ["Channel", "Guest payment", "Collector", "Booking total", "Guest paid", "Guest balance", "OTA expected", "OTA received", "Payout", "Reconciliation"]) {
    assert.match(page, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(page, /row\.channel\?\.label/);
  assert.match(page, /row\.collector\?\.label/);
  assert.match(page, /row\.settlement\?\.status/);
  assert.match(page, /row\.reconciliation\?\.result/);
  assert.doesNotMatch(page, /Gateway and Invoice Status/);
  assert.doesNotMatch(page, /Pesapal Amount/);
});

test("payment reconciliation exposes one provider-neutral recheck action", () => {
  assert.match(api, /export const recheckPayment/);
  assert.match(api, /\/recheck`/);
});

test("payment reconciliation exposes read-only customer accounting preview", () => {
  assert.match(api, /export const previewCustomerPaymentPosting/);
  assert.match(api, /customer-payment-preview/);
  assert.match(page, /PaymentAccountingPreview/);
  assert.match(page, /Preview accounting eligibility/);
  assert.match(page, /Preview unavailable: no verified payment record/);
  assert.match(page, /eligibility\.blockers\?\.length/);
  assert.match(page, /eligibility\.blockers\.map\(label\)/);
});

test("payment reconciliation serializes only supported server-side filters and pagination", () => {
  const query = buildPaymentReconciliationQuery({
    page: 3,
    limit: 50,
    search: "GYG-42",
    channel: "GETYOURGUIDE",
    paymentStatus: "PAID",
    settlementStatus: "PENDING",
    reconciliationStatus: "NEEDS_REVIEW",
    currency: "USD",
    status: "PAYMENTS",
    sort: "bookingDate",
    order: "asc",
    collector: "GETYOURGUIDE",
    invoiceStatus: "PAID",
    bokunStatus: "CONFIRMED",
    fromDate: "2026-09-01",
    toDate: "2026-09-30"
  });
  assert.equal(query, "?page=3&limit=50&search=GYG-42&fromDate=2026-09-01&toDate=2026-09-30&channel=GETYOURGUIDE&paymentStatus=PAID&settlementStatus=PENDING&reconciliationStatus=NEEDS_REVIEW&currency=USD&status=PAYMENTS&sort=bookingDate&order=asc");
});

test("payment reconciliation search is debounced and all server-side filters reset pagination", () => {
  assert.match(page, /setTimeout\(\(\) => load\(\), filters\.search \? 350 : 0\)/);
  assert.match(page, /\[filters\.page, filters\.limit, filters\.search, filters\.fromDate, filters\.toDate, filters\.channel, filters\.paymentStatus, filters\.settlementStatus, filters\.reconciliationStatus, filters\.currency, filters\.sort, filters\.order\]/);
  assert.match(page, /const update = patch => setFilters\(current => \(\{ \.\.\.current, \.\.\.patch, \.\.\.\(patch\.page === undefined \? \{ page: 1 \} : \{\}\) \}\)\)/);
  assert.match(page, /Form\.Label>Currency/);
  assert.match(page, /Form\.Label>Sort by/);
  assert.match(page, /Form\.Label>Order/);
});

test("booking list defaults to ten rows and uses compact server pagination controls", () => {
  assert.match(page, /const defaultFilters = \{ page: 1, limit: 10/);
  assert.match(page, /ListingPagination/);
  assert.match(page, /Showing \{data\.total/);
  for (const size of [10, 25, 50, 100]) assert.match(page, new RegExp(`<option value="${size}">${size}</option>`));
  assert.match(page, /update\(\{ limit: Number\(event\.target\.value\), page: 1 \}\)/);
});
