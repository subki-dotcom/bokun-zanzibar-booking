#!/usr/bin/env node

const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config();

const parseArgs = (argv) => {
  const parsed = {
    dryRun: true,
    apply: false,
    record: true,
    outputDir: process.env.DR_BACKUP_DIRECTORY || "backups/mongodb"
  };

  argv.forEach((arg) => {
    if (arg === "--apply") {
      parsed.apply = true;
      parsed.dryRun = false;
      return;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      parsed.apply = false;
      return;
    }
    if (arg === "--no-record") parsed.record = false;
    if (arg.startsWith("--output-dir=")) parsed.outputDir = arg.slice("--output-dir=".length);
  });

  return parsed;
};

const sanitizeFilenamePart = (value = "") =>
  String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "database";

const extractDatabaseName = (uri = "") => {
  try {
    const parsed = new URL(uri);
    const name = decodeURIComponent(String(parsed.pathname || "").replace(/^\//, "").split("/")[0] || "");
    return sanitizeFilenamePart(name || "admin");
  } catch (_error) {
    const match = String(uri || "").match(/mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/i);
    return sanitizeFilenamePart(match?.[1] || "unknown");
  }
};

const maskMongoUri = (uri = "") =>
  String(uri || "")
    .replace(/(mongodb(?:\+srv)?:\/\/)([^:@/?#]+):([^@/?#]+)@/i, "$1[redacted]:[redacted]@")
    .replace(/([?&](?:authSource|replicaSet|tlsCertificateKeyFilePassword|password)=)[^&]+/gi, "$1[redacted]");

const redactArgs = (args = []) =>
  args.map((arg) => arg.startsWith("--uri=") ? `--uri=${maskMongoUri(arg.slice("--uri=".length))}` : arg);

const run = ({ command, args }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve();
      const error = new Error(`${command} exited with code ${code}`);
      error.exitCode = code;
      return reject(error);
    });
  });

const sha256File = (filePath) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(filePath)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });

// A missing or empty archive is never reported as a completed backup.
const inspectArchive = async (archivePath) => {
  let stats;
  try {
    stats = fs.statSync(archivePath);
  } catch (_error) {
    return { ok: false, sizeBytes: 0, sha256: "", reason: "ARCHIVE_MISSING" };
  }
  if (!stats.isFile() || stats.size === 0) {
    return { ok: false, sizeBytes: Number(stats.size || 0), sha256: "", reason: "ARCHIVE_EMPTY" };
  }
  return { ok: true, sizeBytes: stats.size, sha256: await sha256File(archivePath), reason: "" };
};

const buildBackupEvidenceRecord = ({
  status,
  databaseName,
  mongoUri,
  archivePath,
  outputDir,
  args,
  startedAt,
  completedAt,
  archive = {},
  error = null,
  env = process.env
}) => {
  const retentionDays = Number(env.DR_BACKUP_RETENTION_DAYS || 30);
  const storageProvider = env.DR_BACKUP_STORAGE_PROVIDER || "local_filesystem";
  const stamp = startedAt.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return {
    operationReference: `BACKUP-${sanitizeFilenamePart(databaseName)}-${stamp}`,
    type: "BACKUP",
    status,
    environment: env.NODE_ENV || "",
    databaseName,
    sourceUriRedacted: maskMongoUri(mongoUri),
    archivePath,
    backupDirectory: outputDir,
    storageProvider,
    retentionDays,
    rpoHours: Number(env.DR_BACKUP_RPO_HOURS || 24),
    rtoHours: Number(env.DR_BACKUP_RTO_HOURS || 4),
    dryRun: false,
    command: "mongodump",
    argsRedacted: redactArgs(args),
    requestedBy: "backup-database-cli",
    requestedByRole: "system",
    requestedAt: startedAt,
    startedAt,
    completedAt: status === "COMPLETED" ? completedAt : null,
    expiresAt: new Date(startedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000),
    safetyChecks: [
      {
        code: "MONGODUMP_EXIT_CODE",
        status: archive.reason === "MONGODUMP_FAILED" ? "FAILED" : "PASS",
        message: archive.reason === "MONGODUMP_FAILED" ? "mongodump did not exit cleanly." : "mongodump exited with code 0."
      },
      {
        code: "ARCHIVE_VERIFIED",
        status: archive.ok ? "PASS" : "FAILED",
        message: archive.ok
          ? "Archive exists, is non-empty and was checksummed."
          : `Archive check failed: ${archive.reason || "not inspected"}.`
      }
    ],
    warnings: storageProvider === "local_filesystem"
      ? [{
        code: "LOCAL_BACKUP_STORAGE",
        message: "Copy this archive to encrypted off-host storage; local disks are not durable disaster recovery storage."
      }]
      : [],
    missingRequirements: [],
    error: error
      ? { code: String(error.code || "BACKUP_FAILED"), message: String(error.message || "").slice(0, 500) }
      : { code: "", message: "" },
    metadata: {
      archiveSizeBytes: Number(archive.sizeBytes || 0),
      archiveSha256: archive.sha256 || "",
      recordedBy: "scripts/backup-database.js"
    }
  };
};

// Persists the outcome so Disaster Recovery and Production Readiness see real backup evidence.
const recordBackupEvidence = async ({ mongoUri, record }) => {
  const mongoose = require("mongoose");
  const BackupOperation = require("../src/models/BackupOperation");
  const AuditLog = require("../src/models/AuditLog");
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });
  try {
    await BackupOperation.create(record);
    await AuditLog.create({
      actorId: record.requestedBy,
      actorRole: "system",
      action: record.status === "COMPLETED" ? "disaster_recovery_backup_completed" : "disaster_recovery_backup_failed",
      entityType: "BackupOperation",
      entityId: record.operationReference,
      reference: record.operationReference,
      reason: "Backup executed by CLI",
      after: {
        status: record.status,
        archivePath: record.archivePath,
        archiveSizeBytes: record.metadata.archiveSizeBytes,
        archiveSha256: record.metadata.archiveSha256
      }
    });
  } finally {
    await mongoose.disconnect();
  }
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    console.error("BACKUP_MONGO_URI_REQUIRED: MONGO_URI must be set before creating a backup plan.");
    process.exitCode = 1;
    return;
  }

  const now = new Date();
  const databaseName = extractDatabaseName(mongoUri);
  const archivePath = path
    .join(
      options.outputDir,
      `${databaseName}-${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}.archive.gz`
    )
    .replace(/\\/g, "/");
  const args = [`--uri=${mongoUri}`, `--archive=${archivePath}`, "--gzip"];

  console.log(JSON.stringify({
    type: "BACKUP",
    mode: options.apply ? "apply" : "dry-run",
    databaseName,
    archivePath,
    command: "mongodump",
    args: redactArgs(args),
    recordEvidence: options.apply && options.record,
    note: options.apply
      ? "Executing mongodump. Verify this archive is copied to encrypted off-host storage."
      : "Dry-run only. No backup file will be written."
  }, null, 2));

  if (!options.apply) return;

  fs.mkdirSync(options.outputDir, { recursive: true });
  let dumpError = null;
  try {
    await run({ command: "mongodump", args });
  } catch (error) {
    dumpError = error;
  }
  const archive = dumpError
    ? { ok: false, sizeBytes: 0, sha256: "", reason: "MONGODUMP_FAILED" }
    : await inspectArchive(archivePath);
  const status = archive.ok ? "COMPLETED" : "FAILED";
  const failure = dumpError || (archive.ok ? null : new Error(`BACKUP_ARCHIVE_INVALID: ${archive.reason}`));
  const record = buildBackupEvidenceRecord({
    status,
    databaseName,
    mongoUri,
    archivePath,
    outputDir: options.outputDir,
    args,
    startedAt: now,
    completedAt: new Date(),
    archive,
    error: failure
  });

  console.log(JSON.stringify({
    status,
    operationReference: record.operationReference,
    archiveSizeBytes: record.metadata.archiveSizeBytes,
    archiveSha256: record.metadata.archiveSha256
  }, null, 2));

  if (options.record) {
    try {
      await recordBackupEvidence({ mongoUri, record });
      console.log(`Backup evidence recorded as ${record.operationReference}.`);
    } catch (error) {
      console.error(`BACKUP_EVIDENCE_NOT_RECORDED: ${error.message}`);
      process.exitCode = 1;
    }
  }

  if (failure) throw failure;
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = error.exitCode || 1;
  });
}

module.exports = {
  buildBackupEvidenceRecord,
  inspectArchive,
  parseArgs
};
