// The website's /admin is the day-to-day admin; CRM, Booking Accounting, Business Accounting, Reports &
// Analytics, Integrations and Control & System stay in the Back Office only.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoutesFromChildren } from "react-router-dom";
import {
  ADMIN_PERMISSIONS,
  BACK_OFFICE_ONLY_SECTIONS,
  adminNavigation,
  filterAdminNavigation,
  isBackOfficeOnlyPath
} from "../src/config/adminNavigation.js";
import { createRenderHarness } from "./support/backOfficeRenderHarness.js";

const SUPER_ADMIN = {
  id: "u-super", fullName: "Super Admin", email: "super@example.test", role: "super_admin",
  permissions: [...Object.values(ADMIN_PERMISSIONS), "admin.dashboard.read", "operations.read", "operations.write"]
};
const WEBSITE_SECTIONS = ["main", "tour-admin", "operations", "transfers", "settings-section"];
const paths = (items) => items.flatMap((item) => [item.path, ...paths(item.children || [])]).filter(Boolean);

test("website menu keeps Dashboard, Tour Admin, Operations, Transfers and Settings; the Back Office menu is unchanged", () => {
  assert.deepEqual(BACK_OFFICE_ONLY_SECTIONS, ["crm", "booking-accounting", "business-accounting", "reports-analytics", "integrations", "control-system"]);
  const website = filterAdminNavigation(undefined, SUPER_ADMIN, { websiteAdmin: true });
  assert.deepEqual(website.map((section) => section.id), WEBSITE_SECTIONS);
  const backOffice = filterAdminNavigation(undefined, SUPER_ADMIN);
  assert.deepEqual(
    backOffice.map((section) => section.id),
    adminNavigation.filter((section) => !section.websiteOnly).map((section) => section.id),
    "Back Office shows every section except the website-only Transfers shortcut"
  );
  assert.ok(!backOffice.some((section) => section.id === "transfers"));
});

test("the Transfer Admin shortcut is for super admins and admins on the website only", () => {
  const sectionFor = (actor) => filterAdminNavigation(undefined, actor, { websiteAdmin: true }).find((section) => section.id === "transfers");
  assert.equal(sectionFor(SUPER_ADMIN)?.children?.[0]?.externalApp, "transferAdmin");
  assert.ok(sectionFor({ role: "admin", permissions: [] }));
  assert.equal(sectionFor({ role: "staff", permissions: ["admin.dashboard.read"] }), undefined, "staff");
  assert.equal(sectionFor({ role: "tour_admin", permissions: ["tour_operations.read"] }), undefined, "tour_admin");
  assert.equal(sectionFor({ role: "agent", permissions: [] }), undefined, "agent");
});

test("every menu page of a Back-Office-only section is blocked on the website, and no kept page is", () => {
  for (const section of adminNavigation) {
    const sectionPaths = paths(section.children || []);
    for (const pathname of sectionPaths) {
      assert.equal(isBackOfficeOnlyPath(pathname), BACK_OFFICE_ONLY_SECTIONS.includes(section.id), `${section.id}: ${pathname}`);
    }
  }
  assert.equal(isBackOfficeOnlyPath("/admin/crm-like"), false, "prefixes match whole path segments");
});

const routePaths = (routes) => routes.flatMap((route) => [route.path, ...routePaths(route.children || [])]).filter(Boolean);

test("the website route table does not mount Back-Office-only pages; the Back Office still mounts all of them", async () => {
  const { createServer } = await import("vite");
  const { sharedResolve } = await import("../../shared/vite.shared.js");
  const server = await createServer({ configFile: false, resolve: sharedResolve, esbuild: { jsx: "automatic" }, server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: "custom" });
  try {
    const { default: adminRoutes } = await server.ssrLoadModule("/src/routes/AdminRoutes.jsx");
    const website = routePaths(createRoutesFromChildren(adminRoutes({ websiteAdmin: true })));
    const backOffice = routePaths(createRoutesFromChildren(adminRoutes()));
    assert.deepEqual(website.filter(isBackOfficeOnlyPath), [], "no Back-Office-only page on the website");
    assert.ok(website.includes("/admin/*"), "their URLs show where to find them");
    for (const kept of ["/admin", "/admin/operations/bookings", "/admin/operations/booking-requests", "/admin/tour-admin", "/admin/tour-admin/requests/:requestId", "/admin/settings/create-admin"]) {
      assert.ok(website.includes(kept), kept);
    }
    assert.ok(backOffice.filter(isBackOfficeOnlyPath).length > 40, "the Back Office keeps every section");
    assert.ok(!backOffice.includes("/admin/*"));
  } finally {
    await server.close();
  }
});

// Rendered as the website mounts it.
const h = createRenderHarness({ websiteAdmin: true, defaultRoutes: () => ({ "GET /auth/me": ({ user }) => user }) });

test("on the website, opening a Back-Office-only URL shows where to find it and loads none of its data", async () => {
  for (const pathname of ["/admin/booking-accounting/invoices", "/admin/business-accounting/general-ledger", "/admin/crm", "/admin/report-center", "/admin/operations/bokun-sync/manual", "/admin/system-health", "/admin/finance/escalations"]) {
    await h.mount(pathname, SUPER_ADMIN);
    await h.waitFor(() => /This section is in the Back Office/.test(h.text()), pathname);
    const link = [...document.querySelectorAll("a")].find((element) => element.textContent.includes("Open in the Back Office"));
    assert.equal(link?.getAttribute("href"), `http://localhost:5174${pathname}`, pathname);
  }
  assert.ok(h.calls.every((call) => !/^\/(admin\/(booking-accounting|business-accounting|crm|report-center|system-health|finance)|bokun)/.test(call.pathname)), h.apiPaths().join(", "));
});

test("the website sidebar shows only Dashboard, Tour Admin, Operations, Transfers and Settings", async () => {
  await h.mount("/admin/booking-accounting/invoices", SUPER_ADMIN);
  await h.waitFor(() => document.querySelector("#admin-platform-sidebar"), "sidebar");
  const sidebar = document.querySelector("#admin-platform-sidebar").textContent;
  for (const shown of ["Dashboard", "Tour Admin", "Bookings", "Booking Requests", "Transfers", "System Settings"]) assert.match(sidebar, new RegExp(shown), shown);
  // The Transfer Admin shortcut opens the separate app (its own login) in a new tab.
  const transferLink = document.querySelector("#admin-platform-sidebar a[aria-label='Transfer Admin (opens in a new tab)']");
  assert.equal(transferLink?.getAttribute("href"), "http://localhost:5175");
  assert.equal(transferLink?.getAttribute("target"), "_blank");
  assert.equal(transferLink?.getAttribute("rel"), "noopener noreferrer");
  for (const hidden of ["CRM", "Booking Accounting", "Business Accounting", "Reports & Analytics", "Integrations", "Control & System", "Invoices", "General Ledger", "Finance Escalations"]) {
    assert.doesNotMatch(sidebar, new RegExp(hidden.replace("&", "\\&")), hidden);
  }
});
