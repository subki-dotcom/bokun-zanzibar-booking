process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/security-rbac-route-test";
process.env.JWT_SECRET ||= "security-rbac-route-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");

const app = require("../src/app");
const User = require("../src/models/User");
const businessAccountingService = require("../src/services/businessAccounting");
const { PERMISSIONS } = require("../src/security/permissions");

const userId = "66ffffffffffffffffffffff";

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
      firstName: "Test",
      lastName: "User",
      fullName: "Test User",
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

test("auth profile exposes permissions derived from the current role", async () => {
  const restoreUser = withMockUser("admin");
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${token()}`
      }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.role, "admin");
    assert.equal(payload.data.permissions.includes(PERMISSIONS.BUSINESS_INTELLIGENCE_READ), true);
    assert.equal(payload.data.permissions.includes(PERMISSIONS.REPORT_CENTER_EXPORT), true);
  } finally {
    restoreUser();
    await close(server);
  }
});

test("staff cannot read business accounting foundation financial data", async () => {
  const restoreUser = withMockUser("staff");
  const originalFoundation = businessAccountingService.getFoundationSummary;
  let called = false;
  businessAccountingService.getFoundationSummary = async () => {
    called = true;
    return {};
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/business-accounting/foundation`, {
      headers: {
        Authorization: `Bearer ${token()}`
      }
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.error.code, "FORBIDDEN_PERMISSION");
    assert.equal(called, false);
  } finally {
    businessAccountingService.getFoundationSummary = originalFoundation;
    restoreUser();
    await close(server);
  }
});

test("staff cannot read report center catalog through direct URL access", async () => {
  const restoreUser = withMockUser("staff");
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/report-center/catalog`, {
      headers: {
        Authorization: `Bearer ${token()}`
      }
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.error.code, "FORBIDDEN_PERMISSION");
  } finally {
    restoreUser();
    await close(server);
  }
});

test("admin can read business accounting foundation through permission middleware", async () => {
  const restoreUser = withMockUser("admin");
  const originalFoundation = businessAccountingService.getFoundationSummary;
  let capturedArgs = null;
  businessAccountingService.getFoundationSummary = async (args) => {
    capturedArgs = args;
    return {
      generatedAt: "2026-08-20T10:00:00.000Z",
      companyTotals: {
        netProfit: 10
      }
    };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(
      `http://127.0.0.1:${port}/api/admin/business-accounting/foundation?fromDate=2026-08-01&toDate=2026-08-31`,
      {
        headers: {
          Authorization: `Bearer ${token()}`
        }
      }
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.deepEqual(capturedArgs, {
      fromDate: "2026-08-01",
      toDate: "2026-08-31"
    });
    assert.equal(payload.data.companyTotals.netProfit, 10);
  } finally {
    businessAccountingService.getFoundationSummary = originalFoundation;
    restoreUser();
    await close(server);
  }
});
