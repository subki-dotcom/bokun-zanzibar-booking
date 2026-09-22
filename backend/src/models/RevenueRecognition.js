const mongoose = require("mongoose");

const revenueRecognitionSchema = new mongoose.Schema({
  recognitionReference: { type: String, required: true, unique: true, index: true },
  postingKey: { type: String, required: true, unique: true, index: true },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, index: true },
  bookingReference: { type: String, required: true, index: true },
  serviceCompletionId: { type: mongoose.Schema.Types.ObjectId, ref: "ServiceCompletion", required: true, index: true },
  recognizedAmount: { type: mongoose.Schema.Types.Decimal128, default: null },
  currency: { type: String, default: "", uppercase: true },
  recognitionDate: { type: Date, default: null },
  status: { type: String, enum: ["NOT_ELIGIBLE", "READY", "POSTING_BLOCKED", "POSTED", "REVERSED", "PARTIALLY_REVERSED", "ZERO_REVENUE", "NEEDS_REVIEW", "NEEDS_REVIEW_FX"], default: "NOT_ELIGIBLE", index: true },
  serviceKey: { type: String, default: "" },
  originalAmount: { type: mongoose.Schema.Types.Decimal128, default: null },
  originalCurrency: { type: String, default: "" },
  fx: mongoose.Schema.Types.Mixed,
  evidence: mongoose.Schema.Types.Mixed,
  debtor: mongoose.Schema.Types.Mixed,
  policyId: { type: String, default: "" },
  origin: { type: String, enum: ["AUTOMATIC", "MANUAL"], default: "MANUAL" },
  reversedAmount: { type: mongoose.Schema.Types.Decimal128, default: "0" },
  allocationHash: { type: String, default: "" },
  adjustmentReference: { type: String, default: "" },
  source: { type: String, default: "SERVICE_COMPLETION" },
  journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry", default: null },
  reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: "RevenueRecognition", default: null },
  blockReason: { type: String, default: "" },
  createdBy: { type: String, default: "" }
}, { timestamps: true });

module.exports = mongoose.model("RevenueRecognition", revenueRecognitionSchema);
