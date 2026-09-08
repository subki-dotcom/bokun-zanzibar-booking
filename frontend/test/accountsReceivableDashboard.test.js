import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve("..", "frontend");
const page = readFileSync(resolve(root, "src/pages/admin/AdminAccountsReceivablePage.jsx"), "utf8");
const routes = readFileSync(resolve(root, "src/routes/AppRoutes.jsx"), "utf8");
const api = readFileSync(resolve(root, "src/api/adminApi.js"), "utf8");
const css = readFileSync(resolve(root, "src/app/styles.css"), "utf8");
const service = readFileSync(resolve("..", "backend/src/services/businessAccounting/index.js"), "utf8");

test("accounts receivable route uses the dedicated production page", () => {
  assert.match(routes, /AdminAccountsReceivablePage/);
  assert.match(routes, /path="\/admin\/business-accounting\/accounts-receivable"/);
  assert.doesNotMatch(routes, /"\/admin\/business-accounting\/accounts-receivable",[\s\S]{0,120}AdminGeneralLedgerPage/);
});

test("AR dashboard uses invoice accounting and GL 1100 without screenshot data", () => {
  assert.match(api, /fetchAccountsReceivableDashboard/);
  assert.match(page, /fetchAccountsReceivableDashboard\(filters\)/);
  assert.match(service, /InvoiceModel\.find\(query\)/);
  assert.match(service, /controlAccountCode: "1100"/);
  assert.doesNotMatch(page, /368,450,000|142,300,000|Zanzibar Tours Ltd/);
});

test("AR page exposes receivables register, currency safety and safe capabilities", () => {
  assert.match(page, /Aging of Receivables/);
  assert.match(page, /Receivables by Customer/);
  assert.match(page, /AR Subledger/);
  assert.match(page, /General Ledger AR/);
  assert.match(service, /createStandaloneInvoice: false/);
  assert.match(service, /recordPayment: false/);
  assert.match(service, /AR_MIXED_REPORTING_CURRENCIES/);
});

test("AR layout replaces the table with mobile cards and supports 320px", () => {
  assert.match(page, /ap-mobile-list/);
  assert.match(css, /\.accounts-receivable-page/);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*\.ap-table-wrap \{ display: none/);
  assert.match(css, /@media \(max-width: 374px\)[\s\S]*\.accounts-receivable-page/);
});
