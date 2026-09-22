const mongoose = require("mongoose");

const serviceCompletionSchema = new mongoose.Schema({
  completionKey: { type: String, required: true, unique: true, index: true },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, index: true },
  bookingReference: { type: String, required: true, index: true },
  serviceKey: { type: String, required: true },
  serviceName: { type: String, default: "" },
  serviceDate: { type: String, default: "" },
  status: { type: String, enum: ["SCHEDULED", "IN_PROGRESS", "COMPLETION_PENDING", "COMPLETED", "NEEDS_REVIEW", "NO_SHOW", "CANCELLED", "PARTIALLY_COMPLETED", "DISPUTED", "REVERSED", "UNKNOWN"], default: "UNKNOWN", index: true },
  evidenceSource: { type: String, enum: ["BOKUN_ARRIVED", "BOKUN_NO_SHOW", "BOKUN_CANCELLED", "LOCAL_OPERATOR_CONFIRMATION", "DRIVER_CONFIRMATION", "GUIDE_CONFIRMATION", "ADMIN_CONFIRMATION", "ADMIN_VERIFIED", "OTHER_VERIFIED_SOURCE"], required: true },
  externalStatus: { type: String, default: "" },
  externalProductId: { type: String, default: "" },
  externalReference: { type: String, default: "" },
  evidenceTimestamp: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  verifiedAt: { type: Date, default: null },
  verifiedBy: { type: String, default: "" },
  createdBy: { type: String, default: "" },
  reason: { type: String, default: "", maxlength: 1500 },
  notes: { type: String, default: "", maxlength: 3000 },
  // Supplemental FX/component evidence is approved through the existing accounting permission.
  revenueEvidence: { type: mongoose.Schema.Types.Mixed, default: null },
  revenueStatus: { type: String, default: "", index: true },
  revenueBlockers: [{ type: String }],
  recognitionId: { type: mongoose.Schema.Types.ObjectId, ref: "RevenueRecognition", default: null },
  reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: "ServiceCompletion", default: null },
  reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: "ServiceCompletion", default: null }
}, { timestamps: true });

serviceCompletionSchema.index({ bookingReference: 1, serviceKey: 1, status: 1 });
module.exports = mongoose.model("ServiceCompletion", serviceCompletionSchema);
