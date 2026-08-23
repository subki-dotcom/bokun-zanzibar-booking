const mongoose = require("mongoose");
const {
  LEDGER_MIGRATION_CONFIDENCE,
  LEDGER_MIGRATION_STATUS
} = require("../accounting/constants");

const ledgerMigrationRunSchema = new mongoose.Schema(
  {
    migrationReference: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: Object.values(LEDGER_MIGRATION_STATUS),
      default: LEDGER_MIGRATION_STATUS.DRY_RUN,
      index: true
    },
    fromDate: { type: Date, default: null, index: true },
    toDate: { type: Date, default: null, index: true },
    dryRun: { type: Boolean, default: true, index: true },
    confidence: {
      type: String,
      enum: Object.values(LEDGER_MIGRATION_CONFIDENCE),
      default: LEDGER_MIGRATION_CONFIDENCE.MANUAL_REVIEW_REQUIRED,
      index: true
    },
    classifiedEvents: { type: Number, default: 0 },
    unmappedEvents: { type: Number, default: 0 },
    appliedJournalCount: { type: Number, default: 0 },
    plan: mongoose.Schema.Types.Mixed,
    warnings: mongoose.Schema.Types.Mixed,
    createdBy: { type: String, default: "" },
    appliedBy: { type: String, default: "" },
    appliedAt: { type: Date, default: null },
    evidenceNote: { type: String, default: "" },
    metadata: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

module.exports = mongoose.model("LedgerMigrationRun", ledgerMigrationRunSchema);
