const mongoose = require("mongoose");
const { ACCOUNTING_PERIOD_STATUS } = require("../accounting/constants");

const accountingPeriodSchema = new mongoose.Schema(
  {
    periodKey: { type: String, required: true, unique: true, index: true },
    label: { type: String, required: true },
    month: { type: Number, min: 1, max: 12, default: null, index: true },
    quarter: { type: Number, min: 1, max: 4, default: null, index: true },
    year: { type: Number, required: true, index: true },
    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: Object.values(ACCOUNTING_PERIOD_STATUS),
      default: ACCOUNTING_PERIOD_STATUS.OPEN,
      index: true
    },
    closedBy: { type: String, default: "" },
    closedAt: { type: Date, default: null },
    reopenedBy: { type: String, default: "" },
    reopenedAt: { type: Date, default: null },
    lockedBy: { type: String, default: "" },
    lockedAt: { type: Date, default: null },
    reason: { type: String, default: "" },
    closeChecklist: mongoose.Schema.Types.Mixed,
    metadata: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

accountingPeriodSchema.index({ year: 1, month: 1 }, { unique: true, sparse: true });
accountingPeriodSchema.index({ status: 1, startDate: 1, endDate: 1 });

module.exports = mongoose.model("AccountingPeriod", accountingPeriodSchema);
