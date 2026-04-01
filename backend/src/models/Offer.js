const mongoose = require("mongoose");

const offerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    code: { type: String, uppercase: true, trim: true, index: true },
    description: { type: String, default: "" },
    discountType: {
      type: String,
      enum: ["percentage", "fixed"],
      required: true
    },
    discountValue: { type: Number, required: true },
    automaticCampaign: { type: Boolean, default: false },
    productIds: [{ type: String }],
    optionIds: [{ type: String }],
    startsAt: Date,
    endsAt: Date,
    active: { type: Boolean, default: true },
    maxUses: { type: Number, default: null },
    usedCount: { type: Number, default: 0 },
    localSubsidyOnly: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Offer", offerSchema);