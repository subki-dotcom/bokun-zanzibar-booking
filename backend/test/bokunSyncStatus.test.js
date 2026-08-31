process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/bokun-sync-status-test";
process.env.JWT_SECRET ||= "bokun-sync-status-test-secret-with-enough-length";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");

const app = require("../src/app");
const User = require("../src/models/User");
const {
  getBokunSyncStatus,
  __testables
} = require("../src/services/bokunSyncStatus");

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

const withMockUser = (role = "staff") => {
  const originalFindById = User.findById;
  User.findById = () => ({
    lean: async () => ({
      _id: { toString: () => userId },
      firstName: "Bokun",
      lastName: "User",
      fullName: "Bokun User",
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

test("Bokun sync status reports live mode without exposing credentials", () => {
  const status = getBokunSyncStatus({
    configured: true,
    envConfig: {
      BOKUN_BASE_URL: "https://api.bokun.io",
      BOKUN_ACCESS_KEY: "access-key",
      BOKUN_SECRET_KEY: "secret-key",
      BOKUN_API_KEY: "api-key",
      BOKUN_MOCK_MODE: false,
      BOKUN_CONFIRMED_BOOKING_IMPORT_ENABLED: true,
      BOKUN_CONFIRMED_BOOKING_IMPORT_INTERVAL_SECONDS: 900,
      BOKUN_CONFIRMED_BOOKING_IMPORT_BATCH_SIZE: 50,
      BOKUN_CONFIRMED_BOOKING_IMPORT_MAX_PAGES: 5,
      BOKUN_CONFIRMED_BOOKING_IMPORT_LOOKBACK_DAYS: 30,
      BOKUN_CONFIRMED_BOOKING_IMPORT_STATUSES: "CONFIRMED,CANCELLED"
    },
    workerStatus: {
      name: "bokun_confirmed_booking_import",
      status: "running",
      enabled: true,
      configured: true,
      active: true,
      consecutiveFailures: 0
    }
  });

  assert.equal(status.integration.dataMode, "live");
  assert.equal(status.integration.liveApiReady, true);
  assert.equal(status.integration.accessKeyConfigured, true);
  assert.equal(status.integration.secretKeyConfigured, true);
  assert.equal(status.integration.BOKUN_ACCESS_KEY, undefined);
  assert.equal(status.integration.BOKUN_SECRET_KEY, undefined);
  assert.equal(status.confirmedBookingImport.ready, true);
  assert.deepEqual(status.confirmedBookingImport.defaults.statuses, ["CONFIRMED", "CANCELLED"]);
});

test("Bokun data mode distinguishes mock and missing live credentials", () => {
  assert.equal(__testables.resolveDataMode({ mockMode: true, configured: false }), "mock");
  assert.equal(__testables.resolveDataMode({ mockMode: false, configured: true }), "live");
  assert.equal(__testables.resolveDataMode({ mockMode: false, configured: false }), "not_configured");
});

test("Bokun sync status endpoint is protected and available to staff/admin operators", async () => {
  const server = await listen();

  try {
    const { port } = server.address();
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/bokun/admin/sync-status`);
    assert.equal(unauthorized.status, 401);
  } finally {
    await close(server);
  }

  const restoreUser = withMockUser("staff");
  const authedServer = await listen();

  try {
    const { port } = authedServer.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/bokun/admin/sync-status`, {
      headers: { Authorization: `Bearer ${token()}` }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.ok(["live", "mock", "not_configured"].includes(payload.data.integration.dataMode));
    assert.equal(payload.data.integration.BOKUN_ACCESS_KEY, undefined);
    assert.equal(payload.data.confirmedBookingImport.worker.name, "bokun_confirmed_booking_import");
  } finally {
    restoreUser();
    await close(authedServer);
  }
});
