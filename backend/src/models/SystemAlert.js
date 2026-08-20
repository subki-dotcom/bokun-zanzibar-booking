const mongoose = require("mongoose");

const ALERT_CATEGORIES = [
  "OPERATIONS",
  "FINANCE",
  "PAYMENTS",
  "REFUNDS",
  "RECONCILIATION",
  "DATA_QUALITY",
  "SECURITY",
  "BOKUN_SYNC",
  "BUSINESS_PERFORMANCE"
];

const ALERT_STATES = ["OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"];
const ALERT_SEVERITIES = ["INFO", "WARNING", "ERROR", "CRITICAL"];

const systemAlertSchema = new mongoose.Schema(
  {
    alertKey: { type: String, required: true, unique: true, index: true },
    category: { type: String, enum: ALERT_CATEGORIES, required: true, index: true },
    severity: { type: String, enum: ALERT_SEVERITIES, default: "WARNING", index: true },
    state: { type: String, enum: ALERT_STATES, default: "OPEN", index: true },
    title: { type: String, required: true, maxlength: 220 },
    message: { type: String, default: "", maxlength: 2000 },
    sourceType: { type: String, default: "", index: true },
    sourceId: { type: String, default: "", index: true },
    reference: { type: String, default: "", index: true },
    assignedTo: { type: String, default: "", index: true },
    acknowledgedBy: { type: String, default: "" },
    acknowledgedAt: { type: Date, default: null },
    resolvedBy: { type: String, default: "" },
    resolvedAt: { type: Date, default: null },
    dismissedBy: { type: String, default: "" },
    dismissedAt: { type: Date, default: null },
    resolutionNote: { type: String, default: "", maxlength: 2000 },
    firstSeenAt: { type: Date, default: Date.now, index: true },
    lastSeenAt: { type: Date, default: Date.now, index: true },
    createdBy: { type: String, default: "" },
    updatedBy: { type: String, default: "" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

systemAlertSchema.index({ state: 1, severity: 1, category: 1, lastSeenAt: -1 });
systemAlertSchema.index({ category: 1, reference: 1, state: 1 });
systemAlertSchema.index({ sourceType: 1, sourceId: 1, state: 1 });

module.exports = mongoose.model("SystemAlert", systemAlertSchema);
module.exports.ALERT_CATEGORIES = ALERT_CATEGORIES;
module.exports.ALERT_STATES = ALERT_STATES;
module.exports.ALERT_SEVERITIES = ALERT_SEVERITIES;
