const mongoose = require("mongoose");

const settlementAllocationSchema = new mongoose.Schema({
  allocationKey: { type: String, required: true, unique: true, index: true },
  settlementId: { type: mongoose.Schema.Types.ObjectId, ref: "Settlement", required: true, index: true },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, index: true },
  bookingReference: { type: String, required: true, index: true },
  amount: { type: mongoose.Schema.Types.Decimal128, required: true, min: 0 },
  currency: { type: String, required: true, uppercase: true },
  purpose: { type: String, enum: ["PAYOUT", "ADJUSTMENT", "REFUND", "OTHER"], default: "PAYOUT" },
  status: { type: String, enum: ["APPLIED", "REVERSED"], default: "APPLIED", index: true },
  reason: { type: String, default: "", maxlength: 1500 },
  createdBy: { type: String, default: "" },
  reversedAt: { type: Date, default: null }
}, { timestamps: true });

settlementAllocationSchema.index({ settlementId: 1, bookingId: 1, purpose: 1 }, { unique: true, partialFilterExpression: { status: "APPLIED" }, name: "settlement_booking_purpose_unique" });
settlementAllocationSchema.index({ bookingReference: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("SettlementAllocation", settlementAllocationSchema);