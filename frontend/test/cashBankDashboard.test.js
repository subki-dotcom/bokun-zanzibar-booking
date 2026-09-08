import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve("..", "frontend");
const page = readFileSync(resolve(root, "src/pages/admin/AdminCashBankPage.jsx"), "utf8");
const routes = readFileSync(resolve(root, "src/routes/AppRoutes.jsx"), "utf8");
const api = readFileSync(resolve(root, "src/api/adminApi.js"), "utf8");
const css = readFileSync(resolve(root, "src/app/styles.css"), "utf8");
const service = readFileSync(resolve("..", "backend/src/services/generalLedger/ledger.js"), "utf8");

test("cash and bank route uses the dedicated production page", () => {
  assert.match(routes, /AdminCashBankPage/);
  assert.match(routes, /path="\/admin\/business-accounting\/cash-bank"/);
  assert.doesNotMatch(routes, /"\/admin\/business-accounting\/cash-bank",[\s\S]{0,120}AdminGeneralLedgerPage/);
});

test("cash and bank page uses the GL-backed dashboard without screenshot values", () => {
  assert.match(api, /fetchCashBankDashboard/);
  assert.match(page, /fetchCashBankDashboard\(filters\)/);
  assert.match(service, /getCashBankDashboard/);
  assert.match(service, /JournalEntryLineModel\.find/);
  assert.doesNotMatch(page, /245,680,000|186,450,000|CRDB Bank - Main/);
});

test("cash movements exclude transfers and preserve currency boundaries", () => {
  assert.match(service, /PROVIDER_SETTLEMENT/);
  assert.match(service, /isInternalTransfer/);
  assert.match(service, /movementTotals/);
  assert.match(service, /mixedCurrencies/);
  assert.match(page, /Excludes internal transfers/);
  assert.match(page, /Separated by currency/);
});

test("unsupported money writes and statement reconciliation stay disabled", () => {
  assert.match(service, /createTransaction: false/);
  assert.match(service, /transfer: false/);
  assert.match(service, /reconcileStatement: false/);
  assert.match(page, /New Transaction/);
  assert.match(page, /Statement reconciliation is not available yet/);
});

test("cash and bank layout switches its register to mobile cards", () => {
  assert.match(page, /cb-mobile-list/);
  assert.match(css, /\.cash-bank-page/);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*\.cb-table-wrap \{ display: none/);
  assert.match(css, /@media \(max-width: 374px\)[\s\S]*\.cash-bank-page/);
});
