const mongoose = require("mongoose");
const {
  ACCOUNTING_SCOPE,
  BUSINESS_UNIT,
  FINANCIAL_ENTRY_STATUS,
  INCOME_CATEGORY,
  SOURCE_MODULE
} = require("../accounting/constants");

const businessIncomeSchema = new mongoose.Schema(
  {
    incomeReference: { type: String, required: true, unique: true, index: true },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    accountingScope: {
      type: String,
      enum: [ACCOUNTING_SCOPE.BUSINESS],
      default: ACCOUNTING_SCOPE.BUSINESS,
      index: true
    },
    businessUnit: {
      type: String,
      enum: Object.values(BUSINESS_UNIT),
      default: BUSINESS_UNIT.UNALLOCATED,
      index: true
    },
    incomeCategory: {
      type: String,
      enum: Object.values(INCOME_CATEGORY),
      required: true,
      index: true
    },
    sourceModule: {
      type: String,
      enum: Object.values(SOURCE_MODULE),
      default: SOURCE_MODULE.BUSINESS_ACCOUNTING,
      index: true
    },
    sourceReference: { type: String, default: "", index: true },
    sourceRecordId: { type: String, default: "", index: true },
    sourceRecordModel: { type: String, default: "" },
    accountingPostingId: { type: mongoose.Schema.Types.ObjectId, ref: "AccountingPosting", default: null, index: true },
    description: { type: String, required: true },
    amount: { type: mongoose.Schema.Types.Decimal128, required: true },
    currency: { type: String, required: true, uppercase: true },
    exchangeRate: { type: mongoose.Schema.Types.Decimal128, required: true },
    baseCurrency: { type: String, required: true, uppercase: true },
    baseCurrencyAmount: { type: mongoose.Schema.Types.Decimal128, required: true },
    exchangeRateDate: { type: Date, default: null },
    transactionDate: { type: Date, required: true, index: true },
    paymentMethod: { type: String, default: "" },
    reference: { type: String, default: "", index: true },
    customerOrCounterparty: {
      name: { type: String, default: "" },
      email: { type: String, default: "" },
      phone: { type: String, default: "" },
      type: { type: String, default: "" }
    },
    notes: { type: String, default: "" },
    createdBy: { type: String, default: "" },
    approvedBy: { type: String, default: "" },
    approvedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: Object.values(FINANCIAL_ENTRY_STATUS),
      default: FINANCIAL_ENTRY_STATUS.DRAFT,
      index: true
    },
    metadata: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

businessIncomeSchema.index({ accountingScope: 1, incomeCategory: 1, status: 1, transactionDate: 1 });
businessIncomeSchema.index({ businessUnit: 1, transactionDate: 1 });
businessIncomeSchema.index({ sourceModule: 1, sourceReference: 1, incomeCategory: 1 });

module.exports = mongoose.model("BusinessIncome", businessIncomeSchema);
