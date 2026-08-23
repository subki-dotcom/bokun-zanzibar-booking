const mongoose = require("mongoose");
const {
  GL_POSTING_TYPE,
  SOURCE_MODULE
} = require("../accounting/constants");

const postingRuleSchema = new mongoose.Schema(
  {
    eventType: { type: String, enum: Object.values(GL_POSTING_TYPE), required: true, index: true },
    sourceModule: { type: String, enum: Object.values(SOURCE_MODULE), required: true, index: true },
    debitAccountRule: { type: String, required: true },
    creditAccountRule: { type: String, required: true },
    businessUnitRule: { type: String, default: "" },
    descriptionTemplate: { type: String, default: "" },
    active: { type: Boolean, default: true, index: true },
    systemRule: { type: Boolean, default: false, index: true },
    createdBy: { type: String, default: "" },
    updatedBy: { type: String, default: "" },
    metadata: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

postingRuleSchema.index({ eventType: 1, sourceModule: 1, active: 1 }, { unique: true, name: "posting_rule_unique" });

module.exports = mongoose.model("PostingRule", postingRuleSchema);
