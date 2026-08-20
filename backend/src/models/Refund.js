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
    originalProviderTransactionId: { type: String, default: "" },
    originalChargedAmount: { type: mongoose.Schema.Types.Decimal128, default: null },
    originalChargedCurrency: { type: String, default: "", uppercase: true },
    providerRefundRequestReference: { type: String, default: "", index: true },
    providerRefundReference: { type: String, default: "", index: true },
    amount: { type: Number, required: true, min: 0 },
    requestedAmount: { type: Number, default: 0 },
    confirmedRefundedAmount: { type: Number, default: 0 },
    eligibleRefundAmount: { type: Number, default: null },
    cancellationFee: { type: Number, default: null },
    currency: { type: String, required: true, default: "USD" },
    requestedRefundAmount: { type: mongoose.Schema.Types.Decimal128, default: null },
    requestedRefundCurrency: { type: String, default: "", uppercase: true },
    accountingRefundAmount: { type: mongoose.Schema.Types.Decimal128, default: null },
    accountingRefundCurrency: { type: String, default: "", uppercase: true },
    confirmedProviderRefundedAmount: { type: mongoose.Schema.Types.Decimal128, default: null },
    confirmedAccountingRefundedAmount: { type: mongoose.Schema.Types.Decimal128, default: null },
    historicalFxRate: { type: mongoose.Schema.Types.Decimal128, default: null },
    providerRefundStatus: { type: String, default: "" },
    reason: { type: String, required: true, maxlength: 1500 },
    status: {
      type: String,
      enum: ["requested", "eligible", "pending_approval", "approved", "awaiting_merchant_approval", "processing", "verification_required", "partially_refunded", "refunded", "failed", "rejected", "cancelled", "manual_review", "manual_refund_required"],
      default: "pending_approval",
      index: true
    },
    idempotencyKey: { type: String, default: "", index: true },
    requestedAt: { type: Date, default: Date.now },
    approvedAt: Date,
    processingStartedAt: Date,
    completedAt: Date,
    failedAt: Date,
    lastRefundSyncAt: { type: Date, default: null },
    failureReason: { type: String, default: "" },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    metadata: mongoose.Schema.Types.Mixed,
    providerRequestSnapshot: mongoose.Schema.Types.Mixed,
    providerResponseSnapshot: mongoose.Schema.Types.Mixed,
    rawProviderResponse: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

refundSchema.index({ bookingId: 1, status: 1 });
refundSchema.index({ provider: 1, status: 1, lastRefundSyncAt: 1, updatedAt: 1 });
refundSchema.index({ paymentId: 1, status: 1 });
refundSchema.index({ bookingRequestId: 1, status: 1 });
refundSchema.index({ status: 1, completedAt: -1 });

module.exports = mongoose.model("Refund", refundSchema);
