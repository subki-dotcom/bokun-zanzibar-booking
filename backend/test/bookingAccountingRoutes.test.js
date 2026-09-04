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

    const response = await fetch(
      `http://127.0.0.1:${port}/api/admin/booking-accounting/dashboard?limit=25&channel=VIATOR&dateRange=this_month`,
      {
      headers: {
        Authorization: `Bearer ${token()}`
      }
      }
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.deepEqual(capturedArgs, { limit: 25, channel: "VIATOR", dateRange: "this_month" });
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

test("booking accounting cost template writes require write permission", async () => {
  let restoreUser = withMockUser("staff");
  const originalCreate = bookingAccountingService.createCostTemplate;
  let capturedArgs = null;
  bookingAccountingService.createCostTemplate = async (args) => {
    capturedArgs = args;
    return {
      action: "created",
      template: { id: "template-1", name: "Mnemba Cost", status: "active" }
    };
  };
  const server = await listen();
  const payload = {
    bokunProductId: "PROD-1",
    bokunOptionId: "OPT-1",
    currency: "USD",
    name: "Mnemba Cost",
    status: "active",
    validFrom: "2026-08-01",
    costLines: [{ category: "Guide", basis: "fixed_per_booking", amount: 10 }]
  };

  try {
    const { port } = server.address();
    const forbidden = await fetch(`http://127.0.0.1:${port}/api/admin/booking-accounting/cost-templates`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    assert.equal(forbidden.status, 403);
    assert.equal(capturedArgs, null);

    restoreUser();
    restoreUser = withMockUser("admin");

    const response = await fetch(`http://127.0.0.1:${port}/api/admin/booking-accounting/cost-templates`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.success, true);
    assert.equal(capturedArgs.payload.name, "Mnemba Cost");
    assert.equal(capturedArgs.auth.role, "admin");
  } finally {
    bookingAccountingService.createCostTemplate = originalCreate;
    restoreUser();
    await close(server);
  }
});

test("booking accounting cost template Bokun product sync starts asynchronously and requires write permission", async () => {
  let restoreUser = withMockUser("staff");
  const originalSync = bookingAccountingService.startCostTemplateBokunProductSync;
  let capturedArgs = null;
  let calls = 0;
  bookingAccountingService.startCostTemplateBokunProductSync = async (args) => {
    capturedArgs = args;
    calls += 1;
    return {
      syncStatus: "started",
      syncInProgress: true,
      currentCatalog: {
        summary: {
          totalBokunProducts: 38,
          totalBokunOptions: 245
        },
        items: []
      }
    };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const forbidden = await fetch(
      `http://127.0.0.1:${port}/api/admin/booking-accounting/cost-templates/sync-bokun-products`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token()}`
        }
      }
    );

    assert.equal(forbidden.status, 403);
    assert.equal(calls, 0);

    restoreUser();
    restoreUser = withMockUser("admin");

    const response = await fetch(
      `http://127.0.0.1:${port}/api/admin/booking-accounting/cost-templates/sync-bokun-products`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token()}`
        }
      }
    );
    const body = await response.json();

    assert.equal(response.status, 202);
    assert.equal(body.success, true);
    assert.equal(body.data.syncStatus, "started");
    assert.equal(body.data.currentCatalog.summary.totalBokunProducts, 38);
    assert.equal(capturedArgs.auth.role, "admin");
  } finally {
    bookingAccountingService.startCostTemplateBokunProductSync = originalSync;
    restoreUser();
    await close(server);
  }
});
