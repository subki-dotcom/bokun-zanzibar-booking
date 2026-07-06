const mongoose = require("mongoose");

const agentPayoutRequestSchema = new mongoose.Schema(
  {
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: "Agent", required: true, index: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "USD" },
    status: {
      type: String,
      enum: ["pending", "approved", "paid", "rejected"],
      default: "pending",
      index: true
    },
    notes: { type: String, default: "" },
    requestedAt: { type: Date, default: Date.now },
    reviewedAt: Date,
    reviewedBy: { type: String, default: "" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("AgentPayoutRequest", agentPayoutRequestSchema);
