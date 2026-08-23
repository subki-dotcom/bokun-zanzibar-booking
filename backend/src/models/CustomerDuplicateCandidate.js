const mongoose = require("mongoose");
const { DUPLICATE_CANDIDATE_STATUS } = require("../crm/constants");

const customerDuplicateCandidateSchema = new mongoose.Schema(
  {
    primaryCustomerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
    duplicateCustomerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
    candidateKey: { type: String, required: true, trim: true, index: true },
    matchFields: { type: [String], default: [] },
    confidence: { type: Number, min: 0, max: 1, default: 0.5 },
    status: {
      type: String,
      enum: Object.values(DUPLICATE_CANDIDATE_STATUS),
      default: DUPLICATE_CANDIDATE_STATUS.OPEN,
      index: true
    },
    reasons: { type: [String], default: [] },
    reviewedBy: {
      id: { type: String, default: "" },
      role: { type: String, default: "" },
      email: { type: String, default: "" }
    },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: "" },
    metadata: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

customerDuplicateCandidateSchema.index(
  { primaryCustomerId: 1, duplicateCustomerId: 1 },
  { unique: true, name: "customer_duplicate_candidate_pair_unique" }
);
customerDuplicateCandidateSchema.index({ status: 1, updatedAt: -1 });

module.exports = mongoose.model("CustomerDuplicateCandidate", customerDuplicateCandidateSchema);
