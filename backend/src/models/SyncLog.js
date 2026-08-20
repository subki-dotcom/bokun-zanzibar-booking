const mongoose = require("mongoose");

const syncLogSchema = new mongoose.Schema(
  {
    source: { type: String, default: "bokun" },
    operation: {
      type: String,
      enum: ["products_sync", "booking_sync", "webhook_update", "confirmed_booking_import", "confirmed_booking_resync"],
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

syncLogSchema.index({ operation: 1, status: 1, startedAt: -1 });
syncLogSchema.index({ source: 1, operation: 1, createdAt: -1 });
syncLogSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("SyncLog", syncLogSchema);
