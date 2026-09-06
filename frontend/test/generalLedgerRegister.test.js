import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve("..", "frontend");
const pageSource = readFileSync(resolve(root, "src/pages/admin/AdminGeneralLedgerRegisterPage.jsx"), "utf8");
const routesSource = readFileSync(resolve(root, "src/routes/AppRoutes.jsx"), "utf8");
const apiSource = readFileSync(resolve(root, "src/api/adminApi.js"), "utf8");
const cssSource = readFileSync(resolve(root, "src/app/styles.css"), "utf8");
const ledgerServiceSource = readFileSync(resolve("..", "backend", "src/services/generalLedger/ledger.js"), "utf8");

test("general ledger route uses the production register component", () => {
  assert.match(routesSource, /AdminGeneralLedgerRegisterPage/);
  assert.match(routesSource, /path="\/admin\/business-accounting\/general-ledger"/);
  assert.doesNotMatch(routesSource, /"\/admin\/business-accounting\/general-ledger",\s*"\/admin\/business-accounting\/trial-balance"/);
});

test("general ledger register is backed by existing accounting APIs", () => {
  assert.match(apiSource, /fetchGeneralLedger/);
  assert.match(pageSource, /fetchGeneralLedger\(query\)/);
  assert.match(pageSource, /fetchChartOfAccounts/);
  assert.match(pageSource, /fetchAccountingHealth/);
  assert.doesNotMatch(pageSource, /1,248|458,720,000|JE-2026-00042/);
});

test("general ledger register keeps accounting-sensitive balance behavior explicit", () => {
  assert.match(ledgerServiceSource, /runningBalance:\s*hasAccountContext[\s\S]*:\s*null/);
  assert.match(pageSource, /accountSummary/);
  assert.match(pageSource, /View by Account/);
  assert.match(pageSource, /Posted ledger lines/);
});

test("general ledger register supports filters, export and mobile cards", () => {
  assert.match(pageSource, /Search by account, journal, reference, description/);
  assert.match(pageSource, /sourceModule/);
  assert.match(pageSource, /journal/);
  assert.match(pageSource, /downloadCsv/);
  assert.match(pageSource, /gl-mobile-list/);
  assert.match(cssSource, /\.gl-table-scroll/);
  assert.match(cssSource, /\.gl-mobile-card/);
  assert.match(cssSource, /@media \(max-width: 767px\)[\s\S]*\.gl-table-scroll[\s\S]*display: none/);
  assert.match(cssSource, /@media \(max-width: 374px\)[\s\S]*\.general-ledger-register-page/);
});
