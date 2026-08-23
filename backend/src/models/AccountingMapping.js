const mongoose = require("mongoose");
const { GL_MAPPING_KEY } = require("../accounting/constants");

const accountingMappingSchema = new mongoose.Schema(
  {
    mappingKey: {
      type: String,
      enum: Object.values(GL_MAPPING_KEY),
      required: true,
      unique: true,
      index: true
    },
    accountCode: { type: String, required: true, uppercase: true, index: true },
    provider: { type: String, default: "", lowercase: true, index: true },
    category: { type: String, default: "", uppercase: true, index: true },
    active: { type: Boolean, default: true, index: true },
    systemMapping: { type: Boolean, default: false, index: true },
    description: { type: String, default: "" },
    createdBy: { type: String, default: "" },
    updatedBy: { type: String, default: "" },
    metadata: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

accountingMappingSchema.index({ provider: 1, active: 1 });
accountingMappingSchema.index({ category: 1, active: 1 });

module.exports = mongoose.model("AccountingMapping", accountingMappingSchema);
