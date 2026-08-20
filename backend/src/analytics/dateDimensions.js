const AppError = require("../utils/AppError");
const {
  ANALYTICS_DATE_DIMENSION,
  ANALYTICS_SOURCE_LAYER
} = require("./constants");

const DATE_DIMENSION_CATEGORY = Object.freeze({
  OPERATIONAL: "OPERATIONAL",
  FINANCIAL: "FINANCIAL",
  ACCOUNTING: "ACCOUNTING",
  SYSTEM: "SYSTEM"
});

const DATE_DIMENSION_CONFIG = Object.freeze({
  [ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE]: {
    key: ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE,
    label: "Accounting transaction date",
    category: DATE_DIMENSION_CATEGORY.ACCOUNTING,
    sourceLayer: ANALYTICS_SOURCE_LAYER.BUSINESS_ACCOUNTING,
    model: "AccountingPosting",
    mongoDateField: "transactionDate",
    visibleToUser: true,
    defaultFor: ["executive", "profitability", "business-units", "trends"]
  },
  [ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE]: {
    key: ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE,
    label: "Bokun booking created date",
    category: DATE_DIMENSION_CATEGORY.OPERATIONAL,
    sourceLayer: ANALYTICS_SOURCE_LAYER.OPERATIONS,
    model: "Booking",
    mongoDateField: "bokunOperationalDates.bookingCreatedAtBokun.normalizedAt",
    mongoLocalDateField: "bokunOperationalDates.bookingCreatedAtBokun.localDate",
    visibleToUser: true,
    defaultFor: ["sales", "customers"]
  },
  [ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE]: {
    key: ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE,
    label: "Bokun travel date",
    category: DATE_DIMENSION_CATEGORY.OPERATIONAL,
    sourceLayer: ANALYTICS_SOURCE_LAYER.OPERATIONS,
    model: "Booking",
    mongoDateField: "bokunOperationalDates.travelDate.normalizedAt",
    mongoLocalDateField: "bokunOperationalDates.travelDate.localDate",
    visibleToUser: true,
    defaultFor: ["operations", "products", "channels"]
  },
  [ANALYTICS_DATE_DIMENSION.PAYMENT_DATE]: {
    key: ANALYTICS_DATE_DIMENSION.PAYMENT_DATE,
    label: "Payment date",
    category: DATE_DIMENSION_CATEGORY.FINANCIAL,
    sourceLayer: ANALYTICS_SOURCE_LAYER.BOOKING_ACCOUNTING,
    model: "Payment",
    mongoDateField: "paidAt",
    visibleToUser: true,
    defaultFor: ["collections", "cash"]
  },
  [ANALYTICS_DATE_DIMENSION.REFUND_DATE]: {
    key: ANALYTICS_DATE_DIMENSION.REFUND_DATE,
    label: "Refund completion date",
    category: DATE_DIMENSION_CATEGORY.FINANCIAL,
    sourceLayer: ANALYTICS_SOURCE_LAYER.BOOKING_ACCOUNTING,
    model: "Refund",
    mongoDateField: "completedAt",
    visibleToUser: true,
    defaultFor: ["refunds"]
  },
  [ANALYTICS_DATE_DIMENSION.EXPENSE_DATE]: {
    key: ANALYTICS_DATE_DIMENSION.EXPENSE_DATE,
    label: "Expense date",
    category: DATE_DIMENSION_CATEGORY.FINANCIAL,
    sourceLayer: ANALYTICS_SOURCE_LAYER.BUSINESS_ACCOUNTING,
    model: "BusinessExpense",
    mongoDateField: "expenseDate",
    visibleToUser: true,
    defaultFor: ["expenses"]
  },
  [ANALYTICS_DATE_DIMENSION.SETTLEMENT_DATE]: {
    key: ANALYTICS_DATE_DIMENSION.SETTLEMENT_DATE,
    label: "Settlement date",
    category: DATE_DIMENSION_CATEGORY.FINANCIAL,
    sourceLayer: ANALYTICS_SOURCE_LAYER.BOOKING_ACCOUNTING,
    model: "Payment",
    mongoDateField: "settledAt",
    visibleToUser: true,
    defaultFor: ["settlements", "cash"]
  },
  [ANALYTICS_DATE_DIMENSION.BOOKING_CREATED_AT]: {
    key: ANALYTICS_DATE_DIMENSION.BOOKING_CREATED_AT,
    label: "Local booking record created date",
    category: DATE_DIMENSION_CATEGORY.SYSTEM,
    sourceLayer: ANALYTICS_SOURCE_LAYER.OPERATIONS,
    model: "Booking",
    mongoDateField: "createdAt",
    visibleToUser: true,
    defaultFor: []
  },
  [ANALYTICS_DATE_DIMENSION.INVOICE_ISSUE_DATE]: {
    key: ANALYTICS_DATE_DIMENSION.INVOICE_ISSUE_DATE,
    label: "Invoice issue date",
    category: DATE_DIMENSION_CATEGORY.FINANCIAL,
    sourceLayer: ANALYTICS_SOURCE_LAYER.BOOKING_ACCOUNTING,
    model: "Invoice",
    mongoDateField: "issueDate",
    visibleToUser: true,
    defaultFor: ["invoices", "receivables"]
  }
});

const normalizeDateDimension = (
  value = ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE,
  fallback = ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE
) => {
  const token = String(value || fallback || "").trim().toUpperCase();
  if (DATE_DIMENSION_CONFIG[token]) return token;
  throw new AppError("Analytics date dimension is not supported", 422, "ANALYTICS_DATE_DIMENSION_INVALID", { value });
};

const getDateDimensionConfig = (dimension = ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE) =>
  DATE_DIMENSION_CONFIG[normalizeDateDimension(dimension)];

const assertDateDimensionAllowed = (dimension, allowed = []) => {
  const normalized = normalizeDateDimension(dimension);
  if (allowed.length && !allowed.includes(normalized)) {
    throw new AppError("Analytics date dimension is not allowed for this report", 422, "ANALYTICS_DATE_DIMENSION_NOT_ALLOWED", {
      dimension: normalized,
      allowed
    });
  }
  return normalized;
};

const buildDateDimensionMatch = ({ dateDimension, range, allowed = [] } = {}) => {
  const normalized = assertDateDimensionAllowed(dateDimension, allowed);
  const config = getDateDimensionConfig(normalized);
  if (!range?.from && !range?.to) return {};

  const bounds = {};
  if (range?.from) bounds.$gte = range.from;
  if (range?.to) bounds.$lt = range.to;
  return Object.keys(bounds).length ? { [config.mongoDateField]: bounds } : {};
};

const describeDateDimension = (dateDimension) => {
  const config = getDateDimensionConfig(dateDimension);
  return {
    key: config.key,
    label: config.label,
    category: config.category,
    sourceLayer: config.sourceLayer,
    model: config.model,
    mongoDateField: config.mongoDateField,
    mongoLocalDateField: config.mongoLocalDateField || "",
    visibleToUser: config.visibleToUser,
    defaultFor: config.defaultFor
  };
};

const listDateDimensions = () =>
  Object.values(DATE_DIMENSION_CONFIG)
    .filter((config) => config.visibleToUser)
    .map((config) => describeDateDimension(config.key));

module.exports = {
  DATE_DIMENSION_CATEGORY,
  DATE_DIMENSION_CONFIG,
  assertDateDimensionAllowed,
  buildDateDimensionMatch,
  describeDateDimension,
  getDateDimensionConfig,
  listDateDimensions,
  normalizeDateDimension
};
