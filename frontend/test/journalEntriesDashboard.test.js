import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const pageSource = readFileSync(resolve(root, "src/pages/admin/AdminJournalEntriesPage.jsx"), "utf8");
const routesSource = readFileSync(resolve(root, "src/routes/AppRoutes.jsx"), "utf8");
const apiSource = readFileSync(resolve(root, "src/api/adminApi.js"), "utf8");
const cssSource = readFileSync(resolve(root, "src/app/styles.css"), "utf8");

test("journal entries route uses the production journal dashboard component", () => {
  assert.match(routesSource, /AdminJournalEntriesPage/);
  assert.match(routesSource, /path="\/admin\/business-accounting\/journal-entries"/);
  assert.match(pageSource, /Journal Entries/);
  assert.match(pageSource, /Record and manage financial transactions using double-entry accounting/);
});

test("journal entries dashboard is backed by existing accounting APIs", () => {
  assert.match(apiSource, /fetchGeneralLedgerJournals/);
  assert.match(apiSource, /createGeneralLedgerJournal/);
  assert.match(apiSource, /postGeneralLedgerJournal/);
  assert.match(apiSource, /reverseGeneralLedgerJournal/);
  assert.match(pageSource, /fetchGeneralLedgerJournals\(query\)/);
  assert.match(pageSource, /fetchChartOfAccounts/);
  assert.match(pageSource, /fetchAccountingHealth/);
  assert.doesNotMatch(pageSource, /JE-2026-00042/);
});

test("journal entries page exposes safe register controls and disables unsupported fake actions", () => {
  assert.match(pageSource, /Search by reference, description, account code or amount/);
  assert.match(pageSource, /includeLines:\s*true/);
  assert.match(pageSource, /Journal import requires a safe import preview service/);
  assert.match(pageSource, /Bulk posting requires a dedicated review flow/);
  assert.match(pageSource, /Posted entries should be reversed, not overwritten/);
  assert.doesNotMatch(pageSource, /Delete/);
});

test("journal entries CSS supports desktop table and mobile journal cards", () => {
  assert.match(cssSource, /\.journal-kpi-grid,\r?\n\.journal-skeleton-grid\s*\{/);
  assert.match(cssSource, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(cssSource, /\.journal-table-scroll\s*\{/);
  assert.match(cssSource, /\.journal-mobile-list\s*\{/);
  assert.match(cssSource, /@media \(max-width: 767px\)/);
  assert.match(cssSource, /@media \(max-width: 374px\)/);
  assert.match(cssSource, /\.journal-table-scroll\s*\{\r?\n\s*display: none;/);
});
