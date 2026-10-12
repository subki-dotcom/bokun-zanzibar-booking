// Phase 3C: the Finance escalation queue screens inside the Back Office (read-only).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ADMIN_PERMISSIONS, filterAdminNavigation, getAdminRouteMeta } from "../src/config/adminNavigation.js";
import { createRenderHarness, serverError } from "./support/backOfficeRenderHarness.js";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const STAFF_PERMISSIONS = ["admin.dashboard.read", "operations.read", "booking_accounting.read", "payment_reconciliation.read", "settlement.view"];
const USERS = {
  finance: { id: "u-fin", fullName: "Finance Staff", email: "fin@example.test", role: "staff", permissions: STAFF_PERMISSIONS },
  staffWithoutFinance: { id: "u-ops", fullName: "Ops Staff", email: "ops@example.test", role: "staff", permissions: ["admin.dashboard.read", "operations.read"] },
  admin: { id: "u-admin", fullName: "Admin", email: "admin@example.test", role: "admin", permissions: [...Object.values(ADMIN_PERMISSIONS), ...STAFF_PERMISSIONS] },
  tour_admin: { id: "u-tour", fullName: "Tour", email: "tour@example.test", role: "tour_admin", permissions: ["tour_operations.read", "tour_requests.read", "tour_requests.process"] },
  agent: { id: "u-agent", fullName: "Agent", email: "agent@example.test", role: "agent", permissions: ["agent_portal.read"], approvalStatus: "approved", termsAcceptedAt: "2026-01-01" }
};

const findById = (items, id) => {
  for (const item of items) {
    if (item.id === id) return item;
    const child = item.children ? findById(item.children, id) : null;
    if (child) return child;
  }
  return null;
};

test("Finance Escalations sits in Booking Accounting for holders of booking_accounting.read only", () => {
  assert.ok(findById(filterAdminNavigation(undefined, USERS.finance), "finance-escalations"));
  assert.ok(findById(filterAdminNavigation(undefined, USERS.admin), "finance-escalations"));
  assert.equal(findById(filterAdminNavigation(undefined, USERS.staffWithoutFinance), "finance-escalations"), null);
  assert.equal(findById(filterAdminNavigation(undefined, USERS.tour_admin), "finance-escalations"), null);
  assert.deepEqual(filterAdminNavigation(undefined, USERS.agent), []);
  assert.equal(getAdminRouteMeta("/admin/finance/escalations").label, "Finance Escalations");
  assert.equal(getAdminRouteMeta("/admin/finance/escalations/abc").label, "Escalation Details");
});

test("Finance pages only use the read-only escalation API", () => {
  const api = read("src/api/financeEscalationsApi.js");
  assert.doesNotMatch(api, /axiosClient\.(post|put|patch|delete)/);
  for (const file of fs.readdirSync(path.join(root, "src/pages/admin/finance"))) {
    const imports = [...read(`src/pages/admin/finance/${file}`).matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]).filter((value) => value.includes("/api/"));
    assert.deepEqual(imports, ["../../../api/financeEscalationsApi"], file);
  }
});

const queueItem = (n, overrides = {}) => ({
  id: `r${n}`, requestReference: `REQ-${n}`, type: "cancel_booking", category: "refund_inquiry", state: "AWAITING_FINANCE", customerStatus: "submitted",
  submittedAt: "2026-10-02T10:00:00.000Z", escalation: { reason: `Refund decision ${n}`, at: "2026-10-05T10:00:00.000Z", fromState: "UNDER_REVIEW", actorId: "u-tour", actorRole: "tour_admin" },
  escalationCount: 1, finance: { refundRequired: true, refundStatus: "requested", additionalPaymentRequired: false, additionalPaymentStatus: "not_required" },
  supplier: { syncStatus: "not_required" },
  booking: { bookingReference: `ZNZ-17000000000${n}-300${n}`, origin: "WEBSITE", originBasis: "recorded", agentId: null, tour: { productTitle: "Spice Tour", travelDate: "2026-12-10" }, customer: { firstName: "Guest", lastName: `N${n}`, email: `guest${n}@example.test` }, status: { booking: "confirmed", payment: "paid", supplier: "confirmed" }, supplierSync: { linkedToBokun: true } },
  ...overrides
});
const detail = (overrides = {}) => ({
  ...queueItem(1),
  request: { original: { date: "2026-12-10", startTime: "09:00", optionTitle: "Morning", travelers: { adults: 2 } }, requestedChanges: { date: "", startTime: "", travelers: null }, customerReason: "Flight cancelled", customerNotes: "", decision: { decision: "", customerFacingReason: "", decidedAt: null } },
  supplier: { syncStatus: "not_required", lastAttemptAt: null, syncedAt: null },
  escalations: [{ id: "h1", action: "escalated", escalatedTo: "FINANCE", text: "Refund decision 1", fromState: "UNDER_REVIEW", toState: "AWAITING_FINANCE", actorId: "u-tour", actorRole: "tour_admin", at: "2026-10-05T10:00:00.000Z" }],
  operations: {
    state: "AWAITING_FINANCE", category: "refund_inquiry", version: 2,
    notes: [{ id: "n1", action: "note_added", text: "Guest prefers refund to card", actorId: "u-tour", actorRole: "tour_admin", at: "2026-10-05T09:00:00.000Z" }],
    history: [
      { id: "h0", action: "state_changed", fromState: "RECEIVED", toState: "UNDER_REVIEW", actorId: "u-tour", actorRole: "tour_admin", at: "2026-10-05T08:00:00.000Z" },
      { id: "h1", action: "escalated", escalatedTo: "FINANCE", text: "Refund decision 1", fromState: "UNDER_REVIEW", toState: "AWAITING_FINANCE", actorId: "u-tour", actorRole: "tour_admin", at: "2026-10-05T10:00:00.000Z" }
    ]
  },
  financeEvidence: {
    currency: "USD",
    refund: { required: true, status: "requested", estimatedAmount: 150, eligibleAmount: null, approvedAmount: null, requestedAmount: null, confirmedRefundedAmount: null, cancellationFee: null, providerLabel: "" },
    additionalPayment: { required: false, status: "not_required" },
    priceAdjustment: { type: "refund", originalAmount: 200, newAmount: null, difference: null },
    invoice: { invoiceNumber: "INV-1", paymentStatus: "paid", total: 200, amountPaid: 200, amountRefunded: 0, balanceDue: 0 }
  },
  auditTrail: [{ action: "booking_request_submitted", actorRole: "customer", at: "2026-10-02T10:00:00.000Z" }, { action: "tour_request_escalated", actorRole: "tour_admin", at: "2026-10-05T10:00:00.000Z" }],
  notice: "Review only. Escalation does not refund, charge, cancel, re-date or re-invoice anything.",
  ...overrides
});

const defaultRoutes = () => ({
  "GET /auth/me": ({ user }) => user,
  "GET /admin/finance/escalations": ({ query }) => {
    const items = [queueItem(1), queueItem(2, { escalation: null, category: "date_change", type: "reschedule" })];
    return { items, page: Number(query.get("page") || 1), limit: Number(query.get("limit") || 25), total: 40, hasMore: true };
  },
  "GET /admin/finance/escalations/r1": () => detail()
});

const h = createRenderHarness({ defaultRoutes });
const { mount, text, waitFor, buttons, button, click, setValue, submit } = h;

test("Tour Admin, staff without Finance access and agents cannot open the queue", async () => {
  await mount("/admin/finance/escalations", USERS.tour_admin);
  await waitFor(() => h.locationNow === "/admin/tour-admin", "tour_admin sent to its own landing page");
  assert.ok(!h.calls.some((call) => call.pathname.startsWith("/admin/finance")), "no Finance call for tour_admin");

  await mount("/admin/finance/escalations/r1", USERS.staffWithoutFinance);
  await waitFor(() => h.locationNow === "/admin", "staff without booking_accounting.read redirected");
  assert.ok(!h.calls.some((call) => call.pathname.startsWith("/admin/finance")));

  await mount("/admin/finance/escalations", USERS.agent);
  await waitFor(() => /No Back Office access/.test(text()), "agent refused");
  assert.ok(!h.calls.some((call) => call.pathname.startsWith("/admin/finance")));
});

test("queue lists escalations with reason and time, says when they were not recorded, and filters and pages", async () => {
  await mount("/admin/finance/escalations", USERS.finance);
  await waitFor(() => document.querySelectorAll(".finance-escalations-table tbody tr").length === 2, "rows");
  const rows = [...document.querySelectorAll(".finance-escalations-table tbody tr")].map((row) => row.textContent);
  assert.match(rows[0], /ZNZ-170000000001-3001/);
  assert.match(rows[0], /REQ-1/);
  assert.match(rows[0], /Refund question/);
  assert.match(rows[0], /Escalated to Finance/);
  assert.match(rows[0], /Refund decision 1/);
  assert.match(rows[1], /Not recorded/, "missing escalation data is shown as not recorded");
  assert.match(text(), /40 escalations · page 1 of 2/);

  await setValue(document.getElementById("finance-escalations-scope"), "all");
  await setValue(document.getElementById("finance-escalations-category"), "refund_inquiry");
  await setValue(document.getElementById("finance-escalations-booking"), "ZNZ-170000000001-3001");
  await submit(document.querySelector(".finance-escalation-filters"));
  await waitFor(() => h.calls.at(-1).query.get("scope") === "all", "filtered request");
  assert.equal(h.calls.at(-1).query.get("category"), "refund_inquiry");
  assert.equal(h.calls.at(-1).query.get("bookingReference"), "ZNZ-170000000001-3001");
  await click(button("Next"));
  await waitFor(() => h.calls.at(-1).query.get("page") === "2", "page 2");
  assert.equal(h.calls.at(-1).query.get("scope"), "all");
  assert.ok(h.calls.every((call) => call.method === "GET"), "the queue only reads");
});

test("loading, empty and error states", async () => {
  let release;
  h.routes["GET /admin/finance/escalations"] = () => new Promise((resolve) => { release = () => resolve({ items: [], page: 1, limit: 25, total: 0, hasMore: false }); });
  await mount("/admin/finance/escalations", USERS.finance);
  await waitFor(() => /Loading Finance escalations/.test(text()), "loading");
  await h.act(async () => { release(); await h.sleep(10); });
  await waitFor(() => /No requests are waiting for Finance/.test(text()), "empty");

  h.routes["GET /admin/finance/escalations"] = () => serverError(403, "FORBIDDEN_PERMISSION", "Forbidden");
  await mount("/admin/finance/escalations", USERS.finance);
  await waitFor(() => /does not have access/.test(text()), "server refusal explained");
});

test("detail shows the request, Tour notes, history and recorded evidence, with no Finance actions", async () => {
  await mount("/admin/finance/escalations/r1", USERS.finance);
  await waitFor(() => /Finance evidence/.test(text()), "detail");
  assert.match(text(), /Flight cancelled/);
  assert.match(text(), /Guest prefers refund to card/);
  assert.match(text(), /Escalated to Finance \(Under review → Escalated to Finance\)/);
  assert.match(text(), /Review only/);
  const evidence = document.querySelector(".finance-evidence-table").textContent;
  assert.match(evidence, /Estimated refund\$150\.00/);
  assert.match(evidence, /Approved refundNot recorded/, "a missing amount is never shown as zero");
  assert.match(text(), /Invoice INV-1/);
  const page = document.querySelector(".finance-escalation-details");
  assert.equal(page.querySelectorAll("input, select, textarea, form").length, 0, "nothing to submit");
  const controls = [...page.querySelectorAll("button, a.btn")].map((element) => element.textContent.trim()).sort();
  assert.deepEqual(controls, ["All escalations", "Open in Booking Requests", "Refresh"]);
  assert.equal(page.querySelector("a.btn[href='/admin/operations/booking-requests/r1']")?.textContent.trim(), "Open in Booking Requests");
  for (const label of [/refund now/i, /approve/i, /mark paid/i, /cancel/i, /resolve/i, /escalate/i]) {
    assert.ok(!buttons().some((element) => label.test(element.textContent)), `no ${label} control`);
  }
  assert.ok(h.calls.every((call) => call.method === "GET"), "no writes from the detail screen");
});

test("a request that is not in the queue reports not found", async () => {
  h.routes["GET /admin/finance/escalations/r9"] = () => serverError(404, "FINANCE_ESCALATION_NOT_FOUND", "Escalated request not found");
  await mount("/admin/finance/escalations/r9", USERS.finance);
  await waitFor(() => /Not found/.test(text()), "not found");
});
