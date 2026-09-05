import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const pageSource = readFileSync(resolve(root, "src/pages/admin/AdminChartOfAccountsPage.jsx"), "utf8");
const routesSource = readFileSync(resolve(root, "src/routes/AppRoutes.jsx"), "utf8");
const apiSource = readFileSync(resolve(root, "src/api/adminApi.js"), "utf8");
const cssSource = readFileSync(resolve(root, "src/app/styles.css"), "utf8");

test("chart of accounts route uses the production dashboard component", () => {
  assert.match(routesSource, /AdminChartOfAccountsPage/);
  assert.match(routesSource, /path="\/admin\/business-accounting\/chart-of-accounts"/);
  assert.doesNotMatch(pageSource, /Formal General Ledger/);
  assert.match(pageSource, /Chart of Accounts/);
  assert.match(pageSource, /Organize and manage your account structure/);
});

test("chart of accounts dashboard is backed by existing accounting APIs", () => {
  assert.match(apiSource, /export const fetchChartOfAccounts/);
  assert.match(apiSource, /export const createChartAccount/);
  assert.match(apiSource, /export const updateChartAccount/);
  assert.match(apiSource, /export const seedChartOfAccounts/);
  assert.match(pageSource, /fetchChartOfAccounts\(query\)/);
  assert.match(pageSource, /fetchAccountingHealth/);
  assert.match(pageSource, /fetchTrialBalance/);
  assert.doesNotMatch(pageSource, /156 accounts/);
});

test("chart of accounts dashboard implements real filters, pagination and safe actions", () => {
  assert.match(pageSource, /useSearchParams/);
  assert.match(pageSource, /Search by code, account name, description/);
  assert.match(pageSource, /systemAccount/);
  assert.match(pageSource, /hasParent/);
  assert.match(pageSource, /sortBy/);
  assert.match(pageSource, /Initialize Standard Accounts preview/);
  assert.match(pageSource, /disabled title="CSV\/Excel import requires import preview service"/);
  assert.doesNotMatch(pageSource, /Delete Account/);
});

test("chart of accounts CSS supports desktop cards and mobile account cards", () => {
  assert.match(cssSource, /\.coa-kpi-grid\s*\{/);
  assert.match(cssSource, /grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(cssSource, /\.coa-insight-grid\s*\{/);
  assert.match(cssSource, /\.coa-mobile-list\s*\{/);
  assert.match(cssSource, /@media \(max-width: 767px\)/);
  assert.match(cssSource, /@media \(max-width: 374px\)/);
  assert.match(cssSource, /\.coa-table-scroll\s*\{\s*display: none;/);
});
