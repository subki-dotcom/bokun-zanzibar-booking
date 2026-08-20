const mongoose = require("mongoose");
const {
  ACCOUNTING_SCOPE,
  BUSINESS_UNIT,
  EXPENSE_CATEGORY,
  EXPENSE_PAYMENT_STATUS,
  FINANCIAL_ENTRY_STATUS,
  SOURCE_MODULE
} = require("../accounting/constants");

const businessExpenseSchema = new mongoose.Schema(
  {
    expenseReference: { type: String, required: true, unique: true, index: true },
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
      default: BUSINESS_UNIT.GENERAL_COMPANY,
      index: true
    },
    category: {
      type: String,
      enum: Object.values(EXPENSE_CATEGORY),
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
    bookingReference: { type: String, default: "", index: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", default: null, index: true },
    description: { type: String, required: true },
    supplier: {
      supplierId: { type: String, default: "" },
      name: { type: String, default: "" },
      type: { type: String, default: "" },
      contact: { type: String, default: "" }
    },
    amount: { type: mongoose.Schema.Types.Decimal128, required: true },
    currency: { type: String, required: true, uppercase: true },
    exchangeRate: { type: mongoose.Schema.Types.Decimal128, required: true },
    baseCurrency: { type: String, required: true, uppercase: true },
    baseCurrencyAmount: { type: mongoose.Schema.Types.Decimal128, required: true },
    exchangeRateDate: { type: Date, default: null },
    expenseDate: { type: Date, required: true, index: true },
    dueDate: { type: Date, default: null, index: true },
    paymentStatus: {
      type: String,
      enum: Object.values(EXPENSE_PAYMENT_STATUS),
      default: EXPENSE_PAYMENT_STATUS.UNPAID,
      index: true
    },
    paymentMethod: { type: String, default: "" },
    paymentReference: { type: String, default: "", index: true },
    receiptAttachment: {
      name: { type: String, default: "" },
      url: { type: String, default: "" },
      uploadedAt: { type: Date, default: null }
    },
    recurring: {
      active: { type: Boolean, default: false },
      recurrenceRule: { type: String, default: "" },
      nextDueDate: { type: Date, default: null }
    },
    createdBy: { type: String, default: "" },
    approvedBy: { type: String, default: "" },
    approvedAt: { type: Date, default: null },
    notes: { type: String, default: "" },
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

businessExpenseSchema.index({ accountingScope: 1, category: 1, status: 1, expenseDate: 1 });
businessExpenseSchema.index({ businessUnit: 1, expenseDate: 1 });
businessExpenseSchema.index({ sourceModule: 1, sourceReference: 1, category: 1 });
businessExpenseSchema.index({ paymentStatus: 1, dueDate: 1 });

module.exports = mongoose.model("BusinessExpense", businessExpenseSchema);
