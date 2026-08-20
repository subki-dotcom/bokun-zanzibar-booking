process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/data-quality-route-test";
process.env.JWT_SECRET ||= "data-quality-route-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");

const app = require("../src/app");
const User = require("../src/models/User");
const dataQualityService = require("../src/services/dataQuality");

const userId = "66dddddddddddddddddddddd";

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

test("data quality summary route requires admin auth and forwards scan filters", async () => {
  const restoreUser = withMockUser("admin");
  const originalGetSummary = dataQualityService.getSummary;
  let capturedArgs = null;
  dataQualityService.getSummary = async (args) => {
    capturedArgs = args;
    return {
      summary: {
        totalRecords: 10,
        completeRecords: 8,
        incompleteRecords: 2,
        completenessPercent: 80
      },
      scan: {
        scanLimit: args.limit
      }
    };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/admin/data-quality/summary`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(
      `http://127.0.0.1:${port}/api/admin/data-quality/summary?fromDate=2026-08-01&toDate=2026-08-31&limit=50`,
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
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
      limit: 50
    });
    assert.equal(payload.data.summary.completenessPercent, 80);
  } finally {
    dataQualityService.getSummary = originalGetSummary;
    restoreUser();
    await close(server);
  }
});

test("data quality issues route validates filters and blocks staff role", async () => {
  const restoreStaff = withMockUser("staff");
  const staffServer = await listen();

  try {
    const { port } = staffServer.address();
    const forbidden = await fetch(`http://127.0.0.1:${port}/api/admin/data-quality/issues`, {
      headers: {
        Authorization: `Bearer ${adminToken()}`
      }
    });
    assert.equal(forbidden.status, 403);
  } finally {
    restoreStaff();
    await close(staffServer);
  }

  const restoreAdmin = withMockUser("admin");
  const originalListIssues = dataQualityService.listIssues;
  let capturedArgs = null;
  dataQualityService.listIssues = async (args) => {
    capturedArgs = args;
    return {
      items: [
        {
          code: args.code,
          severity: args.severity,
          entityType: "Booking",
          reference: args.reference
        }
      ],
      count: 1,
      totalMatchingIssues: 1
    };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(
      `http://127.0.0.1:${port}/api/admin/data-quality/issues?severity=ERROR&code=MISSING_BOKUN_DATE&reference=ZNZ-DQ-1&issueLimit=10`,
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
      severity: "ERROR",
      code: "MISSING_BOKUN_DATE",
      reference: "ZNZ-DQ-1",
      issueLimit: 10
    });
    assert.equal(payload.data.items[0].code, "MISSING_BOKUN_DATE");

    const invalid = await fetch(`http://127.0.0.1:${port}/api/admin/data-quality/issues?severity=LOW`, {
      headers: {
        Authorization: `Bearer ${adminToken()}`
      }
    });
    assert.equal(invalid.status, 422);
  } finally {
    dataQualityService.listIssues = originalListIssues;
    restoreAdmin();
    await close(server);
  }
});
