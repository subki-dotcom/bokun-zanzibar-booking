const mongoose = require("mongoose");

const supplierPaymentSchema = new mongoose.Schema({
  paymentReference: { type: String, required: true, unique: true, index: true },
  idempotencyKey: { type: String, required: true, unique: true, index: true },
  supplierId: { type: String, default: "", index: true },
  supplierName: { type: String, default: "" },
  amount: { type: mongoose.Schema.Types.Decimal128, required: true },
  currency: { type: String, required: true, uppercase: true },
  baseCurrency: { type: String, required: true, uppercase: true },
  exchangeRate: { type: mongoose.Schema.Types.Decimal128, required: true },
  exchangeRateDate: { type: Date, default: null },
  exchangeRateSource: { type: String, default: "" },
  baseCurrencyAmount: { type: mongoose.Schema.Types.Decimal128, required: true },
  paymentDate: { type: Date, required: true, index: true },
  paymentMethod: { type: String, required: true },
  paymentSourceMappingKey: { type: String, required: true },
  allocations: [{
    expenseId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessExpense", required: true },
    amount: { type: mongoose.Schema.Types.Decimal128, required: true },
    baseCurrencyAmount: { type: mongoose.Schema.Types.Decimal128, required: true }
  }],
  status: { type: String, enum: ["DRAFT", "POSTING", "POSTED", "NEEDS_REVIEW", "FAILED_RETRYABLE"], default: "DRAFT", index: true },
  accountingStatus: { type: String, enum: ["NOT_READY", "POSTING", "POSTED", "NEEDS_REVIEW", "FAILED_RETRYABLE"], default: "NOT_READY", index: true },
  journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry", default: null, index: true },
  canonicalPostingKey: { type: String, default: "", unique: true, sparse: true },
  failure: { type: String, default: "" },
  accountingLastAttemptAt: { type: Date, default: null },
  accountingPostedAt: { type: Date, default: null },
  allocationsReservedAt: { type: Date, default: null },
  allocationsAppliedAt: { type: Date, default: null },
  createdBy: { type: String, default: "" }
}, { timestamps: true });

module.exports = mongoose.model("SupplierPayment", supplierPaymentSchema);