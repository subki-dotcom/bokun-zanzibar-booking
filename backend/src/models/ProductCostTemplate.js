const crypto = require("node:crypto");
const mongoose = require("mongoose");

const COST_BASIS_TYPES = [
  "fixed_per_booking",
  "per_participant",
  "per_adult",
  "per_child",
  "per_vehicle",
  "per_group",
  "percentage",
  "tiered",
  "manual"
];

const TEMPLATE_STATUSES = ["draft", "active", "inactive", "archived"];

const costTierSchema = new mongoose.Schema(
  {
    min: { type: Number, default: 0 },
    max: { type: Number, default: null },
    amount: { type: Number, default: 0 }
  },
  { _id: false }
);

const costLineSchema = new mongoose.Schema(
  {
    lineId: {
      type: String,
      default: () => crypto.randomUUID()
    },
    category: { type: String, required: true },
    expenseCategory: { type: String, default: "" },
    description: { type: String, default: "" },
    basis: { type: String, enum: COST_BASIS_TYPES, required: true },
    appliesTo: { type: String, default: "all" },
    amount: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    percentageBase: { type: String, default: "selling_amount" },
    tiers: [costTierSchema],
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", default: null },
    notes: { type: String, default: "" },
    sortOrder: { type: Number, default: 0 }
  },
  { _id: false }
);

const productCostTemplateSchema = new mongoose.Schema(
  {
    bokunProductId: { type: String, required: true, index: true },
    bokunProductTitle: { type: String, required: true },
    bokunProductImage: { type: String, default: "" },
    bokunOptionId: { type: String, required: true, index: true },
    bokunOptionTitle: { type: String, required: true },
    pricingCategoryId: { type: String, default: "", index: true },
    pricingCategoryTitle: { type: String, default: "" },
    currency: { type: String, default: "USD" },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    internalNotes: { type: String, default: "" },
    status: { type: String, enum: TEMPLATE_STATUSES, default: "draft", index: true },
    version: { type: Number, default: 1 },
    validFrom: { type: Date, default: Date.now },
    validTo: { type: Date, default: null },
    costLines: [costLineSchema],
    source: {
      productSnapshotId: { type: String, default: "" },
      productLastSyncedAt: { type: Date, default: null },
      identitySource: { type: String, default: "ProductSnapshot" }
    },
    createdBy: {
      id: { type: String, default: "" },
      role: { type: String, default: "" },
      email: { type: String, default: "" }
    },
    updatedBy: {
      id: { type: String, default: "" },
      role: { type: String, default: "" },
      email: { type: String, default: "" }
    },
    archivedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

productCostTemplateSchema.index({
  bokunProductId: 1,
  bokunOptionId: 1,
  pricingCategoryId: 1,
  status: 1,
  validFrom: 1,
  validTo: 1
});
productCostTemplateSchema.index({ status: 1, updatedAt: -1 });
productCostTemplateSchema.index({ "costLines.basis": 1 });

module.exports = mongoose.model("ProductCostTemplate", productCostTemplateSchema);
module.exports.COST_BASIS_TYPES = COST_BASIS_TYPES;
module.exports.TEMPLATE_STATUSES = TEMPLATE_STATUSES;
