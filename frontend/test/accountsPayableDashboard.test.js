import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve("..", "frontend");
const page = readFileSync(resolve(root, "src/pages/admin/AdminAccountsPayablePage.jsx"), "utf8");
const routes = readFileSync(resolve(root, "src/routes/AppRoutes.jsx"), "utf8");
const api = readFileSync(resolve(root, "src/api/adminApi.js"), "utf8");
const css = readFileSync(resolve(root, "src/app/styles.css"), "utf8");
const service = readFileSync(resolve("..", "backend/src/services/businessAccounting/index.js"), "utf8");

test("accounts payable route uses the dedicated production page", () => {
  assert.match(routes, /AdminAccountsPayablePage/);
  assert.match(routes, /path="\/admin\/business-accounting\/accounts-payable"/);
  assert.doesNotMatch(routes, /"\/admin\/business-accounting\/accounts-receivable",\s*"\/admin\/business-accounting\/accounts-payable"/);
});

test("accounts payable dashboard uses canonical business expense and GL APIs without screenshot data", () => {
  assert.match(api, /fetchAccountsPayableDashboard/);
  assert.match(api, /createBusinessExpense/);
  assert.match(page, /fetchAccountsPayableDashboard\(filters\)/);
  assert.match(service, /BusinessExpenseModel\.find\(query\)/);
  assert.match(service, /controlAccountCode: "2010"/);
  assert.doesNotMatch(page, /125,480,000|42,350,000|83,130,000|Zanzibar Supplies Co\./);
});

test("accounts payable page exposes accounting-specific register, reconciliation and safe actions", () => {
  assert.match(page, /Aging of Payables/);
  assert.match(page, /Payables by Supplier/);
  assert.match(page, /AP Subledger/);
  assert.match(page, /General Ledger AP/);
  assert.match(page, /New Bill \/ Invoice/);
  assert.doesNotMatch(page, /Record Payment/);
  assert.match(service, /recordSupplierPayment: false/);
});

test("accounts payable layout uses mobile bill cards and 320px-safe rules", () => {
  assert.match(page, /ap-mobile-list/);
  assert.match(css, /\.ap-table-wrap/);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*\.ap-table-wrap \{ display: none/);
  assert.match(css, /@media \(max-width: 374px\)[\s\S]*\.accounts-payable-page/);
});
