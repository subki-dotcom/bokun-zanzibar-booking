const mongoose = require("mongoose");

const emailDeliverySchema = new mongoose.Schema(
  {
    bookingReference: { type: String, required: true, index: true },
    templateKey: { type: String, required: true },
    recipient: { type: String, required: true, lowercase: true, trim: true },
    subject: { type: String, default: "" },
    status: { type: String, enum: ["queued", "processing", "sent", "failed", "skipped"], default: "queued" },
    provider: { type: String, default: "resend" },
    providerMessageId: { type: String, default: "" },
    error: { type: String, default: "" },
    sentAt: Date,
    lastAttemptAt: Date
  },
  { timestamps: true }
);

emailDeliverySchema.index({ bookingReference: 1, templateKey: 1 }, { unique: true });

module.exports = mongoose.model("EmailDelivery", emailDeliverySchema);
