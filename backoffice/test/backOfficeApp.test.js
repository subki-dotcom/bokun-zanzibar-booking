import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server.js";
import { Routes, createRoutesFromChildren, matchRoutes } from "react-router-dom";
import { createServer } from "vite";
import { sharedResolve } from "../../shared/vite.shared.js";
import { BACK_OFFICE_LAYOUT_ROLES, BACK_OFFICE_ROLES, backOfficeEntry, backOfficeLandingPath, canUseBackOffice } from "../src/routes/backOfficeAccess.js";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

// AuthProvider reads the session from localStorage; Node has none.
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};

let server;
let adminModule;
let authModule;
before(async () => {
  server = await createServer({ configFile: false, resolve: sharedResolve, esbuild: { jsx: "automatic" }, server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: "custom" });
  adminModule = await server.ssrLoadModule("/src/routes/AdminRoutes.jsx");
  authModule = await server.ssrLoadModule("/../shared/src/context/AuthContext.jsx");
});
after(async () => {
  await server?.close();
});

const adminRouteTable = () => createRoutesFromChildren(adminModule.default());

test("only super admins, admins and staff can use the Back Office; agents get a page of their own", () => {
  assert.deepEqual(BACK_OFFICE_ROLES, ["super_admin", "admin", "staff"]);
  // Tour Admin shares the layout only; its landing page is its own, so guard redirects cannot loop.
  assert.deepEqual(BACK_OFFICE_LAYOUT_ROLES, ["super_admin", "admin", "staff", "tour_admin"]);
  assert.equal(canUseBackOffice("tour_admin"), true);
  assert.equal(backOfficeLandingPath("tour_admin"), "/admin/tour-admin");
  for (const role of BACK_OFFICE_ROLES) assert.equal(backOfficeLandingPath(role), "/admin");
  assert.equal(canUseBackOffice("agent"), false);
  assert.equal(backOfficeEntry({ loading: true }), "loading");
  assert.equal(backOfficeEntry({ loading: false, isAuthenticated: false }), "login");
  assert.equal(backOfficeEntry({ loading: false, isAuthenticated: true, role: "staff" }), "admin");
  // Guards redirect unauthorised users to "/", so an agent must not be sent back into /admin.
  assert.equal(backOfficeEntry({ loading: false, isAuthenticated: true, role: "agent" }), "no-access");
});

test("every admin route sits behind the Back Office role guard and keeps its page permission", async () => {
  const { ADMIN_PERMISSIONS } = await server.ssrLoadModule("/src/config/adminNavigation.js");
  const [layout] = adminRouteTable();
  assert.deepEqual(layout.element.props.roles, BACK_OFFICE_LAYOUT_ROLES);
  const [existingScreens, ...websiteOnlyNotices] = layout.children;
  // Every existing screen is still behind exactly the original Back Office roles.
  assert.deepEqual(existingScreens.element.props.roles, BACK_OFFICE_ROLES);
  // 81 declared routes (including the two Finance escalation screens and the finance view of a booking request),
  // less the ten Website Tour Admin routes the Back Office no longer mounts; the CRM customer list declares three
  // paths through one .map.
  assert.equal(existingScreens.children.length, 71);
  const financeGuard = matchRoutes(adminRouteTable(), "/admin/finance/escalations/abc").at(-1).route.element.props;
  assert.deepEqual(financeGuard.permissions, [ADMIN_PERMISSIONS.BOOKING_ACCOUNTING_READ]);
  assert.deepEqual(matchRoutes(adminRouteTable(), "/admin/finance/escalations")[1].route.element.props.roles, BACK_OFFICE_ROLES);
  assert.deepEqual(matchRoutes(adminRouteTable(), "/admin/finance/booking-requests/r1")[1].route.element.props.roles, BACK_OFFICE_ROLES);
  // Tour Admin, Booking Requests, Tour Operations, Assignments and Recovery Center are in the Website Tour Admin:
  // the Back Office answers their addresses with a notice only, for every layout role (tour_admin included).
  assert.deepEqual(websiteOnlyNotices.map((route) => route.path), [
    "/admin/tour-admin/*", "/admin/operations/booking-requests/*", "/admin/operations/tour-operations/*",
    "/admin/operations/agents/*", "/admin/operations/recovery/*", "/admin/booking-requests/*", "/admin/agents/*",
    "/admin/recovery/*", "/admin/operations"
  ]);
  assert.ok(websiteOnlyNotices.every((route) => route.element.type.name === "WebsiteOnlyPage" && !route.children));

  const guardFor = (pathname) => matchRoutes(adminRouteTable(), pathname).at(-1).route.element.props;
  assert.deepEqual(guardFor("/admin/settings/create-admin").roles, ["super_admin"]);
  assert.deepEqual(guardFor("/admin/booking-accounting/reconciliation").permissions, [ADMIN_PERMISSIONS.BOOKING_ACCOUNTING_READ]);
  assert.deepEqual(guardFor("/admin/business-accounting/period-close").permissions, [ADMIN_PERMISSIONS.GL_CLOSE_PERIOD]);
  assert.deepEqual(guardFor("/admin/business-accounting/general-ledger").permissions, [ADMIN_PERMISSIONS.GL_VIEW]);
  assert.deepEqual(guardFor("/admin/report-center").permissions, [ADMIN_PERMISSIONS.REPORT_CENTER_READ]);
  for (const pathname of ["/admin", "/admin/booking-accounting/invoices", "/admin/booking-accounting/payments", "/admin/operations/bookings"]) {
    assert.ok(matchRoutes(adminRouteTable(), pathname), `${pathname} is routed`);
  }
});

test("signed-out visitors see no admin content", () => {
  storage.clear();
  const html = renderToStaticMarkup(
    React.createElement(authModule.AuthProvider, null,
      React.createElement(StaticRouter, { location: "/admin/booking-accounting/payments" },
        React.createElement(Routes, null, adminModule.default())))
  );
  assert.equal(html, "");
});

test("the login page is admin/staff only and sends password recovery to the website", async () => {
  storage.clear();
  const { default: BackOfficeLoginPage } = await server.ssrLoadModule("/src/pages/BackOfficeLoginPage.jsx");
  const html = renderToStaticMarkup(
    React.createElement(authModule.AuthProvider, null,
      React.createElement(StaticRouter, { location: "/login" }, React.createElement(BackOfficeLoginPage)))
  );
  assert.match(html, /Back Office Login/);
  assert.doesNotMatch(html, /<select/, "no portal switch: agents use the website");
  assert.match(html, /href="http:\/\/localhost:5173\/forgot-password"/);
  assert.match(html, /autoComplete="current-password"|autocomplete="current-password"/);
});

test("links to customer pages stay in-app on the website fallback and open the website from the Back Office", async () => {
  const { default: WebsiteLink } = await server.ssrLoadModule("/src/components/admin/WebsiteLink.jsx");
  const appContext = await server.ssrLoadModule("/src/config/appContext.js");
  const render = () => renderToStaticMarkup(
    React.createElement(StaticRouter, { location: "/admin/operations/bookings" },
      React.createElement(WebsiteLink, { to: "/invoice/BK-1", className: "x" }, "View invoice"))
  );
  // Order matters: the flag is module state, and only the Back Office entry point sets it.
  assert.equal(appContext.isRunningInBackOffice(), false);
  assert.equal(render(), '<a class="x" href="/invoice/BK-1">View invoice</a>');
  appContext.markRunningInBackOffice();
  assert.equal(render(), '<a href="http://localhost:5173/invoice/BK-1" target="_blank" rel="noopener noreferrer" class="x">View invoice</a>');
  assert.match(read("src/main.jsx"), /markRunningInBackOffice\(\);/);
});

test("the Back Office is a separate app on port 5174 that never imports website code", () => {
  const config = read("vite.config.js");
  assert.match(config, /port: 5174/);
  assert.match(config, /strictPort: true/);
  assert.match(config, /resolve: sharedResolve/);
  assert.match(read("index.html"), /<meta name="robots" content="noindex, nofollow" \/>/);
  assert.equal(JSON.parse(read("package.json")).scripts.dev, "vite");

  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
  const offenders = walk(path.join(root, "src"))
    .filter((file) => /\.(jsx?|css)$/.test(file))
    .filter((file) => /from\s+["'][^"']*frontend\/|@import\s+["'][^"']*frontend\//.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
});
