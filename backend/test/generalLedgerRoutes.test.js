process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/general-ledger-route-test";
process.env.JWT_SECRET ||= "general-ledger-route-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");

const app = require("../src/app");
const User = require("../src/models/User");
const ledgerService = require("../src/services/generalLedger/ledger");

const adminId = "66dddddddddddddddddddddd";

const adminToken = () =>
  jwt.sign(
    {
      sub: adminId,
      userType: "user"
    },
    process.env.JWT_SECRET,
    { expiresIn: "5m" }
  );

const withMockAdmin = (role = "admin") => {
  const originalFindById = User.findById;
  User.findById = () => ({
    lean: async () => ({
      _id: { toString: () => adminId },
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

test("general ledger reports require admin auth and expose trial balance", async () => {
  const restoreUser = withMockAdmin("admin");
  const originalGetTrialBalance = ledgerService.getTrialBalance;
  ledgerService.getTrialBalance = async () => ({
    items: [],
    totals: { debit: "0", credit: "0", difference: "0" },
    balanced: true
  });
  const server = await listen();

  try {
    const { port } = server.address();
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/admin/accounting/trial-balance`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`http://127.0.0.1:${port}/api/admin/accounting/trial-balance`, {
      headers: { Authorization: `Bearer ${adminToken()}` }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.balanced, true);
  } finally {
    ledgerService.getTrialBalance = originalGetTrialBalance;
    restoreUser();
    await close(server);
  }
});

test("journal create route validates unstructured account values before service call", async () => {
  const restoreUser = withMockAdmin("admin");
  const originalCreateManualJournal = ledgerService.createManualJournal;
  let called = false;
  ledgerService.createManualJournal = async () => {
    called = true;
    return { action: "created", journal: { id: "journal-1" } };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const invalid = await fetch(`http://127.0.0.1:${port}/api/admin/accounting/journals`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        description: "Bad journal",
        currency: "USD",
        lines: [
          { accountCode: "BAD", debit: "1" },
          { accountCode: "3010", credit: "1" }
        ]
      })
    });

    assert.equal(invalid.status, 422);
    assert.equal(called, false);
  } finally {
    ledgerService.createManualJournal = originalCreateManualJournal;
    restoreUser();
    await close(server);
  }
});

test("staff cannot access general ledger health route", async () => {
  const restoreUser = withMockAdmin("staff");
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/accounting/health`, {
      headers: { Authorization: `Bearer ${adminToken()}` }
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.error.code, "FORBIDDEN_PERMISSION");
  } finally {
    restoreUser();
    await close(server);
  }
});
