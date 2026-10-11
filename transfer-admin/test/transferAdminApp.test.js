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
import { buildManualBooking, quoteRequestFor } from "../src/lib/manualBooking.js";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

// Server permissions per role (mirrors backend/src/transfers/security/permissions.js).
const ROLE_PERMISSIONS = {
  transfer_admin: ["transfer.users.manage", "transfer.pricing.view", "transfer.pricing.manage", "transfer.audit.view", "transfer.bookings.view", "transfer.bookings.manage", "transfer.dispatch.manage", "transfer.fleet.view", "transfer.fleet.manage"],
  transfer_manager: ["transfer.pricing.view", "transfer.bookings.view", "transfer.bookings.manage", "transfer.dispatch.manage", "transfer.fleet.view", "transfer.fleet.manage"],
  dispatcher: ["transfer.bookings.view", "transfer.dispatch.manage", "transfer.fleet.view"],
  transfer_accountant: ["transfer.pricing.view", "transfer.bookings.view"]
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
  assert.deepEqual(labels("transfer_admin"), ["Dashboard", "Bookings", "New booking", "[Operations]", "Dispatch", "Drivers", "Vehicles", "[Pricing]", "Zones", "Locations", "Routes", "Rates & price check", "Booking settings", "[Administration]", "Users & roles", "Audit log"]);
  assert.deepEqual(labels("transfer_manager"), ["Dashboard", "Bookings", "New booking", "[Operations]", "Dispatch", "Drivers", "Vehicles", "[Pricing]", "Zones", "Locations", "Routes", "Rates & price check", "Booking settings"]);
  assert.deepEqual(labels("dispatcher"), ["Dashboard", "Bookings", "[Operations]", "Dispatch", "Drivers", "Vehicles"]);
  assert.deepEqual(labels("transfer_accountant"), ["Dashboard", "Bookings", "[Pricing]", "Zones", "Locations", "Routes", "Rates & price check", "Booking settings"]);
  assert.equal(can(userWith("transfer_manager"), P.PRICING_MANAGE), false);
  assert.equal(can(null, P.BOOKINGS_VIEW), false);
});

test("every page route is guarded by the permission the server enforces", () => {
  const routes = read("src/routes/AppRoutes.jsx");
  for (const [routePath, permission] of [
    ["/bookings", "BOOKINGS_VIEW"], ["/bookings/new", "BOOKINGS_MANAGE"], ["/bookings/:bookingId", "BOOKINGS_VIEW"], ["/pricing/zones", "PRICING_VIEW"],
    ["/pricing/locations", "PRICING_VIEW"], ["/pricing/routes", "PRICING_VIEW"], ["/pricing/rates", "PRICING_VIEW"], ["/pricing/settings", "PRICING_VIEW"],
    ["/users", "USERS_MANAGE"], ["/audit", "AUDIT_VIEW"], ["/dispatch", "FLEET_VIEW"], ["/fleet/drivers", "FLEET_VIEW"], ["/fleet/vehicles", "FLEET_VIEW"]
  ]) {
    assert.ok(routes.includes(`path="${routePath}" element={guarded(P.${permission},`), routePath);
  }
  assert.match(routes, /<RequireAuth>\s*<AdminLayout \/>/);
});

test("the manual booking payload carries no price, only the total staff saw", () => {
  const form = {
    manualChannel: "WHATSAPP", tripType: "ONE_WAY", pickupLocationId: "a".repeat(24), dropoffLocationId: "b".repeat(24), travelDate: "2099-01-01", travelTime: "10:00",
    returnDate: "", returnTime: "", adults: "2", children: "1", infants: "0", largeBags: "1", smallBags: "", luggageNotes: " ", flightNumber: " pw 1 ", pickupAddress: "", dropoffAddress: "",
    fullName: " Jane ", email: "jane@example.com", phone: "+255 700 000 000", whatsapp: true, specialRequests: ""
  };
  assert.deepEqual(quoteRequestFor(form).passengers, { adults: 2, children: 1, infants: 0 });
  assert.equal(quoteRequestFor({ ...form, dropoffLocationId: form.pickupLocationId }), null);
  const payload = buildManualBooking(form, { status: "PRICED", total: "45.00" });
  assert.equal(payload.expectedTotal, "45.00");
  assert.equal("price" in payload || "total" in payload || "allowDuplicate" in payload, false);
  assert.equal(payload.customer.fullName, "Jane");
  assert.equal(buildManualBooking(form, { status: "QUOTE_REQUIRED", total: null }).expectedTotal, null);
  assert.deepEqual(
    (({ allowDuplicate, duplicateReason }) => ({ allowDuplicate, duplicateReason }))(buildManualBooking(form, null, { allowDuplicate: true, duplicateReason: " second car " })),
    { allowDuplicate: true, duplicateReason: "second car" }
  );
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
