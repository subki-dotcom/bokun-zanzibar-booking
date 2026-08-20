process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/system-health-route-test";
process.env.JWT_SECRET ||= "system-health-route-secret-with-enough-length";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");

const app = require("../src/app");
const User = require("../src/models/User");
const systemHealthService = require("../src/services/systemHealth");

const userId = "66cccccccccccccccccccccc";

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
      firstName: "Health",
      lastName: "User",
      fullName: "Health User",
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

test("public liveness endpoint is available without exposing admin checks", async () => {
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/health/live`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.status, "healthy");
    assert.equal(payload.data.checks, undefined);
  } finally {
    await close(server);
  }
});

test("system health admin route blocks staff and returns sanitized monitoring summary to admins", async () => {
  const restoreStaff = withMockUser("staff");
  const staffServer = await listen();

  try {
    const { port } = staffServer.address();
    const forbidden = await fetch(`http://127.0.0.1:${port}/api/admin/system-health/summary`, {
      headers: { Authorization: `Bearer ${token()}` }
    });
    assert.equal(forbidden.status, 403);
  } finally {
    restoreStaff();
    await close(staffServer);
  }

  const restoreAdmin = withMockUser("admin");
  const originalGetAdminSummary = systemHealthService.getAdminSummary;
  systemHealthService.getAdminSummary = () => ({
    generatedAt: "2026-08-20T12:00:00.000Z",
    status: "degraded",
    environment: "test",
    checks: [
      {
        id: "database_connection",
        category: "database",
        label: "MongoDB connection",
        status: "warn",
        message: "Database is connecting.",
        details: {}
      }
    ],
    workers: [],
    counts: { pass: 0, warn: 1, fail: 0, total: 1 },
    observability: { secretsRedacted: true }
  });
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/system-health/summary`, {
      headers: { Authorization: `Bearer ${token()}` }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.status, "degraded");
    assert.equal(payload.data.observability.secretsRedacted, true);
  } finally {
    systemHealthService.getAdminSummary = originalGetAdminSummary;
    restoreAdmin();
    await close(server);
  }
});
