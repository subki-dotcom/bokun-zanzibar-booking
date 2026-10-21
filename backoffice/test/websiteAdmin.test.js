// The website's /admin is the day-to-day admin; CRM, Booking Accounting, Business Accounting, Reports &
// Analytics, Integrations, Control & System and the booking register (Operations → Bookings) stay in the
// Back Office only.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoutesFromChildren } from "react-router-dom";
import {
  ADMIN_PERMISSIONS,
  BACK_OFFICE_ONLY_EXACT_PATHS,
  BACK_OFFICE_ONLY_PAGES,
  BACK_OFFICE_ONLY_SECTIONS,
  WEBSITE_ADMIN_HOME,
  adminNavigation,
  filterAdminNavigation,
  isBackOfficeOnlyPath
} from "../src/config/adminNavigation.js";
import { createRenderHarness } from "./support/backOfficeRenderHarness.js";

const SUPER_ADMIN = {
  id: "u-super", fullName: "Super Admin", email: "super@example.test", role: "super_admin",
  permissions: [...Object.values(ADMIN_PERMISSIONS), "admin.dashboard.read", "operations.read", "operations.write"]
};
// The main Dashboard ("Main" section) is in the Back Office only.
const WEBSITE_SECTIONS = ["tour-admin", "operations", "back-office", "transfers", "settings-section"];
const paths = (items) => items.flatMap((item) => [item.path, ...paths(item.children || [])]).filter(Boolean);

test("website menu keeps Tour Admin, Operations, Transfers and Settings; the Back Office menu keeps the Dashboard", () => {
  assert.deepEqual(BACK_OFFICE_ONLY_SECTIONS, ["crm", "booking-accounting", "business-accounting", "reports-analytics", "integrations", "control-system"]);
  const website = filterAdminNavigation(undefined, SUPER_ADMIN, { websiteAdmin: true });
  assert.deepEqual(website.map((section) => section.id), WEBSITE_SECTIONS);
  const backOffice = filterAdminNavigation(undefined, SUPER_ADMIN);
  assert.deepEqual(
    backOffice.map((section) => section.id),
    adminNavigation.filter((section) => !section.websiteOnly && section.id !== "tour-admin").map((section) => section.id),
    "Back Office shows every section except the website-only shortcuts and Tour Admin"
  );
  assert.ok(!backOffice.some((section) => section.id === "transfers"));
  assert.ok(!backOffice.some((section) => section.id === "tour-admin"), "Tour Admin is in the Website Tour Admin only");
  assert.deepEqual(backOffice.find((section) => section.id === "operations")?.children?.map((item) => item.id), ["operations-bookings"], "the Back Office keeps only its booking register under Operations");
  assert.equal(backOffice.find((section) => section.id === "main")?.children?.[0]?.path, "/admin", "the Back Office keeps its Dashboard");
  assert.ok(!backOffice.some((section) => section.id === "back-office"), "the Back Office does not link to itself");
});

test("the Back Office shortcut is on the website for every role that may use the Back Office", () => {
  const sectionFor = (actor) => filterAdminNavigation(undefined, actor, { websiteAdmin: true }).find((section) => section.id === "back-office");
  assert.equal(sectionFor(SUPER_ADMIN)?.children?.[0]?.externalApp, "backOffice");
  assert.ok(sectionFor({ role: "admin", permissions: [] }), "admin");
  assert.ok(sectionFor({ role: "staff", permissions: ["admin.dashboard.read"] }), "staff");
  assert.equal(sectionFor({ role: "tour_admin", permissions: ["tour_operations.read"] }), undefined, "tour_admin");
  assert.equal(sectionFor({ role: "agent", permissions: [] }), undefined, "agent");
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
      const expected = BACK_OFFICE_ONLY_SECTIONS.includes(section.id) || BACK_OFFICE_ONLY_PAGES.includes(pathname) || BACK_OFFICE_ONLY_EXACT_PATHS.includes(pathname);
      assert.equal(isBackOfficeOnlyPath(pathname), expected, `${section.id}: ${pathname}`);
    }
  }
  assert.equal(isBackOfficeOnlyPath("/admin/crm-like"), false, "prefixes match whole path segments");
  assert.equal(isBackOfficeOnlyPath("/admin/operations/booking-requests"), false, "Booking Requests stays on the website");
  assert.equal(isBackOfficeOnlyPath("/admin"), true, "the main Dashboard is in the Back Office");
  assert.equal(isBackOfficeOnlyPath("/admin/tour-admin"), false, "only the Dashboard address itself, not every /admin page");
});

test("the booking register is only in the Back Office; the rest of Operations stays on the website", () => {
  assert.deepEqual(BACK_OFFICE_ONLY_PAGES, ["/admin/operations/bookings"]);
  const websiteOps = filterAdminNavigation(undefined, SUPER_ADMIN, { websiteAdmin: true }).find((section) => section.id === "operations");
  assert.deepEqual(websiteOps.children.map((item) => item.id), ["operations-requests", "operations-tour-ops", "operations-agents", "operations-recovery"]);
  const backOfficeOps = filterAdminNavigation(undefined, SUPER_ADMIN).find((section) => section.id === "operations");
  assert.ok(backOfficeOps.children.some((item) => item.path === "/admin/operations/bookings"), "the Back Office keeps Bookings");
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
    // "/admin" stays mounted on the website only as a redirect to its first day-to-day page.
    assert.deepEqual(website.filter(isBackOfficeOnlyPath), ["/admin"], "no Back-Office-only page on the website");
    assert.ok(backOffice.includes("/admin"), "the Back Office mounts the Dashboard");
    assert.ok(website.includes("/admin/*"), "their URLs show where to find them");
    assert.ok(backOffice.includes("/admin/operations/bookings"), "the Back Office mounts the booking register");
    for (const kept of ["/admin/operations/booking-requests", "/admin/tour-admin", "/admin/tour-admin/requests/:requestId", "/admin/settings/create-admin"]) {
      assert.ok(website.includes(kept), kept);
    }
    assert.ok(backOffice.filter(isBackOfficeOnlyPath).length > 40, "the Back Office keeps every section");
    assert.ok(!backOffice.includes("/admin/*"));
  } finally {
    await server.close();
  }
});

// Rendered as the website mounts it.
const bookingRequest = () => ({
  request: {
    _id: "r1", requestReference: "REQ-1", type: "cancel_booking", status: "approved", createdAt: "2026-10-02T10:00:00.000Z",
    bokunSync: { status: "synced" }, originalSnapshot: { currency: "USD", totalAmount: 150, amountPaid: 150 },
    booking: { bookingReference: "ZNZ-1", bookingStatus: "cancelled", customer: { firstName: "Jane", lastName: "Doe" } },
    refund: { refundId: { _id: "f1", refundReference: "RF-1", amount: 120, currency: "USD", status: "approved", provider: "pesapal" } }
  },
  payments: [], audit: [], refundContext: { providerKnown: true, providerLabel: "Pesapal" }, refundSummary: { status: "approved" }
});
const h = createRenderHarness({ websiteAdmin: true, defaultRoutes: () => ({ "GET /auth/me": ({ user }) => user, "GET /admin/booking-requests/r1": () => bookingRequest() }) });

test("on the website a booking request is decided and synced, while its refund is only shown and handled in the Back Office", async () => {
  await h.mount("/admin/operations/booking-requests/r1", SUPER_ADMIN);
  await h.waitFor(() => /Refund and Payment/.test(h.text()), "booking request");
  const labels = [...document.querySelectorAll("button")].map((element) => element.textContent.trim());
  for (const action of ["Approve Cancellation", "Reject", "Retry Bokun Sync", "Retry Email"]) assert.ok(labels.includes(action), action);
  for (const refundAction of ["Record Manual Refund Update", "Verify Refund Status"]) assert.ok(!labels.includes(refundAction), refundAction);
  assert.ok(!labels.some((label) => label.startsWith("Process Refund")), "no refund processing on the website");
  assert.match(h.text(), /Refunds and additional payments are processed by Finance in the Back Office/);
  const link = [...document.querySelectorAll("a")].find((element) => element.textContent.includes("Open in the Back Office"));
  assert.equal(link?.getAttribute("href"), "http://localhost:5174/admin/finance/booking-requests/r1");
});

test("on the website, opening a Back-Office-only URL shows where to find it and loads none of its data", async () => {
  for (const pathname of ["/admin/operations/bookings", "/admin/booking-accounting/invoices", "/admin/business-accounting/general-ledger", "/admin/crm", "/admin/report-center", "/admin/operations/bokun-sync/manual", "/admin/system-health", "/admin/finance/escalations"]) {
    await h.mount(pathname, SUPER_ADMIN);
    await h.waitFor(() => /This section is in the Back Office/.test(h.text()), pathname);
    const link = [...document.querySelectorAll("a")].find((element) => element.textContent.includes("Open in the Back Office"));
    assert.equal(link?.getAttribute("href"), `http://localhost:5174${pathname}`, pathname);
  }
  assert.ok(h.calls.every((call) => !/^\/(admin\/(booking-accounting|business-accounting|crm|report-center|system-health|finance)|bokun)/.test(call.pathname)), h.apiPaths().join(", "));
});

test("on the website, /admin opens Booking Requests instead of the main Dashboard and loads no dashboard data", async () => {
  assert.equal(WEBSITE_ADMIN_HOME, "/admin/operations/booking-requests");
  await h.mount("/admin", SUPER_ADMIN);
  await h.waitFor(() => h.locationNow === WEBSITE_ADMIN_HOME, "redirected to Booking Requests");
  assert.ok(!h.calls.some((call) => /^\/(reports\/(dashboard-summary|monthly-sales|operational-alerts)|bookings\/recent)/.test(call.pathname)), h.apiPaths().join(", "));
});

test("the website sidebar shows only Tour Admin, Operations, Transfers and Settings", async () => {
  await h.mount("/admin/booking-accounting/invoices", SUPER_ADMIN);
  await h.waitFor(() => document.querySelector("#admin-platform-sidebar"), "sidebar");
  const sidebar = document.querySelector("#admin-platform-sidebar").textContent;
  for (const shown of ["Tour Admin", "Booking Requests", "Tour Operations", "Transfers", "System Settings"]) assert.match(sidebar, new RegExp(shown), shown);
  const links = [...document.querySelectorAll("#admin-platform-sidebar a")].map((link) => link.getAttribute("href"));
  assert.ok(!links.includes("/admin"), `no link to the main Dashboard on the website: ${links.join(", ")}`);
  assert.equal(document.querySelector(".admin-platform-brand")?.getAttribute("href"), "/admin/operations/booking-requests", "the brand opens the website admin home");
  assert.equal(document.querySelector("#admin-platform-sidebar a[href='/admin/operations/bookings']"), null, "no Bookings link on the website");
  // The Transfer Admin shortcut opens the separate app (its own login) in a new tab.
  const transferLink = document.querySelector("#admin-platform-sidebar a[aria-label='Transfer Admin (opens in a new tab)']");
  assert.equal(transferLink?.getAttribute("href"), "http://localhost:5175");
  assert.equal(transferLink?.getAttribute("target"), "_blank");
  assert.equal(transferLink?.getAttribute("rel"), "noopener noreferrer");
  // The Back Office shortcut opens the Back Office app in a new tab, with the same account.
  const backOfficeLink = document.querySelector("#admin-platform-sidebar a[aria-label='Open Back Office (opens in a new tab)']");
  assert.equal(backOfficeLink?.getAttribute("href"), "http://localhost:5174");
  assert.equal(backOfficeLink?.getAttribute("target"), "_blank");
  for (const hidden of ["CRM", "Booking Accounting", "Business Accounting", "Reports & Analytics", "Integrations", "Control & System", "Invoices", "General Ledger", "Finance Escalations"]) {
    assert.doesNotMatch(sidebar, new RegExp(hidden.replace("&", "\\&")), hidden);
  }
});
