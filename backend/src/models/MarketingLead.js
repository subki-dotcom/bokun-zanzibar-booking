const mongoose = require("mongoose");

const marketingLeadSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
    firstName: { type: String, default: "", trim: true },
    lastName: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true },
    newsletterConsent: { type: Boolean, default: false },
    recoveryConsent: { type: Boolean, default: false },
    subscriptionStatus: { type: String, enum: ["subscribed", "unsubscribed", "unknown"], default: "unknown" },
    lastSeenAt: { type: Date, default: Date.now },
    journey: [{
      stage: { type: String, required: true },
      occurredAt: { type: Date, default: Date.now },
      source: { type: String, default: "website" },
      context: mongoose.Schema.Types.Mixed
    }]
  },
  { timestamps: true }
);

module.exports = mongoose.model("MarketingLead", marketingLeadSchema);
