const mongoose = require("mongoose");
const { PAYMENT_STATUS } = require("../config/constants");

const paymentSchema = new mongoose.Schema(
  {
    bookingReference: { type: String, required: true, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },
    provider: {
      type: String,
      enum: ["stripe", "pesapal", "dpo", "manual_bank", "cash_on_arrival", "custom"],
      default: "custom"
    },
    intentId: { type: String, required: true, index: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING
    },
    paidAmount: { type: Number, default: 0 },
    refundedAmount: { type: Number, default: 0 },
    providerResponse: mongoose.Schema.Types.Mixed,
    notes: { type: String, default: "" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Payment", paymentSchema);
