process.env.NODE_ENV = "test";
process.env.MONGO_URI = "mongodb://dbuser:dbpass@127.0.0.1:27017/dr-core-test?authSource=admin&password=query-secret";
process.env.JWT_SECRET ||= "disaster-recovery-core-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  OPERATION_STATUS,
  OPERATION_TYPE,
  createDisasterRecoveryService,
  __testables
} = require("../src/services/disasterRecovery");

const fixedNow = () => new Date("2026-08-20T09:10:11.000Z");

const matches = (row, query = {}) =>
  Object.entries(query).every(([key, value]) => row[key] === value);

const arrayModel = (rows = []) => ({
  rows,
  create: async (payload) => {
    const row = {
      _id: `operation-${rows.length + 1}`,
      ...payload
    };
    rows.push(row);
    return row;
  },
  find: (query = {}) => rows.filter((row) => matches(row, query)),
  countDocuments: async (query = {}) => rows.filter((row) => matches(row, query)).length
});

test("MongoDB URI redaction hides credentials in plans and CLI arguments", () => {
  const masked = __testables.maskMongoUri(process.env.MONGO_URI);
  assert.equal(masked.includes("dbpass"), false);
  assert.equal(masked.includes("query-secret"), false);
  assert.equal(masked, "mongodb://[redacted]:[redacted]@127.0.0.1:27017/dr-core-test?authSource=[redacted]&password=[redacted]");

  const args = __testables.redactArgs([`--uri=${process.env.MONGO_URI}`, "--gzip"]);
  assert.equal(args[0].includes("dbpass"), false);
  assert.equal(args[0].startsWith("--uri=mongodb://[redacted]:[redacted]@"), true);
});

test("backup dry-run creates an auditable plan without executing in the API", async () => {
  const operations = [];
  const audits = [];
  const service = createDisasterRecoveryService({
    OperationModel: arrayModel(operations),
    AuditLogModel: arrayModel(audits),
    config: {
      backupDirectory: "backups/mongodb",
      retentionDays: 14,
      rpoHours: 12,
      rtoHours: 3,
      allowProductionRestore: false,
      storageProvider: "local_filesystem"
    },
    mongoUri: process.env.MONGO_URI,
    environment: "test",
    now: fixedNow
  });

  const result = await service.createBackupPlan({
    label: "nightly",
    reason: "Verify scheduled backup readiness",
    dryRun: true,
    auth: { id: "admin-1", role: "super_admin" },
    requestId: "req-dr-1"
  });

  assert.equal(result.operation.type, OPERATION_TYPE.BACKUP);
  assert.equal(result.operation.status, OPERATION_STATUS.DRY_RUN);
  assert.equal(result.operation.databaseName, "dr-core-test");
  assert.equal(result.operation.command, "mongodump");
  assert.equal(result.operation.sourceUriRedacted.includes("dbpass"), false);
  assert.equal(result.execution.canExecuteInApi, false);
  assert.equal(operations.length, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "disaster_recovery_backup_plan_created");
});

test("restore plan is blocked until archive, target, and confirmation are present", async () => {
  const operations = [];
  const service = createDisasterRecoveryService({
    OperationModel: arrayModel(operations),
    AuditLogModel: arrayModel([]),
    config: {
      backupDirectory: "backups/mongodb",
      retentionDays: 30,
      rpoHours: 24,
      rtoHours: 4,
      allowProductionRestore: false,
      storageProvider: "local_filesystem"
    },
    mongoUri: process.env.MONGO_URI,
    environment: "test",
    now: fixedNow
  });

  const result = await service.createRestorePlan({
    dryRun: true,
    auth: { id: "admin-1", role: "super_admin" }
  });

  assert.equal(result.operation.type, OPERATION_TYPE.RESTORE);
  assert.equal(result.operation.status, OPERATION_STATUS.BLOCKED);
  assert.equal(result.blocked, true);
  assert.deepEqual(
    result.missingRequirements.map((item) => item.code),
    ["RESTORE_ARCHIVE_REQUIRED", "RESTORE_TARGET_URI_REQUIRED", "CONFIRM_RESTORE_REQUIRED"]
  );
  assert.equal(result.execution.canExecuteInApi, false);
});

test("restore plan stays blocked for production unless both config and operator override allow it", async () => {
  const service = createDisasterRecoveryService({
    OperationModel: arrayModel([]),
    AuditLogModel: arrayModel([]),
    config: {
      backupDirectory: "backups/mongodb",
      retentionDays: 30,
      rpoHours: 24,
      rtoHours: 4,
      allowProductionRestore: false,
      storageProvider: "local_filesystem"
    },
    mongoUri: process.env.MONGO_URI,
    environment: "production",
    now: fixedNow
  });

  const result = await service.createRestorePlan({
    archivePath: "backups/mongodb/dr-core-test-20260820091011.archive.gz",
    targetUri: "mongodb://admin:secret@prod-db.example.test:27017/dr-core-test",
    confirmRestore: true,
    allowProductionRestore: true,
    dryRun: true,
    auth: { id: "admin-1", role: "super_admin" }
  });

  assert.equal(result.operation.status, OPERATION_STATUS.BLOCKED);
  assert.equal(result.missingRequirements.some((item) => item.code === "PRODUCTION_RESTORE_BLOCKED"), true);
  assert.equal(result.operation.targetUriRedacted.includes("secret"), false);
});

test("summary reports RPO state and critical collection coverage", async () => {
  const rows = [
    {
      _id: "backup-1",
      operationReference: "BACKUP-dr-core-test-20260819091011",
      type: OPERATION_TYPE.BACKUP,
      status: OPERATION_STATUS.COMPLETED,
      requestedAt: new Date("2026-08-19T09:10:11.000Z"),
      completedAt: new Date("2026-08-19T09:12:00.000Z")
    }
  ];
  const service = createDisasterRecoveryService({
    OperationModel: arrayModel(rows),
    AuditLogModel: arrayModel([]),
    config: {
      backupDirectory: "backups/mongodb",
      retentionDays: 30,
      rpoHours: 24,
      rtoHours: 4,
      allowProductionRestore: false,
      storageProvider: "local_filesystem"
    },
    mongoUri: process.env.MONGO_URI,
    environment: "test",
    now: fixedNow
  });

  const summary = await service.getSummary();

  assert.equal(summary.rpoStatus, "WITHIN_RPO");
  assert.equal(summary.safeguards.restoreExecutionInApi, false);
  assert.equal(summary.criticalCollections.includes("Payment"), true);
  assert.equal(summary.counts.backupOperations, 1);
});
