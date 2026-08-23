const mongoose = require("mongoose");
const {
  JOURNAL_STATUS,
  GL_POSTING_TYPE,
  SOURCE_MODULE
} = require("../accounting/constants");

const decimalField = {
  type: mongoose.Schema.Types.Decimal128,
  default: null
};

const sourceSchema = new mongoose.Schema(
  {
    sourceModule: { type: String, enum: Object.values(SOURCE_MODULE), required: true, index: true },
    sourceEntityType: { type: String, default: "", index: true },
    sourceEntityId: { type: String, default: "", index: true },
    sourceReference: { type: String, default: "", index: true },
    postingType: { type: String, enum: Object.values(GL_POSTING_TYPE), required: true, index: true },
    postingKey: { type: String, required: true, unique: true, index: true }
  },
  { _id: false }
);

const journalEntrySchema = new mongoose.Schema(
  {
    entryNumber: { type: String, required: true, unique: true, immutable: true, index: true },
    entryDate: { type: Date, required: true, index: true },
    postingDate: { type: Date, required: true, index: true },
    period: { type: String, required: true, index: true },
    source: { type: sourceSchema, required: true },
    description: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: Object.values(JOURNAL_STATUS),
      default: JOURNAL_STATUS.DRAFT,
      index: true
    },
    currency: { type: String, required: true, uppercase: true },
    exchangeRate: { type: mongoose.Schema.Types.Decimal128, required: true },
    totalDebit: { type: mongoose.Schema.Types.Decimal128, required: true },
    totalCredit: { type: mongoose.Schema.Types.Decimal128, required: true },
    baseCurrency: { type: String, required: true, uppercase: true },
    baseTotalDebit: { type: mongoose.Schema.Types.Decimal128, required: true },
    baseTotalCredit: { type: mongoose.Schema.Types.Decimal128, required: true },
    lineCount: { type: Number, default: 0 },
    requiresApproval: { type: Boolean, default: false, index: true },
    createdBy: { type: String, default: "" },
    approvedBy: { type: String, default: "" },
    approvedAt: { type: Date, default: null },
    postedBy: { type: String, default: "" },
    postedAt: { type: Date, default: null },
    reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry", default: null, index: true },
    reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry", default: null, index: true },
    reversedAt: { type: Date, default: null },
    voidReason: { type: String, default: "" },
    reason: { type: String, default: "" },
    evidence: mongoose.Schema.Types.Mixed,
    sourceSnapshot: mongoose.Schema.Types.Mixed,
    metadata: mongoose.Schema.Types.Mixed,
    correlationId: { type: String, default: "", index: true }
  },
  { timestamps: true }
);

journalEntrySchema.index(
  { "source.sourceModule": 1, "source.sourceEntityId": 1, "source.postingType": 1 },
  { name: "journal_source_identity" }
);
journalEntrySchema.index({ status: 1, postingDate: 1 });
journalEntrySchema.index({ period: 1, status: 1 });
journalEntrySchema.index({ correlationId: 1, postingDate: 1 });

module.exports = mongoose.model("JournalEntry", journalEntrySchema);
