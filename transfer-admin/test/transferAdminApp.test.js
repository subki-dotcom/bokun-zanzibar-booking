import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server.js";
import { createServer } from "vite";
import { sharedResolve } from "../../shared/vite.shared.js";
import { navigationFor, can, P } from "../src/lib/permissions.js";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

// Server permissions per role (mirrors backend/src/transfers/security/permissions.js).
const ROLE_PERMISSIONS = {
  transfer_admin: ["transfer.users.manage", "transfer.pricing.view", "transfer.pricing.manage", "transfer.audit.view", "transfer.bookings.view", "transfer.bookings.manage", "transfer.dispatch.manage", "transfer.fleet.view", "transfer.fleet.manage", "transfer.payments.view", "transfer.payments.manage"],
  transfer_manager: ["transfer.pricing.view", "transfer.bookings.view", "transfer.bookings.manage", "transfer.dispatch.manage", "transfer.fleet.view", "transfer.fleet.manage"],
  dispatcher: ["transfer.bookings.view", "transfer.dispatch.manage", "transfer.fleet.view"],
  transfer_accountant: ["transfer.pricing.view", "transfer.bookings.view", "transfer.payments.view", "transfer.payments.manage"]
};
const userWith = (role) => ({ role, permissions: ROLE_PERMISSIONS[role] });
const labels = (role) => navigationFor(userWith(role)).map((item) => item.label || `[${item.section}]`);

const storage = new Map();
globalThis.sessionStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) };
globalThis.window = globalThis.window || { sessionStorage: globalThis.sessionStorage, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };

let server;
before(async () => {
  server = await createServer({ configFile: false, resolve: sharedResolve, esbuild: { jsx: "automatic" }, server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: "custom" });
});
after(async () => {
  await server?.close();
});

test("navigation shows each role only what it may open", () => {
  assert.deepEqual(labels("transfer_admin"), ["Dashboard", "Bookings", "[Operations]", "Dispatch", "Drivers", "Vehicles", "[Pricing]", "Zones", "Locations", "Routes", "Rates & price check", "Popular routes", "Booking settings", "[Administration]", "Users & roles", "Audit log"]);
  assert.deepEqual(labels("transfer_manager"), ["Dashboard", "Bookings", "[Operations]", "Dispatch", "Drivers", "Vehicles", "[Pricing]", "Zones", "Locations", "Routes", "Rates & price check", "Popular routes", "Booking settings"]);
  assert.deepEqual(labels("dispatcher"), ["Dashboard", "Bookings", "[Operations]", "Dispatch", "Drivers", "Vehicles"]);
  assert.deepEqual(labels("transfer_accountant"), ["Dashboard", "Bookings", "[Pricing]", "Zones", "Locations", "Routes", "Rates & price check", "Popular routes", "Booking settings"]);
  assert.equal(can(userWith("transfer_manager"), P.PRICING_MANAGE), false);
  assert.equal(can(null, P.BOOKINGS_VIEW), false);
});

test("every page route is guarded by the permission the server enforces", () => {
  const routes = read("src/routes/AppRoutes.jsx");
  for (const [routePath, permission] of [
    ["/bookings", "BOOKINGS_VIEW"], ["/bookings/:bookingId", "BOOKINGS_VIEW"], ["/pricing/zones", "PRICING_VIEW"],
    ["/pricing/locations", "PRICING_VIEW"], ["/pricing/routes", "PRICING_VIEW"], ["/pricing/rates", "PRICING_VIEW"], ["/pricing/popular-routes", "PRICING_VIEW"], ["/pricing/settings", "PRICING_VIEW"],
    ["/users", "USERS_MANAGE"], ["/audit", "AUDIT_VIEW"], ["/dispatch", "FLEET_VIEW"], ["/fleet/drivers", "FLEET_VIEW"], ["/fleet/vehicles", "FLEET_VIEW"]
  ]) {
    assert.ok(routes.includes(`path="${routePath}" element={guarded(P.${permission},`), routePath);
  }
  assert.match(routes, /<RequireAuth>\s*<AdminLayout \/>/);
});

test("Transfer Admin cannot create bookings or approve cash on arrival anywhere in the app", () => {
  const files = walk(path.join(root, "src")).filter((file) => /\.jsx?$/.test(file));
  const source = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  assert.equal(fs.existsSync(path.join(root, "src/pages/NewBookingPage.jsx")), false);
  assert.equal(fs.existsSync(path.join(root, "src/lib/manualBooking.js")), false);
  for (const banned of ["/bookings/new", "New booking", "createManualBooking", "approveCashOnArrival", "approve-cash-on-arrival", "Approve cash", "cashToCollect", "client.post(\"/bookings\""]) {
    assert.equal(source.includes(banned), false, banned);
  }
  // Older cash-on-arrival and staff-entered records stay readable and are labelled as legacy.
  assert.match(read("src/lib/format.js"), /CASH_ON_ARRIVAL: "Cash on arrival \(legacy\)"/);
  assert.match(read("src/pages/BookingsPage.jsx"), /Staff-entered \(legacy\)/);
});

test("payments are shown to roles that may see them, and staff can only ask Pesapal again, never mark paid", () => {
  const detail = read("src/pages/BookingDetailPage.jsx");
  assert.ok(detail.includes("{can(user, P.PAYMENTS_VIEW) ? <BookingPayments bookingId={booking.id} onChanged={reload} /> : null}"));
  const payments = read("src/components/payments.jsx");
  assert.ok(payments.includes("const manage = can(user, P.PAYMENTS_MANAGE);"));
  assert.ok(payments.includes("{manage && payment.orderTrackingId ? ("));
  assert.equal(can(userWith("transfer_accountant"), P.PAYMENTS_MANAGE), true);
  assert.equal(can(userWith("transfer_manager"), P.PAYMENTS_VIEW), false);
  assert.equal(can(userWith("dispatcher"), P.PAYMENTS_VIEW), false);
  for (const file of walk(path.join(root, "src"))) {
    const source = fs.readFileSync(file, "utf8");
    assert.equal(/mark(ed)?[ _-]?(as[ _-]?)?paid|markPaid|\/mark-paid/i.test(source), false, path.relative(root, file));
  }
});

test("the login page belongs to the Transfer Admin only", async () => {
  const { AuthProvider } = await server.ssrLoadModule("/src/auth/AuthContext.jsx");
  const { default: LoginPage } = await server.ssrLoadModule("/src/pages/LoginPage.jsx");
  const html = renderToStaticMarkup(React.createElement(AuthProvider, null, React.createElement(StaticRouter, { location: "/login" }, React.createElement(LoginPage))));
  assert.match(html, /Transfer Admin/);
  assert.match(html, /separate from the Back Office and the agent portal/);
  assert.match(html, /autoComplete="current-password"|autocomplete="current-password"/);
});

test("the session token is kept per tab and sent only to the Transfer Admin API", () => {
  const client = read("src/api/client.js");
  assert.match(client, /window\.sessionStorage/);
  assert.match(client, /riser_transfer_admin_token/);
  assert.match(client, /baseURL: `\$\{API_BASE_URL\}\/transfer-admin`/);
  assert.equal(/localStorage/.test(client), false);
});

test("the dashboard labels unpaid amounts as not revenue", () => {
  const dashboard = read("src/pages/DashboardPage.jsx");
  assert.match(dashboard, /not revenue until paid/);
  assert.match(dashboard, /Paid revenue counts only payments verified by the server/);
  assert.match(dashboard, /data\.paidRevenue\.amount/);
});

test("trip actions send the version the user saw and hide for users without dispatch rights", () => {
  const trips = read("src/components/trips.jsx");
  for (const snippet of ["if (!can(user, P.DISPATCH_MANAGE)) return null;", "if (!trip.dispatchable)", "minSeats: trip.seatsNeeded"]) {
    assert.ok(trips.includes(snippet), snippet);
  }
  // Assign, unassign and both status calls all carry the version.
  assert.equal(trips.split("expectedVersion: trip.version").length - 1, 4);
});

test("the app is independent: its own port and never imports website, Back Office or agent code", () => {
  const config = read("vite.config.js");
  assert.match(config, /port: 5175/);
  assert.match(config, /strictPort: true/);
  assert.match(read("index.html"), /<meta name="robots" content="noindex, nofollow" \/>/);
  const offenders = walk(path.join(root, "src"))
    .filter((file) => /\.(jsx?|css)$/.test(file))
    .filter((file) => /from\s+["'][^"']*(frontend|backoffice)\//.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
  // No price is written into the app: prices come from the server.
  const priced = walk(path.join(root, "src")).filter((file) => /USD\s*\d|price:\s*["']?\d/.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(priced, []);
});
