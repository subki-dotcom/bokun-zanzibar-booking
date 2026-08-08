const mongoose = require("mongoose");

const paymentAllocationSchema = new mongoose.Schema(
  {
    allocationKey: { type: String, required: true, unique: true, index: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", required: true, index: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice", default: null, index: true },
    bookingReference: { type: String, required: true, index: true },
    amount: { type: mongoose.Schema.Types.Decimal128, required: true },
    currency: { type: String, required: true, uppercase: true },
    chargedAmount: { type: mongoose.Schema.Types.Decimal128, default: null },
    chargedCurrency: { type: String, default: "", uppercase: true },
    historicalFxRate: { type: mongoose.Schema.Types.Decimal128, default: null },
    status: {
      type: String,
      enum: ["pending", "applied", "blocked", "reversed"],
      default: "pending",
      index: true
    },
    appliedAt: { type: Date, default: null },
    reversedAt: { type: Date, default: null },
    idempotencyKey: { type: String, required: true, index: true },
    metadata: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

paymentAllocationSchema.index({ bookingReference: 1, status: 1, createdAt: 1 });
paymentAllocationSchema.index({ paymentId: 1, status: 1 });

module.exports = mongoose.model("PaymentAllocation", paymentAllocationSchema);
