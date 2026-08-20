const path = require("path");
const AuditLog = require("../../models/AuditLog");
const BackupOperation = require("../../models/BackupOperation");
const { env } = require("../../config/env");

const OPERATION_TYPE = Object.freeze({
  BACKUP: "BACKUP",
  RESTORE: "RESTORE"
});

const OPERATION_STATUS = Object.freeze({
  DRY_RUN: "DRY_RUN",
  PLANNED: "PLANNED",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  BLOCKED: "BLOCKED"
});

const CRITICAL_COLLECTIONS = Object.freeze([
  "Booking",
  "BookingRequest",
  "Invoice",
  "Payment",
  "Refund",
  "AuditLog",
  "SystemAlert",
  "AccountingPosting",
  "BusinessExpense",
  "BusinessIncome",
  "SyncLog",
  "BackupOperation"
]);

const defaultConfig = {
  backupDirectory: env.DR_BACKUP_DIRECTORY || "backups/mongodb",
  retentionDays: Number(env.DR_BACKUP_RETENTION_DAYS || 30),
  rpoHours: Number(env.DR_BACKUP_RPO_HOURS || 24),
  rtoHours: Number(env.DR_BACKUP_RTO_HOURS || 4),
  allowProductionRestore: Boolean(env.DR_ALLOW_PRODUCTION_RESTORE),
  storageProvider: env.DR_BACKUP_STORAGE_PROVIDER || "local_filesystem"
};

const normalizeToken = (value = "") => String(value || "").trim();
const normalizeBool = (value) => value === true || String(value || "").toLowerCase() === "true";
const actorId = (auth = {}) => normalizeToken(auth?.id || auth?._id || auth?.email || auth?.role || "system");
const parseDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const toIso = (value) => {
  const date = parseDate(value);
  return date ? date.toISOString() : "";
};
const sanitizeFilenamePart = (value = "") =>
  normalizeToken(value)
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "database";

const addDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + Number(days || 0));
  return next;
};

const maskMongoUri = (uri = "") => {
  const value = normalizeToken(uri);
  if (!value) return "";
  return value
    .replace(/(mongodb(?:\+srv)?:\/\/)([^:@/?#]+):([^@/?#]+)@/i, "$1[redacted]:[redacted]@")
    .replace(/([?&](?:authSource|replicaSet|tlsCertificateKeyFilePassword|password)=)[^&]+/gi, "$1[redacted]");
};

const extractDatabaseName = (uri = "") => {
  const value = normalizeToken(uri);
  if (!value) return "unknown";
  try {
    const parsed = new URL(value);
    const db = decodeURIComponent(String(parsed.pathname || "").replace(/^\//, "").split("/")[0] || "");
    return sanitizeFilenamePart(db || "admin");
  } catch (_error) {
    const match = value.match(/mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/i);
    return sanitizeFilenamePart(match?.[1] || "unknown");
  }
};

const buildOperationReference = ({ type, now, databaseName }) =>
  `${type}-${sanitizeFilenamePart(databaseName)}-${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;

const buildArchivePath = ({ backupDirectory, databaseName, now }) =>
  path
    .join(
      backupDirectory,
      `${sanitizeFilenamePart(databaseName)}-${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}.archive.gz`
    )
    .replace(/\\/g, "/");

const buildMongodumpArgs = ({ mongoUri, archivePath }) => [
  `--uri=${mongoUri}`,
  `--archive=${archivePath}`,
  "--gzip"
];

const buildMongorestoreArgs = ({ targetUri, archivePath, dropExisting = false }) => {
  const args = [`--uri=${targetUri}`, `--archive=${archivePath}`, "--gzip"];
  if (dropExisting) args.push("--drop");
  return args;
};

const redactArgs = (args = []) =>
  args.map((arg) => arg.startsWith("--uri=") ? `--uri=${maskMongoUri(arg.slice("--uri=".length))}` : arg);

const queryToArray = async ({ queryResult, sort = { requestedAt: -1 }, limit = 50 } = {}) => {
  if (!queryResult) return [];
  if (Array.isArray(queryResult)) {
    return queryResult
      .slice()
      .sort((left, right) => new Date(right.requestedAt || right.createdAt || 0) - new Date(left.requestedAt || left.createdAt || 0))
      .slice(0, limit);
  }
  let query = queryResult;
  if (query.sort) query = query.sort(sort);
  if (query.limit) query = query.limit(limit);
  if (query.lean) query = query.lean();
  const rows = await query;
  return Array.isArray(rows) ? rows : rows ? [rows] : [];
};

const countDocuments = async (Model, query = {}) => {
  if (Model?.countDocuments) return Model.countDocuments(query);
  return 0;
};

const normalizeOperation = (operation = {}) => ({
  id: normalizeToken(operation.id || operation._id),
  operationReference: operation.operationReference || "",
  type: operation.type || "",
  status: operation.status || "",
  environment: operation.environment || "",
  databaseName: operation.databaseName || "",
  sourceUriRedacted: operation.sourceUriRedacted || "",
  targetUriRedacted: operation.targetUriRedacted || "",
  archivePath: operation.archivePath || "",
  backupDirectory: operation.backupDirectory || "",
  storageProvider: operation.storageProvider || "",
  retentionDays: Number(operation.retentionDays || 0),
  rpoHours: Number(operation.rpoHours || 0),
  rtoHours: Number(operation.rtoHours || 0),
  dryRun: Boolean(operation.dryRun),
  command: operation.command || "",
  argsRedacted: operation.argsRedacted || [],
  sourceBackupOperationId: normalizeToken(operation.sourceBackupOperationId || ""),
  allowProductionRestore: Boolean(operation.allowProductionRestore),
  confirmRestore: Boolean(operation.confirmRestore),
  dropExisting: Boolean(operation.dropExisting),
  requestedBy: operation.requestedBy || "",
  requestedByRole: operation.requestedByRole || "",
  requestedAt: toIso(operation.requestedAt),
  startedAt: toIso(operation.startedAt),
  completedAt: toIso(operation.completedAt),
  expiresAt: toIso(operation.expiresAt),
  safetyChecks: operation.safetyChecks || [],
  warnings: operation.warnings || [],
  missingRequirements: operation.missingRequirements || [],
  error: operation.error || { code: "", message: "" },
  metadata: operation.metadata || {}
});

const buildBackupSafety = ({ storageProvider, backupDirectory }) => {
  const checks = [
    {
      code: "MONGODUMP_REQUIRED",
      status: "MANUAL_VERIFY",
      message: "Verify that mongodump from MongoDB Database Tools is installed on the execution host."
    },
    {
      code: "BACKUP_DIRECTORY_REQUIRED",
      status: backupDirectory ? "PASS" : "BLOCKED",
      message: backupDirectory
        ? "Backup directory is configured."
        : "Backup directory is missing."
    },
    {
      code: "SECRETS_REDACTED",
      status: "PASS",
      message: "MongoDB URI is redacted in persisted plan and API responses."
    }
  ];
  const warnings = [];
  if (storageProvider === "local_filesystem") {
    warnings.push({
      code: "LOCAL_BACKUP_STORAGE",
      message: "Local filesystem backups must be copied to encrypted off-host storage for production resilience."
    });
  }
  return { checks, warnings };
};

const buildRestoreSafety = ({
  sourceUri,
  targetUri,
  environment,
  allowProductionRestore,
  confirmRestore,
  archivePath,
  dropExisting
}) => {
  const missingRequirements = [];
  const warnings = [];
  if (!archivePath) {
    missingRequirements.push({ code: "RESTORE_ARCHIVE_REQUIRED", message: "Restore archive path is required." });
  }
  if (!targetUri) {
    missingRequirements.push({ code: "RESTORE_TARGET_URI_REQUIRED", message: "Restore target MongoDB URI is required." });
  }
  if (!confirmRestore) {
    missingRequirements.push({ code: "CONFIRM_RESTORE_REQUIRED", message: "Restore requires explicit confirmation." });
  }
  if (environment === "production" && !allowProductionRestore) {
    missingRequirements.push({
      code: "PRODUCTION_RESTORE_BLOCKED",
      message: "Production restore is blocked unless DR_ALLOW_PRODUCTION_RESTORE and explicit operator override are enabled."
    });
  }
  if (sourceUri && targetUri && maskMongoUri(sourceUri) === maskMongoUri(targetUri) && !allowProductionRestore) {
    missingRequirements.push({
      code: "SOURCE_TARGET_SAME_DATABASE",
      message: "Source and target database appear to match. Use a staging target or explicit production restore override."
    });
  }
  if (dropExisting) {
    warnings.push({
      code: "DROP_EXISTING_ENABLED",
      message: "Restore plan includes --drop. This is destructive and must only be used after an independently verified backup."
    });
  }
  return {
    checks: [
      {
        code: "MONGORESTORE_REQUIRED",
        status: "MANUAL_VERIFY",
        message: "Verify that mongorestore from MongoDB Database Tools is installed on the execution host."
      },
      {
        code: "RESTORE_IS_CLI_ONLY",
        status: "PASS",
        message: "The admin API creates an auditable restore plan only; it never executes mongorestore."
      }
    ],
    warnings,
    missingRequirements
  };
};

const createDisasterRecoveryService = ({
  OperationModel = BackupOperation,
  AuditLogModel = AuditLog,
  config = defaultConfig,
  mongoUri = env.MONGO_URI,
  environment = env.NODE_ENV,
  now = () => new Date()
} = {}) => {
  const createOperationRecord = async (payload) => {
    if (!OperationModel?.create) return payload;
    const created = await OperationModel.create(payload);
    return typeof created.toObject === "function" ? created.toObject() : created;
  };

  const audit = async ({ action, auth, requestId, reason, before = null, after = null, metadata = {} }) => {
    if (!AuditLogModel?.create) return;
    await AuditLogModel.create({
      actorId: actorId(auth),
      actorRole: auth?.role || "system",
      action,
      entityType: "BackupOperation",
      entityId: after?.operationReference || "planned",
      reference: after?.operationReference || "",
      reason,
      requestId,
      before,
      after,
      metadata
    });
  };

  const createBackupPlan = async ({
    label = "",
    reason = "",
    dryRun = true,
    auth = null,
    requestId = ""
  } = {}) => {
    const generatedAt = now();
    const databaseName = extractDatabaseName(mongoUri);
    const backupDirectory = config.backupDirectory || "backups/mongodb";
    const archivePath = buildArchivePath({ backupDirectory, databaseName, now: generatedAt });
    const operationReference = buildOperationReference({ type: OPERATION_TYPE.BACKUP, databaseName, now: generatedAt });
    const args = buildMongodumpArgs({ mongoUri, archivePath });
    const safety = buildBackupSafety({ storageProvider: config.storageProvider, backupDirectory });
    const blocked = safety.checks.some((check) => check.status === "BLOCKED");
    const status = blocked ? OPERATION_STATUS.BLOCKED : normalizeBool(dryRun) ? OPERATION_STATUS.DRY_RUN : OPERATION_STATUS.PLANNED;

    const operation = await createOperationRecord({
      operationReference,
      type: OPERATION_TYPE.BACKUP,
      status,
      environment,
      databaseName,
      sourceUriRedacted: maskMongoUri(mongoUri),
      archivePath,
      backupDirectory,
      storageProvider: config.storageProvider,
      retentionDays: config.retentionDays,
      rpoHours: config.rpoHours,
      rtoHours: config.rtoHours,
      dryRun: normalizeBool(dryRun),
      command: "mongodump",
      argsRedacted: redactArgs(args),
      requestedBy: actorId(auth),
      requestedByRole: auth?.role || "system",
      requestedAt: generatedAt,
      expiresAt: addDays(generatedAt, config.retentionDays),
      safetyChecks: safety.checks,
      warnings: safety.warnings,
      missingRequirements: safety.checks
        .filter((check) => check.status === "BLOCKED")
        .map((check) => ({ code: check.code, message: check.message })),
      metadata: {
        label,
        reason,
        criticalCollections: CRITICAL_COLLECTIONS
      }
    });

    const normalized = normalizeOperation(operation);
    await audit({
      action: "disaster_recovery_backup_plan_created",
      auth,
      requestId,
      reason: reason || "Backup plan created",
      after: normalized,
      metadata: { dryRun: normalizeBool(dryRun), label }
    });

    return {
      generatedAt: generatedAt.toISOString(),
      operation: normalized,
      execution: {
        canExecuteInApi: false,
        cliCommand: "node scripts/backup-database.js --apply",
        dryRunCommand: "node scripts/backup-database.js --dry-run"
      },
      criticalCollections: CRITICAL_COLLECTIONS
    };
  };

  const createRestorePlan = async ({
    archivePath = "",
    targetUri = "",
    sourceBackupOperationId = "",
    reason = "",
    dryRun = true,
    confirmRestore = false,
    allowProductionRestore = false,
    dropExisting = false,
    auth = null,
    requestId = ""
  } = {}) => {
    const generatedAt = now();
    const databaseName = extractDatabaseName(targetUri || mongoUri);
    const operationReference = buildOperationReference({ type: OPERATION_TYPE.RESTORE, databaseName, now: generatedAt });
    const effectiveAllowProductionRestore = Boolean(config.allowProductionRestore && normalizeBool(allowProductionRestore));
    const safety = buildRestoreSafety({
      sourceUri: mongoUri,
      targetUri,
      environment,
      allowProductionRestore: effectiveAllowProductionRestore,
      confirmRestore: normalizeBool(confirmRestore),
      archivePath,
      dropExisting: normalizeBool(dropExisting)
    });
    const args = targetUri && archivePath
      ? buildMongorestoreArgs({ targetUri, archivePath, dropExisting: normalizeBool(dropExisting) })
      : [];
    const blocked = safety.missingRequirements.length > 0;

    const operation = await createOperationRecord({
      operationReference,
      type: OPERATION_TYPE.RESTORE,
      status: blocked ? OPERATION_STATUS.BLOCKED : normalizeBool(dryRun) ? OPERATION_STATUS.DRY_RUN : OPERATION_STATUS.PLANNED,
      environment,
      databaseName,
      sourceUriRedacted: maskMongoUri(mongoUri),
      targetUriRedacted: maskMongoUri(targetUri),
      archivePath,
      backupDirectory: path.dirname(archivePath || config.backupDirectory || ""),
      storageProvider: config.storageProvider,
      retentionDays: config.retentionDays,
      rpoHours: config.rpoHours,
      rtoHours: config.rtoHours,
      dryRun: normalizeBool(dryRun),
      command: "mongorestore",
      argsRedacted: redactArgs(args),
      sourceBackupOperationId: sourceBackupOperationId || "",
      allowProductionRestore: effectiveAllowProductionRestore,
      confirmRestore: normalizeBool(confirmRestore),
      dropExisting: normalizeBool(dropExisting),
      requestedBy: actorId(auth),
      requestedByRole: auth?.role || "system",
      requestedAt: generatedAt,
      safetyChecks: safety.checks,
      warnings: safety.warnings,
      missingRequirements: safety.missingRequirements,
      metadata: {
        reason,
        apiExecutionBlocked: true
      }
    });

    const normalized = normalizeOperation(operation);
    await audit({
      action: "disaster_recovery_restore_plan_created",
      auth,
      requestId,
      reason: reason || "Restore plan created",
      after: normalized,
      metadata: {
        dryRun: normalizeBool(dryRun),
        blocked,
        apiExecutionBlocked: true
      }
    });

    return {
      generatedAt: generatedAt.toISOString(),
      operation: normalized,
      execution: {
        canExecuteInApi: false,
        cliCommand: "node scripts/restore-database.js --apply --confirm-restore --archive=<archive> --target-uri=<staging-or-production-uri>",
        dryRunCommand: "node scripts/restore-database.js --dry-run --archive=<archive> --target-uri=<staging-uri>"
      },
      blocked,
      missingRequirements: safety.missingRequirements
    };
  };

  const listHistory = async (filters = {}) => {
    const query = {};
    if (filters.type) query.type = filters.type;
    if (filters.status) query.status = filters.status;
    const limit = Math.min(Math.max(Number(filters.limit || 50), 1), 200);
    const rows = await queryToArray({
      queryResult: OperationModel.find(query),
      sort: { requestedAt: -1 },
      limit
    });
    return {
      generatedAt: now().toISOString(),
      items: rows.map(normalizeOperation),
      count: rows.length,
      filters: {
        type: filters.type || "",
        status: filters.status || ""
      }
    };
  };

  const getSummary = async () => {
    const [latestCompletedBackup, latestRestorePlan, totalBackupPlans, totalRestorePlans] = await Promise.all([
      queryToArray({
        queryResult: OperationModel.find({ type: OPERATION_TYPE.BACKUP, status: OPERATION_STATUS.COMPLETED }),
        sort: { completedAt: -1, requestedAt: -1 },
        limit: 1
      }),
      queryToArray({
        queryResult: OperationModel.find({ type: OPERATION_TYPE.RESTORE }),
        sort: { requestedAt: -1 },
        limit: 1
      }),
      countDocuments(OperationModel, { type: OPERATION_TYPE.BACKUP }),
      countDocuments(OperationModel, { type: OPERATION_TYPE.RESTORE })
    ]);

    const latestBackup = latestCompletedBackup[0] ? normalizeOperation(latestCompletedBackup[0]) : null;
    const lastCompletedAt = parseDate(latestBackup?.completedAt);
    const rpoDeadline = lastCompletedAt ? new Date(lastCompletedAt.getTime() + Number(config.rpoHours || 0) * 60 * 60 * 1000) : null;
    const rpoStatus = !latestBackup ? "NO_COMPLETED_BACKUP" : rpoDeadline && rpoDeadline < now() ? "RPO_BREACHED" : "WITHIN_RPO";

    return {
      generatedAt: now().toISOString(),
      environment,
      databaseName: extractDatabaseName(mongoUri),
      backupPolicy: {
        backupDirectory: config.backupDirectory,
        storageProvider: config.storageProvider,
        retentionDays: config.retentionDays,
        rpoHours: config.rpoHours,
        rtoHours: config.rtoHours
      },
      latestCompletedBackup: latestBackup,
      latestRestorePlan: latestRestorePlan[0] ? normalizeOperation(latestRestorePlan[0]) : null,
      counts: {
        backupOperations: totalBackupPlans,
        restoreOperations: totalRestorePlans
      },
      rpoStatus,
      safeguards: {
        restoreExecutionInApi: false,
        productionRestoreRequiresExplicitOverride: true,
        uriRedactionEnabled: true,
        dryRunFirst: true
      },
      criticalCollections: CRITICAL_COLLECTIONS,
      limitations: [
        "This control plane records and audits backup/restore plans; actual backup execution is performed by CLI scripts on an authorized host.",
        "Restore execution is intentionally not exposed through the HTTP API because it can destroy or replace production data.",
        "Local filesystem backup storage is not sufficient by itself for production disaster recovery."
      ]
    };
  };

  return {
    createBackupPlan,
    createRestorePlan,
    getSummary,
    listHistory
  };
};

const service = createDisasterRecoveryService();

module.exports = {
  ...service,
  createDisasterRecoveryService,
  OPERATION_STATUS,
  OPERATION_TYPE,
  CRITICAL_COLLECTIONS,
  __testables: {
    buildArchivePath,
    buildMongodumpArgs,
    buildMongorestoreArgs,
    extractDatabaseName,
    maskMongoUri,
    normalizeOperation,
    redactArgs
  }
};
