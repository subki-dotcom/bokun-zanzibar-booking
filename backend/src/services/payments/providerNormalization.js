const {
  decimalString,
  decimalToApi,
  normalizeCurrency,
  isPositive
} = require("../../utils/money");

const safeDecimal = (value) => {
  try {
    return decimalString(value, { allowNegative: false, field: "chargedAmount" });
  } catch (error) {
    return null;
  }
};

const normalizeDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizePesapalPayment = (verification = {}) => {
  const raw = verification.raw || verification;
  const providerStatus = String(
    verification.status || raw.payment_status_description || raw.payment_status || ""
  ).trim().toUpperCase();
  const chargedAmount = safeDecimal(verification.amount ?? raw.amount ?? raw.amount_paid);
  const chargedCurrency = normalizeCurrency(verification.currency ?? raw.currency ?? raw.currency_code);

  return {
    provider: "pesapal",
    providerStatus,
    isProviderPaid: Boolean(verification.isPaid || providerStatus === "COMPLETED"),
    paymentMethod: String(verification.paymentMethod || raw.payment_method || "").trim(),
    chargedAmount,
    chargedCurrency,
    settlementAmount: null,
    settlementCurrency: "",
    providerFeeAmount: null,
    providerFeeCurrency: "",
    paidAt: normalizeDate(verification.paidAt || raw.created_date),
    settledAt: null,
    merchantReference: String(verification.merchantReference || raw.merchant_reference || "").trim(),
    providerTransactionId: String(
      verification.providerOrderTrackingId || verification.orderTrackingId || raw.order_tracking_id || ""
    ).trim(),
    confirmationOrCaptureReference: String(
      verification.confirmationCode || raw.confirmation_code || ""
    ).trim(),
    rawResponse: raw,
    hasValidChargedMoney: Boolean(chargedCurrency && chargedAmount && isPositive(chargedAmount))
  };
};

const normalizeDpoPayment = (verification = {}) => {
  const providerStatus = String(verification.transactionStatus || verification.resultCode || "").trim().toUpperCase();
  const chargedAmount = safeDecimal(
    verification.transactionFinalAmount ?? verification.transactionAmount
  );
  const chargedCurrency = normalizeCurrency(
    verification.transactionFinalCurrency || verification.transactionCurrency
  );
  const settlementAmount = safeDecimal(verification.transactionNetAmount);

  return {
    provider: "dpo",
    providerStatus,
    isProviderPaid: Boolean(verification.isPaid),
    paymentMethod: String(verification.paymentMethod || verification.paymentType || "").trim(),
    chargedAmount,
    chargedCurrency,
    settlementAmount,
    settlementCurrency: normalizeCurrency(verification.settlementCurrency),
    providerFeeAmount: null,
    providerFeeCurrency: "",
    paidAt: normalizeDate(verification.transactionDate),
    settledAt: normalizeDate(verification.transactionSettlementDate),
    merchantReference: String(verification.transactionRef || "").trim(),
    providerTransactionId: String(verification.transactionToken || "").trim(),
    confirmationOrCaptureReference: String(verification.transactionRef || verification.transactionToken || "").trim(),
    rawResponse: verification,
    hasValidChargedMoney: Boolean(chargedCurrency && chargedAmount && isPositive(chargedAmount))
  };
};

const normalizePaypalPayment = (verification = {}) => {
  const raw = verification.raw || verification;
  const capture = raw?.purchase_units?.[0]?.payments?.captures?.[0] || {};
  const breakdown = capture?.seller_receivable_breakdown || {};
  const chargedAmount = safeDecimal(verification.amount ?? capture?.amount?.value);
  const chargedCurrency = normalizeCurrency(verification.currency || capture?.amount?.currency_code);
  const netAmount = safeDecimal(breakdown?.net_amount?.value);
  const feeAmount = safeDecimal(breakdown?.paypal_fee?.value);
  const receivableAmount = breakdown?.receivable_amount || null;

  return {
    provider: "paypal",
    providerStatus: String(verification.status || capture.status || "").trim().toUpperCase(),
    isProviderPaid: Boolean(verification.isPaid),
    paymentMethod: "PayPal",
    chargedAmount,
    chargedCurrency,
    settlementAmount: safeDecimal(receivableAmount?.value) || netAmount,
    settlementCurrency: normalizeCurrency(receivableAmount?.currency_code || breakdown?.net_amount?.currency_code),
    providerFeeAmount: feeAmount,
    providerFeeCurrency: normalizeCurrency(breakdown?.paypal_fee?.currency_code),
    paidAt: normalizeDate(capture.create_time || raw.update_time),
    settledAt: null,
    merchantReference: String(
      raw?.purchase_units?.[0]?.custom_id || raw?.purchase_units?.[0]?.reference_id || ""
    ).trim(),
    providerTransactionId: String(verification.captureId || capture.id || "").trim(),
    confirmationOrCaptureReference: String(verification.captureId || capture.id || "").trim(),
    paypalOrderId: String(verification.orderId || raw.id || "").trim(),
    rawResponse: raw,
    reportedExchangeRate: decimalToApi(breakdown?.exchange_rate?.value),
    hasValidChargedMoney: Boolean(chargedCurrency && chargedAmount && isPositive(chargedAmount))
  };
};

module.exports = {
  normalizeDpoPayment,
  normalizePaypalPayment,
  normalizePesapalPayment,
  __testables: { safeDecimal }
};
