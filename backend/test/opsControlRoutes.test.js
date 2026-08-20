process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/ops-control-route-test";
process.env.JWT_SECRET ||= "ops-control-route-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");

const app = require("../src/app");
const User = require("../src/models/User");
const opsControlService = require("../src/services/opsControl");

const userId = "66eeeeeeeeeeeeeeeeeeeeee";

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

test("ops control alerts route requires admin auth and validates filters", async () => {
  const restoreUser = withMockUser("admin");
  const originalListSystemAlerts = opsControlService.listSystemAlerts;
  let capturedArgs = null;
  opsControlService.listSystemAlerts = async (args) => {
    capturedArgs = args;
    return {
      items: [{ alertKey: "ALERT::REFUNDS::1", category: args.category, state: args.state }],
      pagination: { page: 1, limit: args.limit, total: 1 }
    };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/admin/ops-control/alerts`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(
      `http://127.0.0.1:${port}/api/admin/ops-control/alerts?category=REFUNDS&severity=ERROR&state=OPEN&limit=5`,
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
      category: "REFUNDS",
      severity: "ERROR",
      state: "OPEN",
      limit: 5
    });

    const invalid = await fetch(`http://127.0.0.1:${port}/api/admin/ops-control/alerts?severity=LOW`, {
      headers: {
        Authorization: `Bearer ${adminToken()}`
      }
    });
    assert.equal(invalid.status, 422);
  } finally {
    opsControlService.listSystemAlerts = originalListSystemAlerts;
    restoreUser();
    await close(server);
  }
});

test("ops control failed jobs route blocks staff and forwards retry action", async () => {
  const restoreStaff = withMockUser("staff");
  const staffServer = await listen();

  try {
    const { port } = staffServer.address();
    const forbidden = await fetch(`http://127.0.0.1:${port}/api/admin/ops-control/failed-jobs`, {
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
  const originalListFailedJobs = opsControlService.listFailedJobs;
  const originalRetryFailedJob = opsControlService.retryFailedJob;
  let capturedListArgs = null;
  let capturedRetryArgs = null;
  opsControlService.listFailedJobs = async (args) => {
    capturedListArgs = args;
    return {
      items: [{ id: "FAILED_JOB::BOOKING_FINALIZATION::Booking::booking-1", jobType: args.jobType }],
      pagination: { page: 1, limit: args.limit, total: 1 }
    };
  };
  opsControlService.retryFailedJob = async (args) => {
    capturedRetryArgs = args;
    return {
      job: { id: args.jobId },
      result: { status: "confirmed" }
    };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const list = await fetch(
      `http://127.0.0.1:${port}/api/admin/ops-control/failed-jobs?jobType=BOOKING_FINALIZATION&category=BOKUN_SYNC&limit=10`,
      {
        headers: {
          Authorization: `Bearer ${adminToken()}`
        }
      }
    );
    const listPayload = await list.json();
    assert.equal(list.status, 200);
    assert.equal(listPayload.success, true);
    assert.deepEqual(capturedListArgs, {
      jobType: "BOOKING_FINALIZATION",
      category: "BOKUN_SYNC",
      limit: 10
    });

    const jobId = encodeURIComponent("FAILED_JOB::BOOKING_FINALIZATION::Booking::booking-1");
    const retry = await fetch(`http://127.0.0.1:${port}/api/admin/ops-control/failed-jobs/${jobId}/retry`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ force: true })
    });
    const retryPayload = await retry.json();
    assert.equal(retry.status, 200);
    assert.equal(retryPayload.success, true);
    assert.equal(capturedRetryArgs.jobId, "FAILED_JOB::BOOKING_FINALIZATION::Booking::booking-1");
    assert.equal(capturedRetryArgs.force, true);
  } finally {
    opsControlService.listFailedJobs = originalListFailedJobs;
    opsControlService.retryFailedJob = originalRetryFailedJob;
    restoreAdmin();
    await close(server);
  }
});

test("ops control alert actions forward resolution note", async () => {
  const restoreUser = withMockUser("admin");
  const originalResolveAlert = opsControlService.resolveAlert;
  let capturedArgs = null;
  opsControlService.resolveAlert = async (args) => {
    capturedArgs = args;
    return {
      alertKey: args.alertId,
      state: "RESOLVED",
      resolutionNote: args.resolutionNote
    };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const alertId = encodeURIComponent("ALERT::PAYMENT::CRITICAL");
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/ops-control/alerts/${alertId}/resolve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        resolutionNote: "Reviewed settlement and corrected the accounting record."
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(capturedArgs.alertId, "ALERT::PAYMENT::CRITICAL");
    assert.equal(capturedArgs.resolutionNote, "Reviewed settlement and corrected the accounting record.");
  } finally {
    opsControlService.resolveAlert = originalResolveAlert;
    restoreUser();
    await close(server);
  }
});
