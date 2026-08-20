const mongoose = require("mongoose");
const { PAYMENT_STATUS } = require("../config/constants");

const paymentSchema = new mongoose.Schema(
  {
    bookingReference: { type: String, required: true, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },
    provider: {
      type: String,
      enum: ["stripe", "pesapal", "dpo", "paypal", "manual_bank", "cash_on_arrival", "custom"],
      default: "custom"
    },
    intentId: { type: String, required: true, index: true },
    attemptId: { type: String, default: "", index: true },
    providerTransactionId: { type: String, default: "", index: true },
    merchantReference: { type: String, default: "", index: true },
    orderTrackingId: { type: String, default: "", index: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    // Canonical financial fields. Legacy amount/currency remain during the
    // compatibility migration and are never used to represent charged FX.
    orderAmount: { type: mongoose.Schema.Types.Decimal128, default: null },
    orderCurrency: { type: String, default: "", uppercase: true },
    chargedAmount: { type: mongoose.Schema.Types.Decimal128, default: null },
    chargedCurrency: { type: String, default: "", uppercase: true },
    accountingAmount: { type: mongoose.Schema.Types.Decimal128, default: null },
    accountingCurrency: { type: String, default: "", uppercase: true },
    settlementAmount: { type: mongoose.Schema.Types.Decimal128, default: null },
    settlementCurrency: { type: String, default: "", uppercase: true },
    providerFeeAmount: { type: mongoose.Schema.Types.Decimal128, default: null },
    providerFeeCurrency: { type: String, default: "", uppercase: true },
    settledAt: { type: Date, default: null },
    fxRate: { type: mongoose.Schema.Types.Decimal128, default: null },
    fxSourceCurrency: { type: String, default: "", uppercase: true },
    fxTargetCurrency: { type: String, default: "", uppercase: true },
    fxSource: { type: String, default: "none" },
    fxQuotedAt: { type: Date, default: null },
    fxExpiresAt: { type: Date, default: null },
    settlementFx: {
      rate: { type: mongoose.Schema.Types.Decimal128, default: null },
      sourceCurrency: { type: String, default: "", uppercase: true },
      targetCurrency: { type: String, default: "", uppercase: true },
      source: { type: String, default: "" }
    },
    paymentMethod: { type: String, default: "" },
    confirmationCode: { type: String, default: "", index: true },
    paypalOrderId: { type: String, default: "", index: true },
    paypalCaptureId: { type: String, default: "", index: true },
    dpoTransactionToken: { type: String, default: "", index: true },
    dpoTransactionRef: { type: String, default: "", index: true },
    providerStatus: { type: String, default: "", index: true },
    paymentStatus: { type: String, default: "", index: true },
    verificationStatus: {
      type: String,
      enum: ["", "pending", "verified", "amount_mismatch", "currency_review_required", "reference_mismatch", "provider_error", "manual_review"],
      default: "",
      index: true
    },
    verificationReason: { type: String, default: "" },
    accountingAllocationStatus: {
      type: String,
      enum: ["", "pending", "applied", "blocked", "reversed"],
      default: "",
      index: true
    },
    accountingAllocatedAt: { type: Date, default: null },
    invoiceStatus: { type: String, default: "" },
    refundStatus: { type: String, default: "not_required" },
    bokunSyncStatus: { type: String, default: "not_started" },
    anomaly: {
      flagged: { type: Boolean, default: false },
      code: { type: String, default: "" },
      message: { type: String, default: "" }
    },
    attemptSnapshot: {
      attemptId: { type: String, default: "" },
      merchantReference: { type: String, default: "" },
      provider: { type: String, default: "" },
      orderAmount: { type: mongoose.Schema.Types.Decimal128, default: null },
      orderCurrency: { type: String, default: "", uppercase: true },
      createdAt: { type: Date, default: null },
      expiresAt: { type: Date, default: null },
      status: { type: String, default: "initiated" }
    },
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING
    },
    amountPaid: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    refundedAmount: { type: Number, default: 0 },
    refundedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    lastVerifiedAt: { type: Date, default: null },
    ipnEvents: [
      {
        receivedAt: { type: Date, default: Date.now },
        source: { type: String, default: "callback" },
        orderTrackingId: String,
        merchantReference: String,
        status: String,
        raw: mongoose.Schema.Types.Mixed
      }
    ],
    transactionHistory: [
      {
        occurredAt: { type: Date, default: Date.now },
        event: { type: String, required: true },
        status: { type: String, default: "" },
        source: { type: String, default: "system" },
        description: { type: String, default: "" },
        metadata: mongoose.Schema.Types.Mixed
      }
    ],
    rawResponse: mongoose.Schema.Types.Mixed,
    providerResponse: mongoose.Schema.Types.Mixed,
    reconciliation: {
      reviewed: { type: Boolean, default: false },
      reviewedAt: { type: Date, default: null },
      reviewedBy: { type: String, default: "" },
      reviewNote: { type: String, default: "" }
    },
    notes: { type: String, default: "" }
  },
  { timestamps: true }
);

paymentSchema.index({ provider: 1, orderTrackingId: 1 });
paymentSchema.index({ provider: 1, merchantReference: 1 });
paymentSchema.index({ bookingReference: 1, provider: 1, status: 1, updatedAt: -1 });
paymentSchema.index({ bookingReference: 1, status: 1, lastVerifiedAt: -1, updatedAt: -1 });
paymentSchema.index({ status: 1, paidAt: -1, createdAt: -1 });
paymentSchema.index({ updatedAt: -1, createdAt: -1 });
paymentSchema.index({ bookingReference: 1, verificationStatus: 1, accountingAllocationStatus: 1 });
paymentSchema.index({ verificationStatus: 1, accountingAllocationStatus: 1, status: 1 });
paymentSchema.index(
  { attemptId: 1 },
  {
    unique: true,
    partialFilterExpression: { attemptId: { $type: "string", $gt: "" } },
    name: "attemptId_unique_nonempty"
  }
);

module.exports = mongoose.model("Payment", paymentSchema);
