process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/disaster-recovery-route-test";
process.env.JWT_SECRET ||= "disaster-recovery-route-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");

const app = require("../src/app");
const User = require("../src/models/User");
const disasterRecoveryService = require("../src/services/disasterRecovery");

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

const withMockUser = (role = "admin") => {
  const originalFindById = User.findById;
  User.findById = () => ({
    lean: async () => ({
      _id: { toString: () => userId },
      firstName: "DR",
      lastName: "User",
      fullName: "DR User",
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

test("disaster recovery summary requires read permission and validates history filters", async () => {
  const restoreStaff = withMockUser("staff");
  const staffServer = await listen();

  try {
    const { port } = staffServer.address();
    const forbidden = await fetch(`http://127.0.0.1:${port}/api/admin/disaster-recovery/summary`, {
      headers: { Authorization: `Bearer ${token()}` }
    });
    assert.equal(forbidden.status, 403);
  } finally {
    restoreStaff();
    await close(staffServer);
  }

  const restoreAdmin = withMockUser("admin");
  const originalGetSummary = disasterRecoveryService.getSummary;
  const originalListHistory = disasterRecoveryService.listHistory;
  let capturedHistory = null;
  disasterRecoveryService.getSummary = async () => ({
    rpoStatus: "NO_COMPLETED_BACKUP",
    safeguards: { restoreExecutionInApi: false }
  });
  disasterRecoveryService.listHistory = async (filters) => {
    capturedHistory = filters;
    return { items: [], count: 0, filters };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const summary = await fetch(`http://127.0.0.1:${port}/api/admin/disaster-recovery/summary`, {
      headers: { Authorization: `Bearer ${token()}` }
    });
    const summaryPayload = await summary.json();
    assert.equal(summary.status, 200);
    assert.equal(summaryPayload.success, true);
    assert.equal(summaryPayload.data.rpoStatus, "NO_COMPLETED_BACKUP");

    const history = await fetch(
      `http://127.0.0.1:${port}/api/admin/disaster-recovery/history?type=BACKUP&status=DRY_RUN&limit=5`,
      {
        headers: { Authorization: `Bearer ${token()}` }
      }
    );
    assert.equal(history.status, 200);
    assert.deepEqual(capturedHistory, { type: "BACKUP", status: "DRY_RUN", limit: 5 });

    const invalid = await fetch(`http://127.0.0.1:${port}/api/admin/disaster-recovery/history?type=DELETE`, {
      headers: { Authorization: `Bearer ${token()}` }
    });
    assert.equal(invalid.status, 422);
  } finally {
    disasterRecoveryService.getSummary = originalGetSummary;
    disasterRecoveryService.listHistory = originalListHistory;
    restoreAdmin();
    await close(server);
  }
});

test("disaster recovery write actions are super-admin only and force dry-run plans", async () => {
  const restoreAdmin = withMockUser("admin");
  const adminServer = await listen();

  try {
    const { port } = adminServer.address();
    const forbidden = await fetch(`http://127.0.0.1:${port}/api/admin/disaster-recovery/backup-plan`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ label: "nightly" })
    });
    assert.equal(forbidden.status, 403);
  } finally {
    restoreAdmin();
    await close(adminServer);
  }

  const restoreSuperAdmin = withMockUser("super_admin");
  const originalCreateBackupPlan = disasterRecoveryService.createBackupPlan;
  const originalCreateRestorePlan = disasterRecoveryService.createRestorePlan;
  let backupArgs = null;
  let restoreArgs = null;
  disasterRecoveryService.createBackupPlan = async (args) => {
    backupArgs = args;
    return {
      operation: { type: "BACKUP", status: "DRY_RUN" },
      execution: { canExecuteInApi: false }
    };
  };
  disasterRecoveryService.createRestorePlan = async (args) => {
    restoreArgs = args;
    return {
      operation: { type: "RESTORE", status: "BLOCKED" },
      execution: { canExecuteInApi: false },
      blocked: true
    };
  };
  const server = await listen();

  try {
    const { port } = server.address();
    const backup = await fetch(`http://127.0.0.1:${port}/api/admin/disaster-recovery/backup-plan`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ label: "nightly", reason: "Scheduled backup readiness" })
    });
    assert.equal(backup.status, 201);
    assert.equal(backupArgs.dryRun, true);
    assert.equal(backupArgs.label, "nightly");
    assert.equal(backupArgs.auth.role, "super_admin");

    const restore = await fetch(`http://127.0.0.1:${port}/api/admin/disaster-recovery/restore-plan`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        archivePath: "backups/mongodb/app.archive.gz",
        targetUri: "mongodb://user:secret@127.0.0.1:27017/staging",
        confirmRestore: true
      })
    });
    assert.equal(restore.status, 201);
    assert.equal(restoreArgs.dryRun, true);
    assert.equal(restoreArgs.confirmRestore, true);
    assert.equal(restoreArgs.targetUri, "mongodb://user:secret@127.0.0.1:27017/staging");
  } finally {
    disasterRecoveryService.createBackupPlan = originalCreateBackupPlan;
    disasterRecoveryService.createRestorePlan = originalCreateRestorePlan;
    restoreSuperAdmin();
    await close(server);
  }
});
