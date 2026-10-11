const mongoose = require("mongoose");

// Approved credit or debit note against a customer invoice. Before revenue is recognized it changes the
// booking revenue basis; afterwards a credit note reduces the receivable through the general ledger.
const invoiceAdjustmentSchema = new mongoose.Schema(
  {
    adjustmentReference: { type: String, required: true, unique: true, index: true },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    invoiceNumber: { type: String, required: true, index: true },
    bookingReference: { type: String, required: true, index: true },
    invoiceType: { type: String, enum: ["BOOKING", "STANDALONE"], required: true },
    type: { type: String, enum: ["CREDIT_NOTE", "DEBIT_NOTE"], required: true },
    amount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, required: true },
    reason: { type: String, required: true },
    approvalId: { type: String, required: true },
    accountingTreatment: { type: String, enum: ["REVENUE_BASIS_ADJUSTMENT", "RECOGNIZED_REVENUE_CREDIT_NOTE"], required: true },
    totalBefore: { type: Number, required: true },
    totalAfter: { type: Number, required: true },
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry", default: null },
    postingStatus: { type: String, enum: ["", "PREVIEW", "POSTED"], default: "" },
    appliedBy: { type: String, default: "" },
    appliedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.model("InvoiceAdjustment", invoiceAdjustmentSchema);
