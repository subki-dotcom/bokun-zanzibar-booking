process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/production-readiness-route-test";
process.env.JWT_SECRET ||= "production-readiness-route-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");

const app = require("../src/app");
const User = require("../src/models/User");
const productionReadinessService = require("../src/services/productionReadiness");

const userId = "66dddddddddddddddddddddd";

const token = () =>
  jwt.sign(
    {
      sub: userId,
      userType: "user"
    },
    process.env.JWT_SECRET,
    { expiresIn: "5m" }
  );

const withMockUser = (role = "admin") => {
  const originalFindById = User.findById;
  User.findById = () => ({
    lean: async () => ({
      _id: { toString: () => userId },
      firstName: "Readiness",
      lastName: "User",
      fullName: "Readiness User",
      role,
      isActive: true,
      email: `${role}@example.test`
    })
  });
  return () => {
    User.findById = originalFindById;
  };
};

const listen = async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
};

const close = (server) =>
  new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

test("production readiness summary blocks staff and returns release gate evidence to admins", async () => {
  const restoreStaff = withMockUser("staff");
  const staffServer = await listen();

  try {
    const { port } = staffServer.address();
    const forbidden = await fetch(`http://127.0.0.1:${port}/api/admin/production-readiness/summary`, {
      headers: { Authorization: `Bearer ${token()}` }
    });
    assert.equal(forbidden.status, 403);
  } finally {
    restoreStaff();
    await close(staffServer);
  }

  const restoreAdmin = withMockUser("admin");
  const originalGetSummary = productionReadinessService.getSummary;
  productionReadinessService.getSummary = async () => ({
    generatedAt: "2026-08-20T10:00:00.000Z",
    status: "review_required",
    releaseGate: {
      canRelease: false,
      requiresReview: true,
      blocked: false
    },
    counts: { pass: 9, warn: 1, fail: 0, total: 10 },
    checks: [{ id: "backup_restore", status: "warn" }],
    invariants: ["Read-only release gate"]
  });
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/production-readiness/summary`, {
      headers: { Authorization: `Bearer ${token()}` }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.status, "review_required");
    assert.equal(payload.data.releaseGate.requiresReview, true);
    assert.equal(payload.data.checks[0].id, "backup_restore");
  } finally {
    productionReadinessService.getSummary = originalGetSummary;
    restoreAdmin();
    await close(server);
  }
});
