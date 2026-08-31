import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const read = (relativePath) => readFileSync(resolve(root, relativePath), "utf8");

test("main admin dashboard reuses existing dashboard APIs and removes placeholder widgets", () => {
  const source = read("src/pages/admin/AdminDashboardPage.jsx");

  assert.match(source, /fetchDashboardSummary/);
  assert.match(source, /fetchRecentBookings/);
  assert.match(source, /fetchMonthlySalesReport/);
  assert.match(source, /fetchOperationalAlerts/);
  assert.match(source, /fetchOperationsOverview/);
  assert.match(source, /fetchBokunSyncStatus/);
  assert.doesNotMatch(source, /SalesChartPlaceholder/);
  assert.doesNotMatch(source, /KpiCards/);
  assert.doesNotMatch(source, /fetchConversionFunnel/);
});

test("main admin dashboard includes responsive production dashboard sections", () => {
  const source = read("src/pages/admin/AdminDashboardPage.jsx");
  const styles = read("src/app/styles.css");
  const layout = read("src/layouts/admin/AdminLayout.jsx");

  assert.match(source, /admin-dashboard-kpi-grid/);
  assert.match(source, /RecentBookingsWidget/);
  assert.match(source, /MonthlySalesWidget/);
  assert.match(source, /OperationalAlertsWidget/);
  assert.match(source, /Booking Source Breakdown/);
  assert.match(source, /Booking Status Overview/);
  assert.match(styles, /\.admin-dashboard-kpi-grid\s*{[\s\S]*grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.admin-dashboard-table-scroll\s*{\s*display: none;/);
  assert.match(styles, /@media \(max-width: 374px\)[\s\S]*\.admin-dashboard-kpi-grid\s*{\s*grid-template-columns: 1fr;/);
  assert.match(styles, /\.admin-platform-content\s*{[\s\S]*max-width: none;/);
  assert.match(layout, /document\.body\.style\.overflow = isMobileMenuOpen \? "hidden"/);
});
