const mongoose = require("mongoose");

const syncLogSchema = new mongoose.Schema(
  {
    source: { type: String, default: "bokun" },
    operation: {
      type: String,
      enum: ["products_sync", "booking_sync", "webhook_update"],
      required: true
    },
    status: { type: String, enum: ["started", "success", "failed"], required: true },
    syncedCount: { type: Number, default: 0 },
    details: mongoose.Schema.Types.Mixed,
    startedAt: { type: Date, default: Date.now },
    completedAt: Date
  },
  { timestamps: true }
);

module.exports = mongoose.model("SyncLog", syncLogSchema);