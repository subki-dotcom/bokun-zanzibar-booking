process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/audit-control-route-test";
process.env.JWT_SECRET ||= "audit-control-route-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");

const app = require("../src/app");
const User = require("../src/models/User");
const auditControlService = require("../src/services/auditControl");

const userId = "66cccccccccccccccccccccc";

const adminToken = () =>
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

test("audit control summary route requires admin auth", async () => {
  const restoreUser = withMockUser("admin");
  const originalGetSummary = auditControlService.getSummary;
  auditControlService.getSummary = async () => ({
    totalAuditEvents: 3,
    totalFinancialChanges: 2,
    immutableAudit: true
  });
  const server = await listen();

  try {
    const { port } = server.address();
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/admin/audit-control/summary`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`http://127.0.0.1:${port}/api/admin/audit-control/summary`, {
      headers: {
        Authorization: `Bearer ${adminToken()}`
      }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.immutableAudit, true);
    assert.equal(payload.data.totalFinancialChanges, 2);
  } finally {
    auditControlService.getSummary = originalGetSummary;
    restoreUser();
    await close(server);
  }
});

test("audit control financial changes route validates filters and blocks staff role", async () => {
  const restoreStaff = withMockUser("staff");
  const serverForStaff = await listen();

  try {
    const { port } = serverForStaff.address();
    const forbidden = await fetch(`http://127.0.0.1:${port}/api/admin/audit-control/financial-changes`, {
      headers: {
        Authorization: `Bearer ${adminToken()}`
      }
    });
    assert.equal(forbidden.status, 403);
  } finally {
    restoreStaff();
    await close(serverForStaff);
  }

  const restoreAdmin = withMockUser("admin");
  const originalListFinancialChanges = auditControlService.listFinancialChanges;
  let capturedArgs = null;
  auditControlService.listFinancialChanges = async (args) => {
    capturedArgs = args;
    return {
      items: [
        {
          id: "audit-financial-1",
          actor: { id: "admin-1", role: "admin" },
          entity: { type: "BusinessExpense", id: "expense-1" },
          action: "business_expense_updated"
        }
      ],
      pagination: { page: 2, limit: 5, total: 1 },
      immutable: true
    };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(
      `http://127.0.0.1:${port}/api/admin/audit-control/financial-changes?entityType=BusinessExpense&minAmount=10&page=2&limit=5`,
      {
        headers: {
          Authorization: `Bearer ${adminToken()}`
        }
      }
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.deepEqual(capturedArgs, {
      entityType: "BusinessExpense",
      minAmount: 10,
      page: 2,
      limit: 5
    });
    assert.equal(payload.data.items[0].entity.type, "BusinessExpense");

    const invalid = await fetch(`http://127.0.0.1:${port}/api/admin/audit-control/financial-changes?limit=999`, {
      headers: {
        Authorization: `Bearer ${adminToken()}`
      }
    });
    assert.equal(invalid.status, 422);
  } finally {
    auditControlService.listFinancialChanges = originalListFinancialChanges;
    restoreAdmin();
    await close(server);
  }
});

test("audit logs route forwards pagination and reference filters", async () => {
  const restoreUser = withMockUser("admin");
  const originalListAuditLogs = auditControlService.listAuditLogs;
  let capturedArgs = null;
  auditControlService.listAuditLogs = async (args) => {
    capturedArgs = args;
    return {
      items: [{ id: "audit-1", reference: args.reference }],
      pagination: { page: args.page, limit: args.limit, total: 1 },
      immutable: true
    };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(
      `http://127.0.0.1:${port}/api/admin/audit-control/audit-logs?reference=ZNZ-AUD-1&page=3&limit=25`,
      {
        headers: {
          Authorization: `Bearer ${adminToken()}`
        }
      }
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.deepEqual(capturedArgs, {
      reference: "ZNZ-AUD-1",
      page: 3,
      limit: 25
    });
    assert.equal(payload.data.items[0].reference, "ZNZ-AUD-1");
  } finally {
    auditControlService.listAuditLogs = originalListAuditLogs;
    restoreUser();
    await close(server);
  }
});
