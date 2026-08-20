const mongoose = require("mongoose");
const AppError = require("../utils/AppError");

const auditLogSchema = new mongoose.Schema(
  {
    actorId: { type: String, default: null },
    actorRole: { type: String, default: "system" },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    reference: { type: String, default: "", index: true },
    reason: { type: String, default: "" },
    requestId: { type: String, default: "" },
    correlationId: { type: String, default: "", index: true },
    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed,
    metadata: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ actorRole: 1, createdAt: -1 });

const immutableAuditError = () =>
  new AppError("Audit logs are immutable and cannot be modified or deleted.", 409, "AUDIT_LOG_IMMUTABLE");

auditLogSchema.pre("save", function auditLogPreventDocumentUpdate(next) {
  if (!this.isNew) return next(immutableAuditError());
  return next();
});

["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"].forEach(
  (operation) => {
    auditLogSchema.pre(operation, function auditLogPreventWriteQuery(next) {
      return next(immutableAuditError());
    });
  }
);

module.exports = mongoose.model("AuditLog", auditLogSchema);
