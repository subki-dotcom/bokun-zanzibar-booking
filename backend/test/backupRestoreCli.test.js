const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { buildBackupEvidenceRecord, inspectArchive, parseArgs } = require("../scripts/backup-database");
const { collectMissingRequirements, databaseIdentity } = require("../scripts/restore-database");

const LIVE_URI = "mongodb+srv://user:pass@cluster0.abcde.mongodb.net/riser_booking?retryWrites=true";

test("backup CLI records evidence by default and allows opting out", () => {
  assert.equal(parseArgs(["--apply"]).record, true);
  assert.equal(parseArgs(["--apply", "--no-record"]).record, false);
});

test("backup archive inspection never treats a missing or empty archive as completed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-cli-"));
  try {
    const missing = await inspectArchive(path.join(dir, "missing.archive.gz"));
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, "ARCHIVE_MISSING");

    const emptyPath = path.join(dir, "empty.archive.gz");
    fs.writeFileSync(emptyPath, "");
    const empty = await inspectArchive(emptyPath);
    assert.equal(empty.ok, false);
    assert.equal(empty.reason, "ARCHIVE_EMPTY");

    const realPath = path.join(dir, "real.archive.gz");
    fs.writeFileSync(realPath, "archive-bytes");
    const real = await inspectArchive(realPath);
    assert.equal(real.ok, true);
    assert.equal(real.sizeBytes, 13);
    assert.equal(real.sha256, crypto.createHash("sha256").update("archive-bytes").digest("hex"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("backup evidence record redacts credentials and only sets completedAt on success", () => {
  const startedAt = new Date("2026-10-08T01:00:00.000Z");
  const completedAt = new Date("2026-10-08T01:05:00.000Z");
  const base = {
    databaseName: "riser_booking",
    mongoUri: LIVE_URI,
    archivePath: "backups/mongodb/riser_booking-20261008010000.archive.gz",
    outputDir: "backups/mongodb",
    args: [`--uri=${LIVE_URI}`, "--archive=backups/mongodb/x.archive.gz", "--gzip"],
    startedAt,
    completedAt,
    env: { NODE_ENV: "production", DR_BACKUP_STORAGE_PROVIDER: "s3", DR_BACKUP_RETENTION_DAYS: "14" }
  };

  const completed = buildBackupEvidenceRecord({
    ...base,
    status: "COMPLETED",
    archive: { ok: true, sizeBytes: 2048, sha256: "abc123", reason: "" }
  });
  const serialized = JSON.stringify(completed);
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.dryRun, false);
  assert.equal(completed.completedAt, completedAt);
  assert.equal(completed.metadata.archiveSha256, "abc123");
  assert.equal(completed.retentionDays, 14);
  assert.equal(completed.warnings.length, 0);
  assert.equal(serialized.includes("pass@"), false);
  assert.equal(serialized.includes("user:pass"), false);

  const failed = buildBackupEvidenceRecord({
    ...base,
    status: "FAILED",
    archive: { ok: false, sizeBytes: 0, sha256: "", reason: "MONGODUMP_FAILED" },
    error: new Error("mongodump exited with code 1")
  });
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.completedAt, null);
  assert.equal(failed.error.message, "mongodump exited with code 1");
  assert.equal(failed.safetyChecks.find((check) => check.code === "MONGODUMP_EXIT_CODE").status, "FAILED");
});

test("restore CLI refuses the configured live cluster as a target even outside NODE_ENV=production", () => {
  const env = { NODE_ENV: "development", MONGO_URI: LIVE_URI };
  const options = {
    apply: true,
    confirmRestore: true,
    archivePath: "backups/mongodb/riser_booking.archive.gz",
    allowProductionRestore: false
  };

  const sameCluster = collectMissingRequirements({
    ...options,
    targetUri: "mongodb+srv://other:creds@CLUSTER0.abcde.mongodb.net/"
  }, env);
  assert.deepEqual(sameCluster, ["SOURCE_TARGET_SAME_DATABASE"]);

  const staging = collectMissingRequirements({
    ...options,
    targetUri: "mongodb+srv://u:p@staging.zyx.mongodb.net/riser_booking_restore_test"
  }, env);
  assert.deepEqual(staging, []);

  const override = collectMissingRequirements({
    ...options,
    allowProductionRestore: true,
    targetUri: LIVE_URI
  }, { ...env, DR_ALLOW_PRODUCTION_RESTORE: "true" });
  assert.deepEqual(override, []);
});

test("restore database identity ignores credentials, options and host order", () => {
  assert.equal(
    databaseIdentity("mongodb://a:b@h2:27017,h1:27017/db?replicaSet=rs0"),
    databaseIdentity("mongodb://h1:27017,h2:27017/other")
  );
  assert.equal(databaseIdentity("not-a-uri"), "");
});
