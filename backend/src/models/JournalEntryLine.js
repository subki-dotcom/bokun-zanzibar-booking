const mongoose = require("mongoose");
const {
  BUSINESS_UNIT,
  COST_CENTER_TYPE,
  JOURNAL_STATUS
} = require("../accounting/constants");

const journalEntryLineSchema = new mongoose.Schema(
  {
    journalEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JournalEntry",
      required: true,
      index: true
    },
    entryNumber: { type: String, required: true, index: true },
    journalStatus: {
      type: String,
      enum: Object.values(JOURNAL_STATUS),
      required: true,
      index: true
    },
    entryDate: { type: Date, required: true, index: true },
    postingDate: { type: Date, required: true, index: true },
    period: { type: String, required: true, index: true },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      required: true,
      index: true
    },
    accountCode: { type: String, required: true, uppercase: true, index: true },
    accountName: { type: String, required: true },
    accountType: { type: String, required: true, index: true },
    accountSubtype: { type: String, default: "", index: true },
    description: { type: String, default: "" },
    debit: { type: mongoose.Schema.Types.Decimal128, required: true },
    credit: { type: mongoose.Schema.Types.Decimal128, required: true },
    currency: { type: String, required: true, uppercase: true },
    exchangeRate: { type: mongoose.Schema.Types.Decimal128, required: true },
    baseCurrencyDebit: { type: mongoose.Schema.Types.Decimal128, required: true },
    baseCurrencyCredit: { type: mongoose.Schema.Types.Decimal128, required: true },
    baseCurrency: { type: String, required: true, uppercase: true },
    businessUnit: {
      type: String,
      enum: Object.values(BUSINESS_UNIT),
      default: BUSINESS_UNIT.UNALLOCATED,
      index: true
    },
    costCenter: {
      type: String,
      enum: Object.values(COST_CENTER_TYPE),
      default: COST_CENTER_TYPE.OTHER,
      index: true
    },
    productId: { type: String, default: "", index: true },
    channel: { type: String, default: "", index: true },
    customerId: { type: String, default: "", index: true },
    supplierId: { type: String, default: "", index: true },
    agentId: { type: String, default: "", index: true },
    bookingId: { type: String, default: "", index: true },
    bookingReference: { type: String, default: "", index: true },
    vehicleId: { type: String, default: "", index: true },
    driverId: { type: String, default: "", index: true },
    guideId: { type: String, default: "", index: true },
    sourceModule: { type: String, default: "", index: true },
    sourceEntityType: { type: String, default: "", index: true },
    sourceEntityId: { type: String, default: "", index: true },
    sourceReference: { type: String, default: "", index: true },
    postingType: { type: String, default: "", index: true },
    postingKey: { type: String, default: "", index: true },
    metadata: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

journalEntryLineSchema.index({ accountId: 1, postingDate: 1 });
journalEntryLineSchema.index({ accountCode: 1, postingDate: 1 });
journalEntryLineSchema.index({ journalStatus: 1, postingDate: 1 });
journalEntryLineSchema.index({ sourceModule: 1, sourceEntityId: 1, postingType: 1 });
journalEntryLineSchema.index({ businessUnit: 1, postingDate: 1 });

module.exports = mongoose.model("JournalEntryLine", journalEntryLineSchema);
