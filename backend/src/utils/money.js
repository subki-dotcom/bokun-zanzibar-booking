const mongoose = require("mongoose");
const Decimal = require("decimal.js");

Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 40
});

const CURRENCY_ALIASES = Object.freeze({
  KSH: "KES",
  KSHS: "KES"
});

const FALLBACK_ISO_CURRENCIES = new Set([
  "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN",
  "BAM", "BBD", "BDT", "BGN", "BHD", "BIF", "BMD", "BND", "BOB", "BRL",
  "BSD", "BTN", "BWP", "BYN", "BZD", "CAD", "CDF", "CHF", "CLP", "CNY",
  "COP", "CRC", "CUP", "CVE", "CZK", "DJF", "DKK", "DOP", "DZD", "EGP",
  "ERN", "ETB", "EUR", "FJD", "FKP", "GBP", "GEL", "GHS", "GIP", "GMD",
  "GNF", "GTQ", "GYD", "HKD", "HNL", "HTG", "HUF", "IDR", "ILS", "INR",
  "IQD", "IRR", "ISK", "JMD", "JOD", "JPY", "KES", "KGS", "KHR", "KMF",
  "KPW", "KRW", "KWD", "KYD", "KZT", "LAK", "LBP", "LKR", "LRD", "LSL",
  "LYD", "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP", "MRU", "MUR",
  "MVR", "MWK", "MXN", "MYR", "MZN", "NAD", "NGN", "NIO", "NOK", "NPR",
  "NZD", "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG", "QAR",
  "RON", "RSD", "RUB", "RWF", "SAR", "SBD", "SCR", "SDG", "SEK", "SGD",
  "SHP", "SLE", "SOS", "SRD", "SSP", "STN", "SYP", "SZL", "THB", "TJS",
  "TMT", "TND", "TOP", "TRY", "TTD", "TWD", "TZS", "UAH", "UGX", "USD",
  "UYU", "UZS", "VES", "VND", "VUV", "WST", "XAF", "XCD", "XOF", "XPF",
  "YER", "ZAR", "ZMW", "ZWL"
]);

const runtimeCurrencies = (() => {
  try {
    return new Set(Intl.supportedValuesOf("currency"));
  } catch (error) {
    return FALLBACK_ISO_CURRENCIES;
  }
})();

const rawDecimalString = (value) => {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Decimal) return value.toString();
  if (value instanceof mongoose.Types.Decimal128) return value.toString();
  if (typeof value === "object" && typeof value.$numberDecimal === "string") {
    return value.$numberDecimal;
  }
  if (typeof value === "bigint") return value.toString();
  return String(value).trim();
};

const toDecimal = (value, { allowNegative = true, field = "amount" } = {}) => {
  const raw = rawDecimalString(value);
  if (!raw || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw)) {
    const error = new TypeError(`${field} must be a valid decimal value`);
    error.code = "INVALID_DECIMAL";
    throw error;
  }

  const decimal = new Decimal(raw);
  if (!decimal.isFinite() || (!allowNegative && decimal.isNegative())) {
    const error = new TypeError(`${field} must be a valid non-negative decimal value`);
    error.code = "INVALID_DECIMAL";
    throw error;
  }
  return decimal;
};

const decimalString = (value, options = {}) => toDecimal(value, options).toFixed();

const moneyString = (value, decimalPlaces = 2) =>
  toDecimal(value, { allowNegative: false, field: "money" }).toFixed(decimalPlaces);

const toDecimal128 = (value, options = {}) =>
  mongoose.Types.Decimal128.fromString(decimalString(value, options));

const decimalOrNull = (value, options = {}) => {
  if (value === null || value === undefined || value === "") return null;
  return toDecimal128(value, options);
};

const decimalToApi = (value, fallback = null) => {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return decimalString(value);
  } catch (error) {
    return fallback;
  }
};

const normalizeCurrency = (value, { allowDisplayAlias = false } = {}) => {
  const token = String(value || "").trim().toUpperCase();
  const normalized = allowDisplayAlias ? (CURRENCY_ALIASES[token] || token) : token;
  return /^[A-Z]{3}$/.test(normalized) && runtimeCurrencies.has(normalized) ? normalized : "";
};

const requireCurrency = (value, options = {}) => {
  const currency = normalizeCurrency(value, options);
  if (!currency) {
    const error = new TypeError("Currency must be a valid ISO-4217 code");
    error.code = "INVALID_CURRENCY";
    throw error;
  }
  return currency;
};

const isPositive = (value) => {
  try {
    return toDecimal(value).greaterThan(0);
  } catch (error) {
    return false;
  }
};

const equalsWithin = (left, right, tolerance = "0.005") =>
  toDecimal(left).minus(toDecimal(right)).abs().lessThanOrEqualTo(toDecimal(tolerance));

const add = (...values) =>
  values.reduce((total, value) => total.plus(toDecimal(value)), new Decimal(0)).toFixed();

const subtract = (left, right) => toDecimal(left).minus(toDecimal(right)).toFixed();

const multiply = (left, right) => toDecimal(left).times(toDecimal(right)).toFixed();

const divide = (left, right, decimalPlaces = 12) => {
  const divisor = toDecimal(right);
  if (divisor.isZero()) {
    const error = new RangeError("Cannot divide money by zero");
    error.code = "DIVISION_BY_ZERO";
    throw error;
  }
  return toDecimal(left).dividedBy(divisor).toDecimalPlaces(decimalPlaces).toFixed();
};

const compare = (left, right) => toDecimal(left).comparedTo(toDecimal(right));

module.exports = {
  Decimal,
  add,
  compare,
  decimalOrNull,
  decimalString,
  decimalToApi,
  divide,
  equalsWithin,
  isPositive,
  moneyString,
  multiply,
  normalizeCurrency,
  requireCurrency,
  subtract,
  toDecimal,
  toDecimal128
};
