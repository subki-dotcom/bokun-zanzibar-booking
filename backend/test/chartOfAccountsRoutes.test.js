process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/chart-of-accounts-route-test";
process.env.JWT_SECRET ||= "chart-of-accounts-route-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");

const app = require("../src/app");
const {
  GL_ACCOUNT_SUBTYPE,
  GL_ACCOUNT_TYPE
} = require("../src/accounting/constants");
const User = require("../src/models/User");
const chartOfAccountsService = require("../src/services/generalLedger/chartOfAccounts");

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

test("chart of accounts list route requires admin auth", async () => {
  const restoreUser = withMockUser("admin");
  const originalListAccounts = chartOfAccountsService.listAccounts;
  chartOfAccountsService.listAccounts = async () => ({
    items: [
      {
        code: "1030",
        name: "Pesapal Clearing",
        type: GL_ACCOUNT_TYPE.ASSET,
        subtype: GL_ACCOUNT_SUBTYPE.PROVIDER_CLEARING
      }
    ],
    count: 1
  });
  const server = await listen();

  try {
    const { port } = server.address();
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/admin/accounting/chart-of-accounts`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`http://127.0.0.1:${port}/api/admin/accounting/chart-of-accounts`, {
      headers: {
        Authorization: `Bearer ${token()}`
      }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].code, "1030");
  } finally {
    chartOfAccountsService.listAccounts = originalListAccounts;
    restoreUser();
    await close(server);
  }
});

test("staff cannot seed default chart of accounts", async () => {
  const restoreUser = withMockUser("staff");
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/accounting/chart-of-accounts/seed-defaults`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ dryRun: true })
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.success, false);
    assert.equal(payload.error.code, "FORBIDDEN_PERMISSION");
  } finally {
    restoreUser();
    await close(server);
  }
});

test("chart account create route validates enum values and forwards admin context", async () => {
  const restoreUser = withMockUser("admin");
  const originalCreateAccount = chartOfAccountsService.createAccount;
  let capturedArgs = null;
  chartOfAccountsService.createAccount = async (args) => {
    capturedArgs = args;
    return {
      action: "created",
      account: {
        id: "64c000000000000000000001",
        code: args.input.code,
        name: args.input.name,
        type: args.input.type,
        subtype: args.input.subtype
      }
    };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/accounting/chart-of-accounts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token()}`,
        "content-type": "application/json",
        "x-request-id": "coa-route-create"
      },
      body: JSON.stringify({
        code: "6090",
        name: "Training Expense",
        type: GL_ACCOUNT_TYPE.EXPENSE,
        subtype: GL_ACCOUNT_SUBTYPE.OPERATING_EXPENSE
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.equal(payload.success, true);
    assert.equal(capturedArgs.auth.id, userId);
    assert.equal(capturedArgs.requestId, "coa-route-create");
    assert.equal(capturedArgs.input.code, "6090");

    const invalid = await fetch(`http://127.0.0.1:${port}/api/admin/accounting/chart-of-accounts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        code: "1090",
        name: "Bad Account",
        type: "NOPE",
        subtype: GL_ACCOUNT_SUBTYPE.TOUR_REVENUE
      })
    });
    assert.equal(invalid.status, 422);
  } finally {
    chartOfAccountsService.createAccount = originalCreateAccount;
    restoreUser();
    await close(server);
  }
});
