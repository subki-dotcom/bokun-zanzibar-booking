import test from "node:test";
import assert from "node:assert/strict";

import {
  ADMIN_PERMISSIONS,
  filterAdminNavigation,
  getAdminRouteMeta
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
  assert.equal(getAdminRouteMeta("/admin/crm/b2b-agents").label, "B2B / Agents");
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

  const operations = findById(navigation, "operations");
  const bokunSync = findById(operations?.children || [], "operations-bokun-sync");
  assert.ok(bokunSync);
  for (const child of bokunSync.children || []) {
    assert.equal(child.status, "active", `${child.id} should be active`);
  }
});
