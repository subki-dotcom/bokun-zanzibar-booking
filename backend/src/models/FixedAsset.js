const mongoose = require("mongoose");
const {
  DEPRECIATION_METHOD,
  FIXED_ASSET_STATUS
} = require("../accounting/constants");

const fixedAssetSchema = new mongoose.Schema(
  {
    assetReference: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    assetAccount: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", required: true, index: true },
    accumulatedDepreciationAccount: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", required: true },
    depreciationExpenseAccount: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", required: true },
    purchaseCost: { type: mongoose.Schema.Types.Decimal128, required: true },
    currency: { type: String, required: true, uppercase: true },
    salvageValue: { type: mongoose.Schema.Types.Decimal128, required: true },
    usefulLifeMonths: { type: Number, required: true, min: 1 },
    depreciationMethod: {
      type: String,
      enum: Object.values(DEPRECIATION_METHOD),
      default: DEPRECIATION_METHOD.STRAIGHT_LINE
    },
    startDate: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: Object.values(FIXED_ASSET_STATUS),
      default: FIXED_ASSET_STATUS.DRAFT,
      index: true
    },
    createdBy: { type: String, default: "" },
    approvedBy: { type: String, default: "" },
    approvedAt: { type: Date, default: null },
    disposedAt: { type: Date, default: null },
    metadata: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

fixedAssetSchema.index({ status: 1, startDate: 1 });

module.exports = mongoose.model("FixedAsset", fixedAssetSchema);
