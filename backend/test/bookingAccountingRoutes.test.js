process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/booking-accounting-route-test";
process.env.JWT_SECRET ||= "booking-accounting-route-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");

const app = require("../src/app");
const User = require("../src/models/User");
const bookingAccountingService = require("../src/services/bookingAccounting");

const userId = "66eeeeeeeeeeeeeeeeeeeeee";

const token = () =>
  jwt.sign(
    {
      sub: userId,
      userType: "user"
    },
    process.env.JWT_SECRET,
    { expiresIn: "5m" }
  );

const withMockUser = (role = "staff") => {
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

test("booking accounting dashboard route requires auth and allows staff read permission", async () => {
  const restoreUser = withMockUser("staff");
  const originalDashboard = bookingAccountingService.getDashboard;
  let capturedArgs = null;
  bookingAccountingService.getDashboard = async (args) => {
    capturedArgs = args;
    return {
      totals: {
        invoiceCount: 1,
        refundCount: 0,
        bookingExpenseCount: 0,
        openRefundCount: 0,
        reconciliationIssueCount: 0,
        collectedRevenue: 100,
        confirmedRefundedAmount: 0,
        netRevenue: 100,
        grossProfit: 100,
        profitMargin: 100
      },
      currency: "USD"
    };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/admin/booking-accounting/dashboard`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`http://127.0.0.1:${port}/api/admin/booking-accounting/dashboard?limit=25`, {
      headers: {
        Authorization: `Bearer ${token()}`
      }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.deepEqual(capturedArgs, { limit: 25 });
    assert.equal(payload.data.totals.collectedRevenue, 100);
  } finally {
    bookingAccountingService.getDashboard = originalDashboard;
    restoreUser();
    await close(server);
  }
});

test("booking accounting list routes validate shared query limits", async () => {
  const restoreUser = withMockUser("staff");
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/booking-accounting/refunds?limit=999`, {
      headers: {
        Authorization: `Bearer ${token()}`
      }
    });
    assert.equal(response.status, 422);
  } finally {
    restoreUser();
    await close(server);
  }
});
