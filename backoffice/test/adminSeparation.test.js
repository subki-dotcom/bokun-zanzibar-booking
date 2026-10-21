// Separation between the Website Tour Admin and the Back Office. The Back Office does not mount the tour booking and
// operations pages (Tour Dashboard, Tour Bookings, Customer Requests, Booking Requests, Tour Operations, Assignments,
// Recovery Center): their addresses say where to find them and load none of their data. Refunds and additional
// payments of a booking request are processed in the Back Office only.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoutesFromChildren } from "react-router-dom";
import { createRenderHarness } from "./support/backOfficeRenderHarness.js";
import { ADMIN_PERMISSIONS, WEBSITE_ONLY_PATH_PREFIXES, adminNavigation, filterAdminNavigation, isWebsiteOnlyPath } from "../src/config/adminNavigation.js";
import { TOUR_PERMISSIONS } from "../src/config/tourOperations.js";

const SUPER_ADMIN = { id: "u-super", fullName: "Super Admin", email: "super@example.test", role: "super_admin", permissions: [...Object.values(ADMIN_PERMISSIONS), "admin.dashboard.read", "operations.read", "operations.write"] };
const TOUR_ADMIN = { id: "u-tour", fullName: "Tour Operator", email: "ops@example.test", role: "tour_admin", permissions: [TOUR_PERMISSIONS.OPERATIONS_READ, TOUR_PERMISSIONS.REQUESTS_READ, TOUR_PERMISSIONS.REQUESTS_PROCESS] };
const paths = (items) => items.flatMap((item) => [item.path, ...paths(item.children || [])]).filter(Boolean);

const WEBSITE_ONLY_PAGES = [
  "/admin/tour-admin", "/admin/tour-admin/bookings", "/admin/tour-admin/bookings/ZNZ-1", "/admin/tour-admin/requests", "/admin/tour-admin/requests/r1",
  "/admin/operations/booking-requests", "/admin/operations/booking-requests/r1", "/admin/operations/tour-operations",
  "/admin/operations/agents", "/admin/operations/recovery", "/admin/booking-requests", "/admin/agents", "/admin/recovery", "/admin/operations"
];

const requestDetail = () => ({
  request: {
    _id: "r1", requestReference: "REQ-1", type: "cancel_booking", status: "approved", createdAt: "2026-10-02T10:00:00.000Z",
    bokunSync: { status: "synced" }, originalSnapshot: { currency: "USD", totalAmount: 150, amountPaid: 150 },
    booking: { bookingReference: "ZNZ-1", bookingStatus: "cancelled", customer: { firstName: "Jane", lastName: "Doe" } },
    refund: { refundId: { _id: "f1", refundReference: "RF-1", amount: 120, currency: "USD", status: "approved", provider: "pesapal" } }
  },
  payments: [], audit: [], refundContext: { providerKnown: true, providerLabel: "Pesapal" }, refundSummary: { status: "approved" }
});

test("the Back Office menu has none of the website's tour pages; the website menu keeps all seven", () => {
  const backOffice = paths(filterAdminNavigation(undefined, SUPER_ADMIN));
  assert.deepEqual(backOffice.filter(isWebsiteOnlyPath), [], backOffice.join(", "));
  assert.ok(backOffice.includes("/admin/operations/bookings"), "the Back Office keeps its booking register");
  assert.ok(backOffice.some((path) => path.startsWith("/admin/operations/bokun-sync")), "Bókun synchronization stays in the Back Office");
  for (const kept of ["/admin/booking-accounting/refunds", "/admin/business-accounting/general-ledger", "/admin/report-center"]) assert.ok(backOffice.includes(kept), kept);

  const website = paths(filterAdminNavigation(undefined, SUPER_ADMIN, { websiteAdmin: true }));
  for (const page of ["/admin/tour-admin", "/admin/tour-admin/bookings", "/admin/tour-admin/requests", "/admin/operations/booking-requests", "/admin/operations/tour-operations", "/admin/operations/agents", "/admin/operations/recovery"]) {
    assert.ok(website.includes(page), page);
  }
  assert.ok(paths(adminNavigation).filter(isWebsiteOnlyPath).length >= 7);
});

test("route tables: the Back Office mounts no website page; the website mounts no finance page", async () => {
  const { createServer } = await import("vite");
  const { sharedResolve } = await import("../../shared/vite.shared.js");
  const server = await createServer({ configFile: false, resolve: sharedResolve, esbuild: { jsx: "automatic" }, server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: "custom" });
  try {
    const { default: adminRoutes } = await server.ssrLoadModule("/src/routes/AdminRoutes.jsx");
    const routePaths = (routes) => routes.flatMap((route) => [{ path: route.path, element: route.element }, ...routePaths(route.children || [])]).filter((route) => route.path);
    const backOffice = routePaths(createRoutesFromChildren(adminRoutes()));
    const mountedWebsitePages = backOffice.filter((route) => isWebsiteOnlyPath(route.path.replace(/\/\*$/, "")) && route.element?.type?.name !== "WebsiteOnlyPage");
    assert.deepEqual(mountedWebsitePages.map((route) => route.path), [], "only the \"in the Website Tour Admin\" notice is mounted there");
    assert.equal(WEBSITE_ONLY_PATH_PREFIXES.filter((prefix) => !backOffice.some((route) => route.path === `${prefix}/*`)).length, 0, "every website address answers in the Back Office");
    assert.ok(backOffice.some((route) => route.path === "/admin/finance/booking-requests/:requestId"), "the finance part of a booking request is in the Back Office");

    const website = routePaths(createRoutesFromChildren(adminRoutes({ websiteAdmin: true })));
    assert.ok(!website.some((route) => route.path.startsWith("/admin/finance")), "the website has no finance pages");
    for (const page of ["/admin/tour-admin/bookings", "/admin/operations/booking-requests/:requestId", "/admin/operations/recovery", "/admin/operations/agents"]) {
      assert.ok(website.some((route) => route.path === page), page);
    }
  } finally {
    await server.close();
  }
});

const h = createRenderHarness({
  defaultRoutes: () => ({
    "GET /auth/me": ({ user }) => user,
    "GET /admin/booking-requests/r1": () => requestDetail()
  })
});

test("in the Back Office every website tour page says where it is and loads none of its data", async () => {
  for (const pathname of WEBSITE_ONLY_PAGES) {
    await h.mount(pathname, SUPER_ADMIN);
    await h.waitFor(() => /This page is in the Website Tour Admin/.test(h.text()), pathname);
    const link = [...document.querySelectorAll("a")].find((element) => element.textContent.includes("Open in the Website Tour Admin"));
    assert.equal(link?.getAttribute("href"), `http://localhost:5173${pathname}`, pathname);
  }
  const forbidden = h.calls.filter((call) => /^\/(tour-operations|admin\/booking-requests|admin\/agents|bookings\/finalization|admin\/recovery)/.test(call.pathname));
  assert.deepEqual(forbidden.map((call) => call.pathname), []);
});

test("a tour_admin in the Back Office is told to use the Website Tour Admin, without a redirect loop", async () => {
  await h.mount("/admin", TOUR_ADMIN);
  await h.waitFor(() => /This page is in the Website Tour Admin/.test(h.text()), "notice for tour_admin");
  assert.equal(h.locationNow, "/admin/tour-admin");
  assert.ok(!h.calls.some((call) => call.pathname.startsWith("/tour-operations")));
});

test("the Back Office finance view of a booking request processes refunds and makes no decision", async () => {
  await h.mount("/admin/finance/booking-requests/r1", SUPER_ADMIN);
  await h.waitFor(() => /Refund Management/.test(h.text()), "refund management");
  const labels = [...document.querySelectorAll("button")].map((element) => element.textContent.trim());
  assert.ok(labels.some((label) => label.startsWith("Process Refund")), labels.join(" | "));
  assert.ok(labels.includes("Record Manual Refund Update"));
  for (const decision of ["Approve Cancellation", "Approve", "Reject", "Request Info", "Retry Bokun Sync", "Retry Email", "Recalculate"]) {
    assert.ok(!labels.includes(decision), `no ${decision} in the Back Office`);
  }
  assert.match(h.text(), /Decisions, supplier sync and customer emails are handled in the Website Tour Admin/);
  assert.ok(document.querySelector("a[href='/admin/booking-accounting/refunds']"), "back to Refunds");
});
