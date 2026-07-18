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
    providerTransactionId: { type: String, default: "", index: true },
    merchantReference: { type: String, default: "", index: true },
    orderTrackingId: { type: String, default: "", index: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING
    },
    amountPaid: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    refundedAmount: { type: Number, default: 0 },
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

module.exports = mongoose.model("Payment", paymentSchema);
