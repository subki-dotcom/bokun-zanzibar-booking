const mongoose = require("mongoose");

const refundSchema = new mongoose.Schema(
  {
    refundReference: { type: String, required: true, unique: true, index: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, index: true },
    bookingRequestId: { type: mongoose.Schema.Types.ObjectId, ref: "BookingRequest", required: true, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", default: null },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice", default: null },
    provider: {
      type: String,
      enum: ["pesapal", "dpo", "paypal", "manual_bank_transfer", "cash", "other"],
      default: "other"
    },
    originalTransactionReference: { type: String, default: "" },
    providerRefundReference: { type: String, default: "", index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: "USD" },
    reason: { type: String, required: true, maxlength: 1500 },
    status: {
      type: String,
      enum: ["pending_approval", "approved", "processing", "partially_refunded", "refunded", "failed", "rejected", "cancelled", "manual_review"],
      default: "pending_approval",
      index: true
    },
    requestedAt: { type: Date, default: Date.now },
    approvedAt: Date,
    processingStartedAt: Date,
    completedAt: Date,
    failedAt: Date,
    failureReason: { type: String, default: "" },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    metadata: mongoose.Schema.Types.Mixed,
    providerRequestSnapshot: mongoose.Schema.Types.Mixed,
    providerResponseSnapshot: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

refundSchema.index({ bookingId: 1, status: 1 });

module.exports = mongoose.model("Refund", refundSchema);
