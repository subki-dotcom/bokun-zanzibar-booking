const mongoose = require("mongoose");
const { BOOKING_DIRECT_COST_CATEGORIES } = require("../accounting/bookingExpensePolicy");
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
    bookingExpenseRequestHash: { type: String, default: "" },
    accountingScope: {
      type: String,
      enum: [ACCOUNTING_SCOPE.BUSINESS, ACCOUNTING_SCOPE.BOOKING],
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
      enum: [...Object.values(EXPENSE_CATEGORY), ...BOOKING_DIRECT_COST_CATEGORIES],
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
    accountingStatus: {
      type: String,
      enum: ["NOT_READY", "READY_TO_POST", "POSTING", "POSTED", "POSTING_BLOCKED", "NEEDS_REVIEW", "REVERSED", "FAILED_RETRYABLE"],
      default: "NOT_READY",
      index: true
    },
    canonicalPostingKey: { type: String, default: "", index: true },
    journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry", default: null, index: true },
    accountingBlockers: { type: [String], default: [] },
    accountingLastAttemptAt: { type: Date, default: null },
    accountingPostedAt: { type: Date, default: null },
    accountingFailure: { type: String, default: "" },
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
    exchangeRateSource: { type: String, default: "" },
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
    supplierPaymentAllocations: [{
      paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierPayment" },
      amount: { type: mongoose.Schema.Types.Decimal128 },
      baseCurrencyAmount: { type: mongoose.Schema.Types.Decimal128 },
      allocatedAt: { type: Date, default: null }
    }],
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
    completionStatus: {
      type: String,
      enum: ["NOT_STARTED", "IN_PROGRESS", "COMPLETE", "NEEDS_REVIEW"],
      default: "NOT_STARTED",
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
