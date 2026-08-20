process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/performance-review-route-test";
process.env.JWT_SECRET ||= "performance-review-route-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");

const app = require("../src/app");
const User = require("../src/models/User");
const performanceReviewService = require("../src/services/performanceReview");

const userId = "66ababababababababababab";

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
      firstName: "Performance",
      lastName: "User",
      fullName: "Performance User",
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

test("performance review summary blocks staff and returns admin coverage summary", async () => {
  const restoreStaff = withMockUser("staff");
  const staffServer = await listen();

  try {
    const { port } = staffServer.address();
    const forbidden = await fetch(`http://127.0.0.1:${port}/api/admin/performance-review/summary`, {
      headers: { Authorization: `Bearer ${token()}` }
    });
    assert.equal(forbidden.status, 403);
  } finally {
    restoreStaff();
    await close(staffServer);
  }

  const restoreAdmin = withMockUser("admin");
  const originalGetSummary = performanceReviewService.getSummary;
  performanceReviewService.getSummary = () => ({
    generatedAt: "2026-08-20T09:00:00.000Z",
    status: "covered",
    coveragePercent: 100,
    counts: { total: 1, covered: 1, migrationRequired: 0 },
    criticalMissing: [],
    nextActions: [],
    safeguards: ["Read-only index review"]
  });
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/performance-review/summary`, {
      headers: { Authorization: `Bearer ${token()}` }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.coveragePercent, 100);
    assert.equal(payload.data.safeguards[0], "Read-only index review");
  } finally {
    performanceReviewService.getSummary = originalGetSummary;
    restoreAdmin();
    await close(server);
  }
});

test("performance review index coverage validates filters and forwards them to service", async () => {
  const restoreAdmin = withMockUser("admin");
  const originalGetIndexCoverage = performanceReviewService.getIndexCoverage;
  let capturedFilters = null;
  performanceReviewService.getIndexCoverage = (filters) => {
    capturedFilters = filters;
    return {
      generatedAt: "2026-08-20T09:00:00.000Z",
      status: "covered",
      coveragePercent: 100,
      counts: { total: 1, covered: 1, migrationRequired: 0 },
      items: [],
      filters
    };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const response = await fetch(
      `http://127.0.0.1:${port}/api/admin/performance-review/indexes?model=Payment&priority=high&status=covered`,
      {
        headers: { Authorization: `Bearer ${token()}` }
      }
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.deepEqual(capturedFilters, {
      model: "Payment",
      priority: "high",
      status: "covered"
    });

    const invalid = await fetch(`http://127.0.0.1:${port}/api/admin/performance-review/indexes?model=Unknown`, {
      headers: { Authorization: `Bearer ${token()}` }
    });
    assert.equal(invalid.status, 422);
  } finally {
    performanceReviewService.getIndexCoverage = originalGetIndexCoverage;
    restoreAdmin();
    await close(server);
  }
});
