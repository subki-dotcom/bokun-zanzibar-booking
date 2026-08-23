const mongoose = require("mongoose");
const { COST_CENTER_TYPE } = require("../accounting/constants");

const costCenterSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: Object.values(COST_CENTER_TYPE),
      default: COST_CENTER_TYPE.OTHER,
      index: true
    },
    active: { type: Boolean, default: true, index: true },
    systemCenter: { type: Boolean, default: false },
    description: { type: String, default: "" },
    metadata: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

module.exports = mongoose.model("CostCenter", costCenterSchema);
