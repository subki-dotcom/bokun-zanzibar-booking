const mongoose = require("mongoose");

const BACKUP_OPERATION_TYPE = ["BACKUP", "RESTORE"];
const BACKUP_OPERATION_STATUS = ["DRY_RUN", "PLANNED", "RUNNING", "COMPLETED", "FAILED", "BLOCKED"];

const backupOperationSchema = new mongoose.Schema(
  {
    operationReference: { type: String, required: true, unique: true, index: true },
    type: { type: String, enum: BACKUP_OPERATION_TYPE, required: true, index: true },
    status: { type: String, enum: BACKUP_OPERATION_STATUS, default: "DRY_RUN", index: true },
    environment: { type: String, default: "", index: true },
    databaseName: { type: String, default: "", index: true },
    sourceUriRedacted: { type: String, default: "" },
    targetUriRedacted: { type: String, default: "" },
    archivePath: { type: String, default: "" },
    backupDirectory: { type: String, default: "" },
    storageProvider: { type: String, default: "local_filesystem" },
    retentionDays: { type: Number, default: 30 },
    rpoHours: { type: Number, default: 24 },
    rtoHours: { type: Number, default: 4 },
    dryRun: { type: Boolean, default: true, index: true },
    command: { type: String, default: "" },
    argsRedacted: [{ type: String }],
    sourceBackupOperationId: { type: String, default: "" },
    allowProductionRestore: { type: Boolean, default: false },
    confirmRestore: { type: Boolean, default: false },
    dropExisting: { type: Boolean, default: false },
    requestedBy: { type: String, default: "" },
    requestedByRole: { type: String, default: "" },
    requestedAt: { type: Date, default: Date.now, index: true },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null, index: true },
    safetyChecks: [{ code: String, status: String, message: String }],
    warnings: [{ code: String, message: String }],
    missingRequirements: [{ code: String, message: String }],
    error: {
      code: { type: String, default: "" },
      message: { type: String, default: "" }
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

backupOperationSchema.index({ type: 1, status: 1, requestedAt: -1 });
backupOperationSchema.index({ environment: 1, databaseName: 1, requestedAt: -1 });

module.exports = mongoose.model("BackupOperation", backupOperationSchema);
module.exports.BACKUP_OPERATION_STATUS = BACKUP_OPERATION_STATUS;
module.exports.BACKUP_OPERATION_TYPE = BACKUP_OPERATION_TYPE;
