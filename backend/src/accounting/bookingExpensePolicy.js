const { createHash } = require("node:crypto");
const AppError = require("../utils/AppError");
const { configuredBaseCurrency } = require("./currencyPolicy");
const { ACCOUNTING_SCOPE } = require("./constants");
const { normalizeCurrency, toDecimal } = require("../utils/money");

// Separate from business operating expenses; existing records are not reclassified.
const BOOKING_DIRECT_COST_CATEGORIES = Object.freeze([
  "DIRECT_SUPPLIER_COST", "DIRECT_TRANSPORT_COST", "DIRECT_GUIDE_COST",
  "DIRECT_BOAT_COST", "DIRECT_ACTIVITY_COST"
]);

const validateBookingExpenseCategory = (category) => {
  if (!BOOKING_DIRECT_COST_CATEGORIES.includes(category)) {
    throw new AppError("Select a booking direct-cost category.", 422, "BOOKING_EXPENSE_CATEGORY_INVALID");
  }
};

const resolveBookingExpenseFx = (input, expenseDate) => {
  const currency = normalizeCurrency(input.currency);
  const baseCurrency = configuredBaseCurrency();
  if (!currency) throw new AppError("Expense currency must be a valid ISO currency.", 422, "BOOKING_EXPENSE_CURRENCY_INVALID");
  if (input.baseCurrency && normalizeCurrency(input.baseCurrency) !== baseCurrency) {
    throw new AppError(`Booking expenses must use accounting base currency ${baseCurrency}.`, 422, "BOOKING_EXPENSE_BASE_CURRENCY_INVALID");
  }
  if (currency === baseCurrency) {
    return { currency, baseCurrency, exchangeRate: "1", exchangeRateDate: expenseDate, exchangeRateSource: "IDENTITY" };
  }
  const source = String(input.exchangeRateSource || "").trim();
  const date = input.exchangeRateDate ? new Date(input.exchangeRateDate) : null;
  let rate;
  try { rate = toDecimal(input.exchangeRate, { allowNegative: false }); } catch { /* Reject incomplete evidence below. */ }
  if (!rate?.greaterThan(0) || !date || Number.isNaN(date.getTime()) || !source || /^(manual|identity|unknown|default|automatic|n\/a)$/i.test(source)) {
    throw new AppError("Foreign-currency expenses require a positive verified rate, rate date and identifiable rate source (for example, a bank quote reference).", 422, "BOOKING_EXPENSE_FX_EVIDENCE_REQUIRED");
  }
  return { currency, baseCurrency, exchangeRate: rate.toFixed(), exchangeRateDate: date, exchangeRateSource: source };
};

const stableValue = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
};

const bookingExpenseRequestHash = (values, requestedReference = "") => {
  // Generated identity and audit actors are not part of the client's expense intent.
  const intent = { ...values };
  for (const field of ["expenseReference", "idempotencyKey", "createdBy", "approvedBy", "approvedAt"]) delete intent[field];
  return createHash("sha256").update(JSON.stringify(stableValue({ ...intent, requestedReference: String(requestedReference || "").trim() }))).digest("hex");
};

const isCountedBookingExpense = (expense) =>
  expense.accountingScope === ACCOUNTING_SCOPE.BOOKING &&
  ["APPROVED", "PAID"].includes(String(expense.status || "").trim().toUpperCase()) &&
  !["REVERSED", "NEEDS_REVIEW"].includes(String(expense.accountingStatus || "").trim().toUpperCase()) &&
  String(expense.completionStatus || "").trim().toUpperCase() !== "NEEDS_REVIEW";

module.exports = { BOOKING_DIRECT_COST_CATEGORIES, validateBookingExpenseCategory, resolveBookingExpenseFx, bookingExpenseRequestHash, isCountedBookingExpense };
