const AppError = require("../utils/AppError");
const { requireCurrency, decimalString, toDecimal } = require("../utils/money");

const configuredBaseCurrency = () => requireCurrency(process.env.ACCOUNTING_BASE_CURRENCY || process.env.DEFAULT_CURRENCY || "USD");

const resolveFxEvidence = ({ transactionCurrency, baseCurrency, exchangeRate, exchangeRateDate, exchangeRateSource, transactionDate }) => {
  const currency = requireCurrency(transactionCurrency);
  const accountingCurrency = requireCurrency(baseCurrency || configuredBaseCurrency());
  if (currency === accountingCurrency) {
    return { transactionCurrency: currency, baseCurrency: accountingCurrency, exchangeRate: "1", exchangeRateDate: exchangeRateDate || transactionDate || null, exchangeRateSource: String(exchangeRateSource || "IDENTITY").trim().toUpperCase() };
  }
  if (exchangeRate === undefined || exchangeRate === null || exchangeRate === "") {
    throw new AppError("An exchange rate is required for a foreign-currency posting.", 422, "GL_FX_RATE_REQUIRED", { transactionCurrency: currency, baseCurrency: accountingCurrency });
  }
  const rate = decimalString(exchangeRate, { allowNegative: false, field: "exchangeRate" });
  if (!toDecimal(rate).greaterThan(0)) throw new AppError("Exchange rate must be greater than zero.", 422, "GL_FX_RATE_INVALID");
  return {
    transactionCurrency: currency,
    baseCurrency: accountingCurrency,
    exchangeRate: rate,
    exchangeRateDate: exchangeRateDate || transactionDate || null,
    exchangeRateSource: String(exchangeRateSource || "MANUAL").trim().toUpperCase()
  };
};

module.exports = { configuredBaseCurrency, resolveFxEvidence };
