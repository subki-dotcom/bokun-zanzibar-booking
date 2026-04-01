const mongoose = require("mongoose");

const commissionRecordSchema = new mongoose.Schema(
  {
    bookingReference: { type: String, required: true, index: true },
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: "Agent", required: true, index: true },
    bokunProductId: { type: String, required: true },
    bokunOptionId: { type: String, required: true },
    grossAmount: { type: Number, required: true },
    netAmount: { type: Number, required: true },
    commissionPercent: { type: Number, required: true },
    commissionAmount: { type: Number, required: true },
    payoutStatus: { type: String, enum: ["unpaid", "pending", "paid"], default: "unpaid" },
    payoutMonth: { type: String, required: true },
    notes: { type: String, default: "" },
    sourceOverride: {
      type: String,
      enum: ["global", "agent", "product", "option", "booking"],
      default: "global"
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("CommissionRecord", commissionRecordSchema);