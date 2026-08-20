const mongoose = require("mongoose");
const {
  ACCOUNTING_SCOPE,
  BUSINESS_UNIT,
  FINANCIAL_ENTRY_STATUS,
  POSTING_DIRECTION,
  POSTING_TYPE,
  SOURCE_MODULE
} = require("../accounting/constants");

const decimalField = {
  type: mongoose.Schema.Types.Decimal128,
  default: null
};

const accountingComponentsSchema = new mongoose.Schema(
  {
    bookedRevenue: decimalField,
    invoicedRevenue: decimalField,
    collectedRevenue: decimalField,
    refundedAmount: decimalField,
    providerFees: decimalField,
    channelCommission: decimalField,
    directBookingCosts: decimalField,
    bookingNetContribution: decimalField,
    otherBusinessIncome: decimalField,
    operatingExpenses: decimalField,
    payrollExpenses: decimalField,
    otherExpenses: decimalField
  },
  { _id: false }
);

const accountingPostingSchema = new mongoose.Schema(
  {
    postingKey: { type: String, required: true, unique: true, index: true },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    accountingScope: {
      type: String,
      enum: Object.values(ACCOUNTING_SCOPE),
      required: true,
      index: true
    },
    sourceModule: {
      type: String,
      enum: Object.values(SOURCE_MODULE),
      required: true,
      index: true
    },
    sourceReference: { type: String, required: true, index: true },
    sourceRecordId: { type: String, default: "", index: true },
    sourceRecordModel: { type: String, default: "" },
    postingType: {
      type: String,
      enum: Object.values(POSTING_TYPE),
      required: true,
      index: true
    },
    direction: {
      type: String,
      enum: Object.values(POSTING_DIRECTION),
      required: true,
      index: true
    },
    businessUnit: {
      type: String,
      enum: Object.values(BUSINESS_UNIT),
      default: BUSINESS_UNIT.UNALLOCATED,
      index: true
    },
    bookingReference: { type: String, default: "", index: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", default: null, index: true },
    description: { type: String, default: "" },
    amount: { type: mongoose.Schema.Types.Decimal128, required: true },
    currency: { type: String, required: true, uppercase: true },
    baseCurrency: { type: String, required: true, uppercase: true },
    exchangeRate: { type: mongoose.Schema.Types.Decimal128, required: true },
    baseCurrencyAmount: { type: mongoose.Schema.Types.Decimal128, required: true },
    exchangeRateDate: { type: Date, default: null },
    transactionDate: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: Object.values(FINANCIAL_ENTRY_STATUS),
      default: FINANCIAL_ENTRY_STATUS.APPROVED,
      index: true
    },
    components: { type: accountingComponentsSchema, default: () => ({}) },
    sourceSnapshot: mongoose.Schema.Types.Mixed,
    metadata: mongoose.Schema.Types.Mixed,
    createdBy: { type: String, default: "" },
    approvedBy: { type: String, default: "" },
    approvedAt: { type: Date, default: null },
    voidReason: { type: String, default: "" }
  },
  { timestamps: true }
);

accountingPostingSchema.index(
  { accountingScope: 1, sourceModule: 1, sourceReference: 1, postingType: 1 },
  { unique: true, name: "accounting_source_posting_unique" }
);
accountingPostingSchema.index({ accountingScope: 1, postingType: 1, status: 1, transactionDate: 1 });
accountingPostingSchema.index({ businessUnit: 1, transactionDate: 1 });
accountingPostingSchema.index({ bookingReference: 1, postingType: 1 });

module.exports = mongoose.model("AccountingPosting", accountingPostingSchema);
