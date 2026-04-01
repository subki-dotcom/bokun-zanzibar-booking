const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    actorId: { type: String, default: null },
    actorRole: { type: String, default: "system" },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    reason: { type: String, default: "" },
    requestId: { type: String, default: "" },
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed,
    metadata: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

module.exports = mongoose.model("AuditLog", auditLogSchema);