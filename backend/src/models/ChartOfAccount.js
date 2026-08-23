const mongoose = require("mongoose");
const {
  BUSINESS_UNIT,
  GL_ACCOUNT_NORMAL_BALANCE,
  GL_ACCOUNT_SUBTYPE,
  GL_ACCOUNT_TYPE
} = require("../accounting/constants");

const normalizeToken = (value = "") => String(value || "").trim().toUpperCase();

const accountTypeForCode = (code = "") => {
  const prefix = normalizeToken(code).charAt(0);
  if (prefix === "1") return GL_ACCOUNT_TYPE.ASSET;
  if (prefix === "2") return GL_ACCOUNT_TYPE.LIABILITY;
  if (prefix === "3") return GL_ACCOUNT_TYPE.EQUITY;
  if (prefix === "4") return GL_ACCOUNT_TYPE.REVENUE;
  if (prefix === "5") return GL_ACCOUNT_TYPE.COST_OF_SALES;
  if (prefix === "6") return GL_ACCOUNT_TYPE.EXPENSE;
  if (prefix === "7") return "OTHER";
  return "";
};

const normalBalanceForType = (type = "") =>
  [
    GL_ACCOUNT_TYPE.ASSET,
    GL_ACCOUNT_TYPE.COST_OF_SALES,
    GL_ACCOUNT_TYPE.EXPENSE,
    GL_ACCOUNT_TYPE.OTHER_EXPENSE
  ].includes(type)
    ? GL_ACCOUNT_NORMAL_BALANCE.DEBIT
    : GL_ACCOUNT_NORMAL_BALANCE.CREDIT;

const chartOfAccountSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      index: true
    },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: Object.values(GL_ACCOUNT_TYPE),
      required: true,
      index: true
    },
    subtype: {
      type: String,
      enum: Object.values(GL_ACCOUNT_SUBTYPE),
      required: true,
      index: true
    },
    normalBalance: {
      type: String,
      enum: Object.values(GL_ACCOUNT_NORMAL_BALANCE),
      default: null,
      index: true
    },
    parentAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
      index: true
    },
    parentCode: { type: String, default: "", trim: true, uppercase: true },
    currency: { type: String, default: "", trim: true, uppercase: true },
    businessUnit: {
      type: String,
      enum: Object.values(BUSINESS_UNIT),
      default: BUSINESS_UNIT.UNALLOCATED,
      index: true
    },
    active: { type: Boolean, default: true, index: true },
    systemAccount: { type: Boolean, default: false, index: true },
    allowManualPosting: { type: Boolean, default: true },
    description: { type: String, default: "", trim: true },
    metadata: mongoose.Schema.Types.Mixed,
    createdBy: { type: String, default: "" },
    updatedBy: { type: String, default: "" }
  },
  { timestamps: true }
);

chartOfAccountSchema.index({ type: 1, subtype: 1, active: 1 });
chartOfAccountSchema.index({ businessUnit: 1, active: 1 });
chartOfAccountSchema.index({ parentAccount: 1, code: 1 });

chartOfAccountSchema.pre("validate", function validateChartOfAccount(next) {
  this.code = normalizeToken(this.code);
  this.parentCode = normalizeToken(this.parentCode);
  this.currency = normalizeToken(this.currency);
  this.businessUnit = normalizeToken(this.businessUnit || BUSINESS_UNIT.UNALLOCATED);
  this.type = normalizeToken(this.type);
  this.subtype = normalizeToken(this.subtype);
  this.normalBalance = normalizeToken(this.normalBalance || normalBalanceForType(this.type));

  if (!/^[1-7]\d{3}(?:-[A-Z0-9]{1,16})?$/.test(this.code)) {
    this.invalidate("code", "Account code must follow the configured chart numbering format.");
  }

  const expectedType = accountTypeForCode(this.code);
  if (expectedType === "OTHER") {
    if (![GL_ACCOUNT_TYPE.OTHER_INCOME, GL_ACCOUNT_TYPE.OTHER_EXPENSE].includes(this.type)) {
      this.invalidate("type", "7xxx accounts must be other income or other expense accounts.");
    }
  } else if (expectedType && expectedType !== this.type) {
    this.invalidate("type", "Account type does not match the configured account code range.");
  }

  if (this.parentAccount && String(this.parentAccount) === String(this._id)) {
    this.invalidate("parentAccount", "An account cannot be its own parent.");
  }

  next();
});

module.exports = mongoose.model("ChartOfAccount", chartOfAccountSchema);
