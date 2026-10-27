const mongoose = require("mongoose");

// A credit note (CN-2026-00001) against an issued invoice, e.g. for a refund. Like the invoice it is never
// changed after it is issued; `document` is the frozen customer copy shown on the page and in the PDF.
const creditNoteSchema = new mongoose.Schema(
  {
    creditNoteNumber: { type: String, required: true, unique: true },
    invoiceNumber: { type: String, required: true, index: true },
    bookingReference: { type: String, required: true, index: true },
    // The refund it records (one credit note per refund).
    refund: { type: mongoose.Schema.Types.ObjectId, ref: "Refund", default: null },
    issueDate: { type: Date, required: true },
    reason: { type: String, default: "" },
    document: { type: mongoose.Schema.Types.Mixed, required: true },
    verificationToken: { type: String, required: true, unique: true }
  },
  { timestamps: true }
);

creditNoteSchema.index({ refund: 1 }, { unique: true, partialFilterExpression: { refund: { $type: "objectId" } } });

module.exports = mongoose.model("CreditNote", creditNoteSchema);
