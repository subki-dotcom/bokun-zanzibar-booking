const mongoose = require("mongoose");

// One counter per document series and year ("INV-2026", "CN-2026"). Numbers come from an atomic $inc, so two
// invoices can never get the same number and a number is never handed out twice.
const documentCounterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 }
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("DocumentCounter", documentCounterSchema);
