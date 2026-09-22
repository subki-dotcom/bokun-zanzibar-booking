const mongoose = require("mongoose");

const moneySchema = new mongoose.Schema({
  amount: { type: mongoose.Schema.Types.Decimal128, required: true, min: 0 },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 }
}, { _id: false });

const adjustmentSchema = new mongoose.Schema({
  type: { type: String, enum: ["COMMISSION", "PROVIDER_FEE", "BANK_FEE", "REFUND", "CHARGEBACK", "MANUAL_ADJUSTMENT", "FX_ADJUSTMENT", "OTHER"], required: true },
  amount: { type: mongoose.Schema.Types.Decimal128, required: true, min: 0 },
  currency: { type: String, required: true, uppercase: true },
  reason: { type: String, required: true, maxlength: 1500 },
  source: { type: String, required: true, enum: ["PROVIDER_API", "PROVIDER_STATEMENT", "CSV_IMPORT", "BANK_MATCH", "MANUAL_VERIFIED", "OTHER"] },
  externalReference: { type: String, default: "" },
  occurredAt: { type: Date, default: Date.now }
}, { _id: false });

const settlementSchema = new mongoose.Schema({
  settlementReference: { type: String, required: true, unique: true, index: true },
  provider: { type: String, required: true, enum: ["GETYOURGUIDE", "VIATOR", "PESAPAL", "DPO", "PAYPAL", "BANK", "MANUAL", "OTHER"], index: true },
  providerSettlementReference: { type: String, default: "", index: true },
  idempotencyKey: { type: String, required: true, unique: true, index: true },
  status: { type: String, enum: ["EXPECTED", "PENDING", "PARTIALLY_RECEIVED", "RECEIVED", "RECONCILED", "MISMATCH", "ON_HOLD", "CANCELLED", "UNKNOWN", "NEEDS_REVIEW"], default: "PENDING", index: true },
  gross: { type: moneySchema, default: null },
  commission: { type: moneySchema, default: null },
  fees: { type: moneySchema, default: null },
  expectedNet: { type: moneySchema, default: null },
  received: { type: moneySchema, default: null },
  allocated: { type: moneySchema, default: null },
  unallocated: { type: moneySchema, default: null },
  settlementDate: { type: Date, default: null, index: true },
  receivedVia: { type: String, enum: ["PROVIDER_PAYOUT", "BANK", "CASH", "MANUAL", "OTHER"], default: "MANUAL" },
  evidenceSource: { type: String, required: true, enum: ["PROVIDER_API", "PROVIDER_STATEMENT", "CSV_IMPORT", "BANK_MATCH", "MANUAL_VERIFIED", "OTHER"] },
  evidenceReference: { type: String, required: true, maxlength: 500 },
  adjustments: { type: [adjustmentSchema], default: [] },
  notes: { type: String, default: "", maxlength: 3000 },
  createdBy: { type: String, default: "" },
  lastReconciledAt: { type: Date, default: null }
}, { timestamps: true });

settlementSchema.index({ provider: 1, providerSettlementReference: 1 }, { unique: true, partialFilterExpression: { providerSettlementReference: { $type: "string", $gt: "" } }, name: "settlement_provider_reference_unique" });
settlementSchema.index({ settlementDate: -1, provider: 1, status: 1 });

module.exports = mongoose.model("Settlement", settlementSchema);