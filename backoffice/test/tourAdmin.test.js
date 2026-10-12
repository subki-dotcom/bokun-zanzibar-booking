// Phase 3B: the Tour Admin screens inside the Back Office. The real routes, guards, layout and AuthProvider
// render in JSDOM; the shared axiosClient is answered by an in-test adapter that plays the server, records
// every call and refuses (403) anything outside what each role may read. No network is used.
import test, { before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import React, { act } from "react";
import { createServer } from "vite";
import { sharedResolve } from "../../shared/vite.shared.js";
import {
  ADMIN_PERMISSIONS,
  filterAdminNavigation,
  getAdminRouteMeta,
  roleLabel
} from "../src/config/adminNavigation.js";
import { bookingAttention, bokunSyncSummary, TOUR_PERMISSIONS } from "../src/config/tourOperations.js";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

// The Back Office has no DOM library of its own; the website's jsdom is reused rather than adding one.
let JSDOM = null;
try {
  ({ JSDOM } = createRequire(path.join(root, "../frontend/package.json"))("jsdom"));
} catch {
  JSDOM = null;
}

const TOUR_ADMIN_PERMISSIONS = [TOUR_PERMISSIONS.OPERATIONS_READ, TOUR_PERMISSIONS.REQUESTS_READ, TOUR_PERMISSIONS.REQUESTS_PROCESS];
const STAFF_PERMISSIONS = [
  "admin.dashboard.read", "operations.read", "operations.write", "bokun_sync.read", "bokun_sync.write", "booking_accounting.read",
  "payment_reconciliation.read", "payment_reconciliation.write", "settlement.view", "settlement.create", "settlement.edit",
  "settlement.allocate", "settlement.reconcile", "settlement.import", "service_completion.view", "service_completion.create",
  "service_completion.verify", "service_completion.reverse", "revenue_recognition.view", "revenue_recognition.preview",
  "gl.preview_posting", "agent_management.read"
];
const ALL_ADMIN_PERMISSIONS = [...new Set([...Object.values(ADMIN_PERMISSIONS), ...STAFF_PERMISSIONS])];
const USERS = {
  tour_admin: { id: "u-tour", fullName: "Tour Operator", email: "ops@example.test", role: "tour_admin", permissions: TOUR_ADMIN_PERMISSIONS },
  tour_reader: { id: "u-reader", fullName: "Read Only", email: "read@example.test", role: "tour_admin", permissions: [TOUR_PERMISSIONS.OPERATIONS_READ, TOUR_PERMISSIONS.REQUESTS_READ] },
  staff: { id: "u-staff", fullName: "Staff", email: "staff@example.test", role: "staff", permissions: STAFF_PERMISSIONS },
  admin: { id: "u-admin", fullName: "Admin", email: "admin@example.test", role: "admin", permissions: ALL_ADMIN_PERMISSIONS },
  agent: { id: "u-agent", fullName: "Agent", email: "agent@example.test", role: "agent", permissions: ["agent_portal.read", "agent_portal.write"], approvalStatus: "approved", termsAcceptedAt: "2026-01-01" }
};

const findById = (items, id) => {
  for (const item of items) {
    if (item.id === id) return item;
    const child = item.children ? findById(item.children, id) : null;
    if (child) return child;
  }
  return null;
};
const allIds = (items) => items.flatMap((item) => [item.id, ...(item.children ? allIds(item.children) : [])]);

test("Tour Admin navigation: tour_admin sees only Tour Admin; staff and agents never see it", () => {
  const tourNav = filterAdminNavigation(undefined, USERS.tour_admin);
  assert.deepEqual(allIds(tourNav), ["tour-admin", "tour-admin-dashboard", "tour-admin-bookings", "tour-admin-requests"]);
  const readerNav = filterAdminNavigation(undefined, USERS.tour_reader);
  assert.ok(findById(readerNav, "tour-admin-requests"));
  const operationsOnly = filterAdminNavigation(undefined, { role: "tour_admin", permissions: [TOUR_PERMISSIONS.OPERATIONS_READ] });
  assert.deepEqual(allIds(operationsOnly), ["tour-admin", "tour-admin-dashboard", "tour-admin-bookings"]);

  const staffNav = filterAdminNavigation(undefined, USERS.staff);
  assert.equal(findById(staffNav, "tour-admin"), null, "staff does not hold Tour Operations permissions");
  for (const id of ["operations-bookings", "operations-requests", "booking-accounting-invoices"]) assert.ok(findById(staffNav, id), id);

  const adminNav = filterAdminNavigation(undefined, USERS.admin);
  for (const id of ["tour-admin-dashboard", "tour-admin-bookings", "tour-admin-requests", "booking-accounting-invoices", "gl-general-ledger"]) assert.ok(findById(adminNav, id), id);

  assert.deepEqual(filterAdminNavigation(undefined, USERS.agent), []);
  assert.equal(getAdminRouteMeta("/admin/tour-admin/requests").label, "Customer Requests");
  assert.equal(getAdminRouteMeta("/admin/tour-admin/requests/abc").label, "Request Details");
  assert.equal(getAdminRouteMeta("/admin/tour-admin/bookings/ZNZ-1").label, "Booking Details");
  assert.equal(getAdminRouteMeta("/admin/operations/booking-requests/abc").label, "Request Details", "existing detail label unchanged");
  assert.equal(roleLabel("tour_admin"), "Tour Admin");
});

test("attention and Bókun summaries never treat a verified payment as supplier confirmation", () => {
  const paidOnly = { status: { booking: "pending", payment: "paid", supplier: "supplier_pending" }, supplierSync: { linkedToBokun: false } };
  assert.equal(bookingAttention(paidOnly).key, "awaiting_supplier");
  assert.equal(bookingAttention({ ...paidOnly, supplierSync: { finalizationPending: true } }).key, "supplier_sync_in_progress");
  assert.equal(bookingAttention({ status: { booking: "confirmed", payment: "paid", supplier: "confirmed" }, supplierSync: {} }).key, "ok");
  assert.equal(bookingAttention({ status: { booking: "pending", payment: "pending", supplier: "awaiting_payment" } }).key, "awaiting_payment");
  assert.equal(bookingAttention({ status: { booking: "cancelled", payment: "paid", supplier: "confirmed" } }).key, "cancelled");
  assert.equal(bookingAttention({ status: { booking: "failed", payment: "failed" } }).key, "failed");
  assert.equal(bookingAttention({ status: { booking: "pending", payment: "paid", supplier: "supplier_failed" } }).key, "supplier_failed");
  assert.equal(bokunSyncSummary({ linkedToBokun: true, bokunStatus: "pending" }).tone, "warning");
  assert.equal(bokunSyncSummary({}).label, "Not in Bókun");
});

test("the Tour Admin API client only calls Tour Operations endpoints and only sends accepted parameters", () => {
  const source = read("src/api/tourOperationsApi.js");
  const paths = [...source.matchAll(/axiosClient\.(?:get|post)\(`([^`$?]+)/g)].map((match) => match[1]);
  assert.ok(paths.length >= 6);
  assert.ok(paths.every((value) => value.startsWith("/tour-operations/")), paths.join(","));
  // Tour Admin pages may only import the Tour Operations API client.
  for (const file of fs.readdirSync(path.join(root, "src/pages/admin/tourAdmin"))) {
    const imports = [...read(`src/pages/admin/tourAdmin/${file}`).matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    const apiImports = imports.filter((value) => value.includes("/api/"));
    assert.deepEqual(apiImports.filter((value) => !value.endsWith("/api/tourOperationsApi")), [], `${file}: ${apiImports.join(", ")}`);
  }
});

// ---- Rendered behaviour ----
let dom, server, mods, rootElement, reactRoot, calls, routes;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const bookingItem = (n, overrides = {}) => ({
  id: `b${n}`, bookingReference: `ZNZ-17000000000${n}-100${n}`, origin: "WEBSITE", originBasis: "recorded", agentId: null,
  tour: { productTitle: `Tour ${n}`, optionTitle: "Morning", travelDate: "2026-12-0" + n, startTime: "09:30", pax: { adults: 2, children: 0, infants: 0, total: 2 } },
  customer: { firstName: "Guest", lastName: `N${n}`, email: `guest${n}@example.test`, phone: "+255700000001", country: "TZ", hotelName: "Hotel" },
  status: { booking: "pending", payment: "paid", supplier: "supplier_pending", supplierUpdatedAt: null, cancelledAt: null },
  supplierSync: { linkedToBokun: false, confirmationCode: "", bokunStatus: "unknown", finalizationStatus: "", finalizationPending: false },
  createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z",
  ...overrides
});
const operations = (overrides = {}) => ({
  state: "RECEIVED", category: "cancellation", categorySource: "request_type", version: 0, notes: [], history: [], updatedAt: null, updatedBy: null,
  allowedTransitions: [
    { toState: "UNDER_REVIEW", reasonRequired: false, escalatesTo: "" },
    { toState: "AWAITING_SUPPLIER", reasonRequired: true, escalatesTo: "SUPPLIER" },
    { toState: "AWAITING_FINANCE", reasonRequired: true, escalatesTo: "FINANCE" },
    { toState: "REJECTED", reasonRequired: true, escalatesTo: "" }
  ],
  ...overrides
});
const requestDetail = (overrides = {}) => ({
  id: "r1", requestReference: "REQ-1", type: "cancel_booking", customerStatus: "submitted", createdAt: "2026-10-02T10:00:00.000Z",
  requestedChanges: { date: "", startTime: "", travelers: null }, original: { date: "2026-12-01", startTime: "09:30", optionTitle: "Morning", travelers: { adults: 2 } },
  customerReason: "Flight cancelled", customerNotes: "", customerFacingDecision: "",
  supplier: { syncStatus: "not_required" }, finance: { refundRequired: true, refundStatus: "requested", additionalPaymentRequired: false, additionalPaymentStatus: "not_required" },
  operations: operations(), notice: "Operations state is internal. RESOLVED does not mean a supplier change, cancellation, payment adjustment or refund has happened.",
  booking: bookingItem(1), auditTrail: [{ action: "booking_request_submitted", actorRole: "customer", at: "2026-10-02T10:00:00.000Z" }],
  ...overrides
});

// Default server behaviour; individual tests override entries in `routes`.
const defaultRoutes = () => ({
  "GET /auth/me": ({ user }) => user,
  "GET /tour-operations/bookings": ({ query }) => {
    const items = [
      bookingItem(1),
      bookingItem(2, { origin: "AGENT_PORTAL", agentId: "agent-1", status: { booking: "confirmed", payment: "paid", supplier: "confirmed" }, supplierSync: { linkedToBokun: true, confirmationCode: "RTS-2", bokunStatus: "confirmed", finalizationStatus: "confirmed" } }),
      bookingItem(3, { originBasis: "historical", status: { booking: "failed", payment: "failed", supplier: "awaiting_payment" } })
    ];
    if (query.get("search")) return { items: items.filter((item) => item.bookingReference === query.get("search").toUpperCase()), page: 1, limit: 1, total: 1, hasMore: false };
    return { items, page: Number(query.get("page") || 1), limit: Number(query.get("limit") || 25), total: 60, hasMore: true };
  },
  "GET /tour-operations/requests": () => ({ items: [{ ...requestDetail(), auditTrail: undefined, operations: { ...operations(), notes: undefined, history: undefined, noteCount: 0 } }], page: 1, limit: 25, total: 7, hasMore: false }),
  "GET /tour-operations/requests/r1": () => requestDetail(),
  "POST /tour-operations/requests/r1/notes": ({ body }) => requestDetail({ operations: operations({ notes: [{ id: "n1", action: "note_added", text: body.text, actorId: "u-tour", actorRole: "tour_admin", at: "2026-10-03T10:00:00.000Z" }] }) }),
  "POST /tour-operations/requests/r1/transition": ({ body }) => requestDetail({ operations: operations({ state: body.toState, version: 1, allowedTransitions: [] }) }),
  "POST /tour-operations/requests/r1/category": ({ body }) => requestDetail({ operations: operations({ category: body.category, version: 1 }) })
});

const serverError = (status, code, message) => ({ __error: { status, code, message } });

before(async () => {
  if (!JSDOM) return;
  dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost:5174/", pretendToBeVisual: true });
  for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "Node", "Event", "CustomEvent", "MouseEvent", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "localStorage", "sessionStorage"]) {
    try {
      const value = dom.window[name];
      Object.defineProperty(globalThis, name, { value: typeof value === "function" && /^[a-z]/.test(name) ? value.bind(dom.window) : value, configurable: true, writable: true });
    } catch { /* read-only in this Node version */ }
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  server = await createServer({ configFile: false, resolve: sharedResolve, esbuild: { jsx: "automatic" }, server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: "custom" });
  mods = {
    routes: await server.ssrLoadModule("/src/routes/BackOfficeRoutes.jsx"),
    auth: await server.ssrLoadModule("/../shared/src/context/AuthContext.jsx"),
    axios: await server.ssrLoadModule("/../shared/src/api/axiosClient.js"),
    router: await import("react-router-dom"),
    client: await import("react-dom/client")
  };
});
after(async () => {
  await server?.close();
  dom?.window.close();
});

let currentUser;
let locationNow = "";
beforeEach(() => {
  if (!JSDOM) return;
  calls = [];
  routes = defaultRoutes();
  // The adapter plays the server: unknown routes are refused, as the backend refuses a tour_admin.
  mods.axios.default.defaults.adapter = async (config) => {
    const url = new URL(config.url, "http://api.test/api");
    const method = String(config.method || "get").toUpperCase();
    const pathname = url.pathname.replace(/^\/api/, "");
    const body = config.data ? JSON.parse(config.data) : {};
    calls.push({ method, pathname, query: url.searchParams, body, headers: config.headers });
    const handler = routes[`${method} ${pathname}`];
    const result = handler ? await handler({ user: currentUser, query: url.searchParams, body }) : serverError(403, "FORBIDDEN", "Forbidden");
    if (result?.__error) {
      return Promise.reject({ config, response: { status: result.__error.status, data: { success: false, message: result.__error.message, error: { code: result.__error.code } } } });
    }
    return { data: { success: true, message: "ok", data: result }, status: 200, statusText: "OK", headers: {}, config };
  };
});
afterEach(async () => {
  if (!reactRoot) return;
  await act(async () => { reactRoot.unmount(); await sleep(10); });
  reactRoot = null;
  document.body.innerHTML = "<div id=\"root\"></div>";
});

const LocationProbe = () => {
  const location = mods.router.useLocation();
  locationNow = `${location.pathname}${location.search}`;
  return null;
};

const mount = async (pathname, user) => {
  currentUser = user;
  localStorage.clear();
  if (user) {
    localStorage.setItem("zanzibar_auth_token", "test-token");
    localStorage.setItem("zanzibar_auth_user", JSON.stringify(user));
  }
  rootElement = document.getElementById("root");
  reactRoot = mods.client.createRoot(rootElement);
  await act(async () => {
    reactRoot.render(
      React.createElement(mods.router.MemoryRouter, { initialEntries: [pathname] },
        React.createElement(mods.auth.AuthProvider, null,
          React.createElement(mods.routes.default),
          React.createElement(LocationProbe)))
    );
    await sleep(20);
  });
};

const text = () => document.body.textContent || "";
const waitFor = async (predicate, label = "condition") => {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (predicate()) return;
    await act(async () => { await sleep(20); });
  }
  assert.fail(`Timed out waiting for ${label}. Location ${locationNow}. Text: ${text().slice(0, 400)}`);
};
const buttons = () => [...document.querySelectorAll("button")];
const button = (label) => buttons().find((element) => element.textContent.trim() === label);
const click = async (element) => {
  await act(async () => { element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await sleep(10); });
};
const setValue = async (element, value) => {
  const prototype = element.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype : element.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
  await act(async () => {
    element.dispatchEvent(new dom.window.Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    await sleep(5);
  });
};
const submit = async (form) => {
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await sleep(10); });
};
const apiPaths = () => calls.map((call) => `${call.method} ${call.pathname}`);
const FINANCIAL = /\$|USD|TZS|amount|price|revenue|profit|commission|invoice|ledger|cost|settlement/i;
const rendered = (name, body) => test(name, { skip: !JSDOM && "jsdom is not installed" }, body);

rendered("tour_admin lands on the Tour Dashboard and never reaches staff screens or staff APIs", async () => {
  await mount("/admin", USERS.tour_admin);
  await waitFor(() => locationNow === "/admin/tour-admin" && /Escalated to Finance/.test(text()), "tour dashboard");
  for (const pathname of ["/admin/booking-accounting/invoices", "/admin/business-accounting/settlements", "/admin/operations/booking-requests", "/admin/business-accounting/general-ledger", "/admin/settings/create-admin"]) {
    await act(async () => { reactRoot.unmount(); });
    await mount(pathname, USERS.tour_admin);
    await waitFor(() => locationNow === "/admin/tour-admin", `${pathname} redirects`);
  }
  const reached = new Set(apiPaths());
  assert.ok([...reached].every((call) => call === "GET /auth/me" || call.startsWith("GET /tour-operations/")), [...reached].join(", "));
  assert.ok(!reached.has("GET /reports/operations-overview"), "staff sync summary is not requested");
  const sidebar = document.querySelector("#admin-platform-sidebar")?.textContent || "";
  assert.match(sidebar, /Tour Bookings/);
  assert.doesNotMatch(sidebar, /Invoices|Settlements|General Ledger|Payments|Booking Requests/);
  assert.match(text(), /Tour Admin/);
});

rendered("staff and agents cannot open Tour Admin; admins can", async () => {
  await mount("/admin/tour-admin/bookings", USERS.staff);
  await waitFor(() => locationNow === "/admin", "staff redirected to their own landing page");
  assert.ok(!apiPaths().some((call) => call.includes("/tour-operations/")), "no Tour Operations call for staff");
  await act(async () => { reactRoot.unmount(); });

  await mount("/admin/tour-admin/requests", USERS.agent);
  await waitFor(() => /No Back Office access/.test(text()), "agent refused");
  assert.ok(!apiPaths().some((call) => call.includes("/tour-operations/")));
  await act(async () => { reactRoot.unmount(); });

  await mount("/admin/tour-admin/requests", USERS.admin);
  await waitFor(() => /REQ-1/.test(text()), "admin sees requests");
  assert.equal(locationNow, "/admin/tour-admin/requests");
});

rendered("dashboard shows server totals only, marks failed figures Unavailable and shows no money", async () => {
  routes["GET /tour-operations/requests"] = ({ query }) => (query.get("state") === "AWAITING_FINANCE" ? serverError(500, "BOOM", "boom") : { items: [], page: 1, limit: 1, total: 2, hasMore: false });
  await mount("/admin/tour-admin", USERS.tour_admin);
  await waitFor(() => /Escalated to Finance/.test(text()) && /Unavailable/.test(text()), "dashboard figures");
  const metric = (label) => [...document.querySelectorAll(".tour-admin-metric")].find((card) => card.textContent.includes(label))?.querySelector("strong")?.textContent;
  assert.equal(metric("Website bookings"), "60");
  assert.equal(metric("Awaiting supplier action"), "2");
  assert.equal(metric("Escalated to Finance"), "Unavailable");
  assert.equal(metric("Open requests"), "Unavailable", "a total is never shown when one part failed");
  assert.match(text(), /Some figures could not be loaded|Something went wrong|boom/);
  assert.doesNotMatch(document.querySelector(".tour-admin-dashboard").textContent, FINANCIAL);
  const normalized = (query) => [...query.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join("&");
  const bookingQueries = calls.filter((call) => call.pathname === "/tour-operations/bookings").map((call) => normalized(call.query)).sort();
  assert.deepEqual(bookingQueries, ["bookingStatus=cancelled&limit=1", "bookingStatus=confirmed&limit=1", "bookingStatus=failed&limit=1", "limit=1&origin=AGENT_PORTAL", "limit=1&origin=WEBSITE", "limit=1&supplierStatus=supplier_pending"].sort());
});

rendered("booking list: separate payment, Bókun and supplier columns, filters and pagination", async () => {
  await mount("/admin/tour-admin/bookings", USERS.tour_admin);
  await waitFor(() => document.querySelectorAll(".tour-admin-bookings-table tbody tr").length === 3, "rows");
  const rows = [...document.querySelectorAll(".tour-admin-bookings-table tbody tr")].map((row) => row.textContent);
  assert.match(rows[0], /Payment verified/);
  assert.match(rows[0], /Awaiting supplier/);
  assert.match(rows[0], /Not in Bókun/);
  assert.match(rows[0], /Paid, awaiting supplier confirmation/);
  assert.doesNotMatch(rows[0], /Supplier confirmed/, "a paid booking is not shown as supplier confirmed");
  assert.match(rows[1], /Agent Portal/);
  assert.match(rows[1], /Supplier confirmed/);
  assert.match(rows[2], /from booking history/);
  assert.match(rows[2], /Failed/);
  assert.doesNotMatch(document.querySelector(".tour-admin-bookings-table").textContent, FINANCIAL);
  assert.match(text(), /60 bookings · page 1 of 3/);

  await setValue(document.getElementById("tour-bookings-origin"), "AGENT_PORTAL");
  await setValue(document.getElementById("tour-bookings-supplier"), "supplier_pending");
  await submit(document.querySelector(".tour-admin-filters"));
  await waitFor(() => locationNow.includes("origin=AGENT_PORTAL"), "filters in URL");
  await waitFor(() => calls.at(-1).query.get("origin") === "AGENT_PORTAL", "filtered request");
  assert.equal(calls.at(-1).query.get("supplierStatus"), "supplier_pending");
  assert.equal(calls.at(-1).query.get("page"), "1");

  await click(button("Next"));
  await waitFor(() => calls.at(-1).query.get("page") === "2", "page 2 requested");
  assert.equal(calls.at(-1).query.get("origin"), "AGENT_PORTAL", "filters kept while paging");

  await setValue(document.getElementById("tour-bookings-search"), "ab");
  await submit(document.querySelector(".tour-admin-filters"));
  assert.match(text(), /Search needs a full booking reference or email address/);
});

rendered("loading, empty, error and access-denied states", async () => {
  let release;
  routes["GET /tour-operations/bookings"] = () => new Promise((resolve) => { release = () => resolve({ items: [], page: 1, limit: 25, total: 0, hasMore: false }); });
  await mount("/admin/tour-admin/bookings", USERS.tour_admin);
  await waitFor(() => /Loading tour bookings/.test(text()), "loading state");
  await act(async () => { release(); await sleep(10); });
  await waitFor(() => /No tour bookings match these filters/.test(text()), "empty state");
  await act(async () => { reactRoot.unmount(); });

  routes["GET /tour-operations/bookings"] = () => serverError(500, "INTERNAL", "Something went wrong");
  await mount("/admin/tour-admin/bookings", USERS.tour_admin);
  await waitFor(() => document.querySelector(".tour-admin-bookings .alert-danger"), "error state");
  await act(async () => { reactRoot.unmount(); });

  routes["GET /tour-operations/bookings"] = () => serverError(403, "FORBIDDEN_PERMISSION", "Forbidden");
  await mount("/admin/tour-admin/bookings", USERS.tour_admin);
  await waitFor(() => /does not have access to this Tour Admin information/.test(text()), "server refusal explained");
});

rendered("booking details: contact, payment versus supplier, its requests, and nothing editable", async () => {
  await mount("/admin/tour-admin/bookings/ZNZ-170000000001-1001", USERS.tour_admin);
  await waitFor(() => /Customer requests/.test(text()) && /REQ-1/.test(text()), "details with requests");
  assert.match(text(), /guest1@example\.test/);
  assert.match(text(), /Payment is verified, but the supplier has not confirmed this booking yet/);
  const requestCall = calls.find((call) => call.pathname === "/tour-operations/requests");
  assert.equal(requestCall.query.get("bookingReference"), "ZNZ-170000000001-1001");
  assert.equal(calls.find((call) => call.pathname === "/tour-operations/bookings").query.get("search"), "ZNZ-170000000001-1001");
  const page = document.querySelector(".tour-admin-booking-details");
  assert.equal(page.querySelectorAll("input, select, textarea").length, 0, "no editable fields");
  assert.deepEqual([...page.querySelectorAll("button, a.btn")].map((element) => element.textContent.trim()).sort(), ["All bookings", "Refresh"]);
  // Financial data markers only; the page may say that amounts are handled by Finance.
  assert.doesNotMatch(document.querySelector(".tour-admin-booking-details").textContent, /\$|USD|TZS|INV-|commission|cost|price/i);
  assert.ok(apiPaths().every((call) => call === "GET /auth/me" || call.startsWith("GET /tour-operations/")));
});

rendered("request details: only server-permitted actions, confirmation, reason, no duplicates, Finance escalation", async () => {
  await mount("/admin/tour-admin/requests/r1", USERS.tour_admin);
  await waitFor(() => /Tour Operations actions/.test(text()), "actions");
  const labels = buttons().map((element) => element.textContent.trim());
  for (const expected of ["Start review", "Escalate for supplier action", "Escalate to Finance", "Reject (internal)", "Save category", "Add note"]) assert.ok(labels.includes(expected), expected);
  for (const forbidden of [/refund/i, /approve/i, /mark paid/i, /payment link/i, /cancel booking/i, /retry/i, /send email/i, /confirm supplier/i, /assign/i]) {
    assert.ok(!labels.some((label) => forbidden.test(label)), `no ${forbidden} control`);
  }
  assert.match(text(), /RESOLVED does not mean a supplier change/);

  await click(button("Escalate to Finance"));
  await waitFor(() => document.querySelector(".modal") && /flags the request for Finance/.test(text()), "confirmation dialog");
  const confirm = () => [...document.querySelectorAll(".modal button")].find((element) => element.textContent.trim() === "Confirm");
  assert.equal(confirm().disabled, true, "reason required before confirming");
  await setValue(document.getElementById("tour-transition-reason"), "Refund decision needed");
  assert.equal(confirm().disabled, false);
  await act(async () => {
    confirm().dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    confirm().dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await sleep(30);
  });
  await waitFor(() => /Only the internal Tour Operations state changed/.test(text()), "success message");
  const posts = calls.filter((call) => call.method === "POST");
  assert.equal(posts.length, 1, "double click sends one request");
  assert.equal(posts[0].pathname, "/tour-operations/requests/r1/transition");
  assert.deepEqual(posts[0].body, { toState: "AWAITING_FINANCE", expectedVersion: 0, reason: "Refund decision needed" });
  assert.ok(calls.every((call) => call.pathname === "/auth/me" || call.pathname.startsWith("/tour-operations/")), "no refund, payment or supplier endpoint");
});

rendered("internal notes and category changes go to the Tour Operations endpoints", async () => {
  await mount("/admin/tour-admin/requests/r1", USERS.tour_admin);
  await waitFor(() => /Tour Operations actions/.test(text()), "actions");
  await setValue(document.getElementById("tour-request-note"), "Called the guest");
  await submit(document.getElementById("tour-request-note").closest("form"));
  await waitFor(() => calls.some((call) => call.pathname === "/tour-operations/requests/r1/notes"), "note posted");
  assert.deepEqual(calls.find((call) => call.pathname.endsWith("/notes")).body, { text: "Called the guest" });
  await waitFor(() => /Internal note added/.test(text()), "note confirmation");

  await setValue(document.getElementById("tour-request-category"), "refund_inquiry");
  await submit(document.getElementById("tour-request-category").closest("form"));
  await waitFor(() => calls.some((call) => call.pathname.endsWith("/category")), "category posted");
  assert.deepEqual(calls.find((call) => call.pathname.endsWith("/category")).body, { category: "refund_inquiry", expectedVersion: 0 });
});

rendered("a conflicting change reloads the request instead of overwriting it", async () => {
  routes["POST /tour-operations/requests/r1/transition"] = () => serverError(409, "TOUR_REQUEST_VERSION_CONFLICT", "changed");
  await mount("/admin/tour-admin/requests/r1", USERS.tour_admin);
  await waitFor(() => /Tour Operations actions/.test(text()), "actions");
  const detailLoads = () => calls.filter((call) => call.method === "GET" && call.pathname === "/tour-operations/requests/r1").length;
  const before = detailLoads();
  await click(button("Start review"));
  await waitFor(() => document.querySelector(".modal"), "dialog");
  await click([...document.querySelectorAll(".modal button")].find((element) => element.textContent.trim() === "Confirm"));
  await waitFor(() => /changed by someone else/.test(text()), "conflict explained");
  assert.ok(detailLoads() > before, "latest version reloaded");
});

rendered("read-only Tour Admin accounts get no action controls", async () => {
  await mount("/admin/tour-admin/requests/r1", USERS.tour_reader);
  await waitFor(() => /Internal notes/.test(text()), "request loaded");
  assert.doesNotMatch(text(), /Tour Operations actions/);
  assert.equal(button("Escalate to Finance"), undefined);
  assert.equal(document.getElementById("tour-request-note"), null);
});
