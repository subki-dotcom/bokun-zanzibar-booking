import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const read = (relativePath) => readFileSync(resolve(root, relativePath), "utf8");

test("admin bookings page uses the existing route with server-backed pagination and filters", () => {
  const source = read("src/pages/admin/AdminBookingsPage.jsx");
  const api = read("src/api/bookingsApi.js");

  assert.match(source, /fetchAdminBookings/);
  assert.match(source, /useSearchParams/);
  assert.match(source, /admin-bookings-filter-card/);
  assert.match(source, /admin-bookings-pagination/);
  assert.match(source, /setSearchParams/);
  assert.match(api, /fetchAdminBookings/);
  assert.match(api, /paginated", "true"/);
  assert.match(api, /\/bookings\/recent\?/);
});

test("admin bookings redesign has mobile cards and filter sheet instead of a phone table", () => {
  const source = read("src/pages/admin/AdminBookingsPage.jsx");
  const styles = read("src/app/styles.css");

  assert.match(source, /MobileBookingsList/);
  assert.match(source, /admin-bookings-mobile-card/);
  assert.match(source, /admin-bookings-filter-sheet/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.admin-bookings-table-scroll\s*{\s*display: none;/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.admin-bookings-mobile-list\s*{\s*display: grid;/);
  assert.match(styles, /@media \(max-width: 374px\)[\s\S]*\.admin-bookings-metric-grid\s*{\s*grid-template-columns: 1fr;/);
});
