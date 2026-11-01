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
// Run logs of the Bókun sync jobs (one every few minutes) are kept for 7 days, then MongoDB deletes them itself.
syncLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60, name: "synclog_ttl_7_days" });

module.exports = mongoose.model("SyncLog", syncLogSchema);
