process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/security-permissions-test";
process.env.JWT_SECRET ||= "security-permissions-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PERMISSIONS,
  getPermissionsForRole,
  hasAnyPermission,
  hasPermission
} = require("../src/security/permissions");

test("admin roles receive financial and control permissions while staff does not", () => {
  assert.equal(hasPermission({ role: "super_admin" }, PERMISSIONS.BUSINESS_ACCOUNTING_WRITE), true);
  assert.equal(hasPermission({ role: "admin" }, PERMISSIONS.BUSINESS_ACCOUNTING_READ), true);
  assert.equal(hasPermission({ role: "admin" }, PERMISSIONS.REPORT_CENTER_EXPORT), true);
  assert.equal(hasPermission({ role: "admin" }, PERMISSIONS.SYSTEM_HEALTH_READ), true);
  assert.equal(hasPermission({ role: "admin" }, PERMISSIONS.PERFORMANCE_REVIEW_READ), true);

  assert.equal(hasPermission({ role: "staff" }, PERMISSIONS.OPERATIONS_READ), true);
  assert.equal(hasPermission({ role: "staff" }, PERMISSIONS.BUSINESS_ACCOUNTING_READ), false);
  assert.equal(hasPermission({ role: "staff" }, PERMISSIONS.REPORT_CENTER_READ), false);
  assert.equal(hasPermission({ role: "staff" }, PERMISSIONS.AUDIT_CONTROL_READ), false);
  assert.equal(hasPermission({ role: "staff" }, PERMISSIONS.SYSTEM_HEALTH_READ), false);
  assert.equal(hasPermission({ role: "staff" }, PERMISSIONS.PERFORMANCE_REVIEW_READ), false);
});

test("permission checks can use explicit auth permissions without changing user roles", () => {
  const auth = {
    role: "staff",
    permissions: [PERMISSIONS.REPORT_CENTER_READ]
  };

  assert.equal(hasPermission(auth, PERMISSIONS.REPORT_CENTER_READ), true);
  assert.equal(hasAnyPermission(auth, [PERMISSIONS.AUDIT_CONTROL_READ, PERMISSIONS.REPORT_CENTER_READ]), true);
  assert.equal(hasPermission(auth, PERMISSIONS.BUSINESS_ACCOUNTING_WRITE), false);
});

test("agent permissions stay isolated from admin permissions", () => {
  const permissions = getPermissionsForRole("agent");

  assert.equal(permissions.includes(PERMISSIONS.AGENT_PORTAL_READ), true);
  assert.equal(permissions.includes(PERMISSIONS.BUSINESS_INTELLIGENCE_READ), false);
});
