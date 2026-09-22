const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  eventKey: { type: String, required: true, unique: true, index: true },
  provider: { type: String, required: true, lowercase: true, index: true },
  eventId: { type: String, required: true },
  eventType: { type: String, default: "" },
  status: { type: String, enum: ["processing", "processed", "failed"], default: "processing", index: true },
  leaseExpiresAt: { type: Date, default: null },
  processedAt: { type: Date, default: null },
  lastErrorCode: { type: String, default: "" },
  attempts: { type: Number, default: 1 }
}, { timestamps: true });

schema.index({ provider: 1, status: 1, updatedAt: 1 });
module.exports = mongoose.model("ProviderWebhookEvent", schema);
