import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve("..", "frontend");
const pageSource = readFileSync(resolve(root, "src/pages/admin/AdminTrialBalancePage.jsx"), "utf8");
const routesSource = readFileSync(resolve(root, "src/routes/AppRoutes.jsx"), "utf8");
const apiSource = readFileSync(resolve(root, "src/api/adminApi.js"), "utf8");
const cssSource = readFileSync(resolve(root, "src/app/styles.css"), "utf8");
const ledgerServiceSource = readFileSync(resolve("..", "backend", "src/services/generalLedger/ledger.js"), "utf8");

test("trial balance route uses the dedicated production page", () => {
  assert.match(routesSource, /AdminTrialBalancePage/);
  assert.match(routesSource, /path="\/admin\/business-accounting\/trial-balance"/);
  assert.doesNotMatch(routesSource, /"\/admin\/business-accounting\/trial-balance",\s*"\/admin\/business-accounting\/accounts-receivable"/);
});

test("trial balance page uses canonical accounting APIs and no screenshot totals", () => {
  assert.match(apiSource, /fetchTrialBalance/);
  assert.match(pageSource, /fetchTrialBalance\(query\)/);
  assert.match(pageSource, /fetchAccountingHealth/);
  assert.match(ledgerServiceSource, /const rows = await summarizeAccounts\(\{ fromDate, toDate \}\)/);
  assert.doesNotMatch(pageSource, /458,720,000|Total Accounts[\s\S]*156/);
});

test("trial balance exposes opening, movement and closing accounting columns", () => {
  assert.match(pageSource, /Opening DR/);
  assert.match(pageSource, /Opening CR/);
  assert.match(pageSource, /Period DR/);
  assert.match(pageSource, /Period CR/);
  assert.match(pageSource, /Closing DR/);
  assert.match(pageSource, /Closing CR/);
  assert.match(pageSource, /summary\.hasData/);
  assert.match(pageSource, /No Data/);
  assert.match(pageSource, /summary\.baseCurrency/);
});

test("trial balance has filters, export and structural mobile layout", () => {
  assert.match(pageSource, /Search by account code or account name/);
  assert.match(pageSource, /downloadCsv/);
  assert.match(pageSource, /tb-mobile-list/);
  assert.match(pageSource, /tb-mobile-totals/);
  assert.match(cssSource, /\.tb-table-scroll/);
  assert.match(cssSource, /\.tb-mobile-card/);
  assert.match(cssSource, /@media \(max-width: 767px\)[\s\S]*\.tb-table-scroll[\s\S]*display: none/);
  assert.match(cssSource, /@media \(max-width: 374px\)[\s\S]*\.trial-balance-page/);
});
