const mongoose = require("mongoose");

const paymentAdjustmentSchema = new mongoose.Schema(
  {
    adjustmentReference: { type: String, required: true, unique: true, index: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, index: true },
    bookingRequestId: { type: mongoose.Schema.Types.ObjectId, ref: "BookingRequest", required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: "USD" },
    provider: { type: String, enum: ["pesapal", "dpo", "paypal", "manual_bank_transfer", "cash", "other"], default: "other" },
    paymentReference: { type: String, default: "" },
    paymentUrl: { type: String, default: "" },
    status: { type: String, enum: ["created", "pending", "processing", "paid", "failed", "expired", "cancelled"], default: "created", index: true },
    expiresAt: Date,
    paidAt: Date,
    gatewayResponse: mongoose.Schema.Types.Mixed,
    notes: { type: String, default: "" }
  },
  { timestamps: true }
);

paymentAdjustmentSchema.index({ bookingRequestId: 1, status: 1 });

module.exports = mongoose.model("PaymentAdjustment", paymentAdjustmentSchema);
