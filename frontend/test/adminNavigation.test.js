import test from "node:test";
import assert from "node:assert/strict";

import {
  ADMIN_PERMISSIONS,
  filterAdminNavigation,
  getAdminRouteMeta,
  isAdminNavItemActive,
  adminNavigationItems
} from "../src/config/adminNavigation.js";

const findById = (items, id) => {
  for (const item of items) {
    if (item.id === id) return item;
    const child = item.children ? findById(item.children, id) : null;
    if (child) return child;
  }
  return null;
};

test("CRM navigation is available to admins with CRM permissions", () => {
  const navigation = filterAdminNavigation(undefined, {
    role: "admin",
    permissions: [
      ADMIN_PERMISSIONS.CRM_VIEW,
      ADMIN_PERMISSIONS.CRM_VIEW_CUSTOMERS,
      ADMIN_PERMISSIONS.CRM_MANAGE_CUSTOMERS,
      ADMIN_PERMISSIONS.CRM_MANAGE_LEADS,
      ADMIN_PERMISSIONS.CRM_MANAGE_OPPORTUNITIES,
      ADMIN_PERMISSIONS.CRM_MANAGE_QUOTES,
      ADMIN_PERMISSIONS.CRM_MANAGE_FOLLOWUPS,
      ADMIN_PERMISSIONS.CRM_VIEW_SALES_ANALYTICS,
      ADMIN_PERMISSIONS.CRM_MANAGE_B2B
    ]
  });
  const crm = findById(navigation, "crm");

  assert.ok(crm);
  assert.ok(findById(navigation, "crm-customers"));
  assert.ok(findById(navigation, "crm-duplicates"));
  assert.equal(findById(navigation, "crm-leads")?.status, "active");
  assert.equal(findById(navigation, "crm-opportunities")?.status, "active");
  assert.equal(findById(navigation, "crm-pipeline")?.status, "active");
  assert.equal(findById(navigation, "crm-quotes")?.status, "active");
  assert.equal(findById(navigation, "crm-follow-ups")?.status, "active");
  assert.equal(findById(navigation, "crm-tasks")?.status, "active");
  assert.equal(findById(navigation, "crm-conversations")?.status, "active");
  assert.equal(findById(navigation, "crm-b2b-agents")?.status, "active");
  assert.equal(findById(navigation, "crm-lost-opportunities")?.status, "active");
  assert.equal(findById(navigation, "crm-reports")?.status, "active");
  assert.equal(findById(navigation, "crm-controls")?.status, "active");
  assert.equal(findById(navigation, "crm-imports")?.status, "active");
  assert.equal(getAdminRouteMeta("/admin/crm/customers").label, "Customers");
  assert.equal(getAdminRouteMeta("/admin/crm/leads").label, "Leads");
  assert.equal(getAdminRouteMeta("/admin/crm/opportunities").label, "Opportunities");
  assert.equal(getAdminRouteMeta("/admin/crm/pipeline").label, "Sales Pipeline");
  assert.equal(getAdminRouteMeta("/admin/crm/quotes").label, "Quotes");
  assert.equal(getAdminRouteMeta("/admin/crm/follow-ups").label, "Follow-ups");
  assert.equal(getAdminRouteMeta("/admin/crm/tasks").label, "Tasks");
  assert.equal(getAdminRouteMeta("/admin/crm/conversations").label, "Conversations");
  assert.equal(getAdminRouteMeta("/admin/crm/b2b-agents").label, "Agents / B2B");
  assert.equal(getAdminRouteMeta("/admin/crm/lost-opportunities").label, "Lost Opportunities");
  assert.equal(getAdminRouteMeta("/admin/crm/reports").label, "CRM Reports");
  assert.equal(getAdminRouteMeta("/admin/crm/controls").label, "CRM Controls");
  assert.equal(getAdminRouteMeta("/admin/crm/imports").label, "CRM Imports");
});

test("CRM navigation stays hidden from staff without CRM permission grants", () => {
  const navigation = filterAdminNavigation(undefined, {
    role: "staff",
    permissions: [ADMIN_PERMISSIONS.BUSINESS_ACCOUNTING_READ]
  });

  assert.equal(findById(navigation, "crm"), null);
});

test("Booking Accounting navigation does not show planned Soon badges", () => {
  const navigation = filterAdminNavigation(undefined, {
    role: "staff",
    permissions: []
  });

  const bookingAccounting = findById(navigation, "booking-accounting");
  assert.ok(bookingAccounting);
  for (const child of bookingAccounting.children || []) {
    assert.equal(child.status, "active", `${child.id} should be active`);
  }
});

test("Bokun Sync navigation does not show planned Soon badges", () => {
  const navigation = filterAdminNavigation(undefined, {
    role: "staff",
    permissions: []
  });

  const integrations = findById(navigation, "integrations");
  assert.ok(integrations);
  assert.ok(findById(integrations.children || [], "bokun-import"));
  assert.ok(findById(integrations.children || [], "bokun-manual-sync"));
  // Manual Lookup and Sync Logs moved to the super_admin "Advanced / System" group (routes unchanged).
  assert.equal(findById(integrations.children || [], "bokun-sync-logs"), null);
});

test("admin navigation highlights nested routes from their parent path", () => {
  const navigation = filterAdminNavigation(undefined, {
    role: "staff",
    permissions: []
  });
  const bookings = findById(navigation, "operations-bookings");

  assert.equal(isAdminNavItemActive(bookings, "/admin/operations/bookings"), true);
  assert.equal(isAdminNavItemActive(bookings, "/admin/operations/bookings/ABC-123/edit"), true);
  assert.equal(isAdminNavItemActive(bookings, "/admin/operations/booking-requests"), false);
});

test("only the most specific menu item is active for a URL", () => {
  const activeFor = (pathname) => adminNavigationItems.filter((item) => isAdminNavItemActive(item, pathname)).map((item) => item.id);
  assert.deepEqual(activeFor("/admin/crm"), ["crm-dashboard"]);
  assert.deepEqual(activeFor("/admin/crm/leads"), ["crm-leads"]);
  assert.deepEqual(activeFor("/admin/crm/customers/123"), ["crm-customers"]);
  assert.deepEqual(activeFor("/admin/business-accounting"), ["management-accounting"]);
  assert.deepEqual(activeFor("/admin/business-accounting/trial-balance"), ["gl-trial-balance"]);
  assert.deepEqual(activeFor("/admin/business-accounting/settlements"), ["settlements"]);
  assert.deepEqual(activeFor("/admin/business-accounting/settlements/import"), ["settlement-import"]);
  assert.deepEqual(activeFor("/admin/audit-control/data-quality"), ["audit-control-data-quality"]);
  assert.deepEqual(activeFor("/admin"), ["main-dashboard"]);
});

test("maintenance pages sit in a super_admin-only Advanced / System group; no page is removed", () => {
  const ids = ["performance-review", "production-readiness", "gl-posting-preview", "disaster-recovery", "system-health",
    "audit-control-data-quality", "audit-control-ops-control", "bokun-sync-logs", "bokun-single-sync"];
  const superAdmin = filterAdminNavigation(undefined, "super_admin");
  const advanced = findById(superAdmin, "advanced-system");
  assert.ok(advanced);
  for (const id of ids) assert.ok(findById(advanced.children, id), id);
  const admin = filterAdminNavigation(undefined, "admin");
  assert.equal(findById(admin, "advanced-system"), null, "hidden from admin");
  assert.ok(findById(admin, "audit-control-logs"), "Audit Trail stays for admins");
  for (const id of ids) assert.ok(adminNavigationItems.some((item) => item.id === id), `${id} still has a menu entry`);
});
