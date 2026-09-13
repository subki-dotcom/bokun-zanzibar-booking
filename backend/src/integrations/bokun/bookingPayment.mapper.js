// Bókun customer payment truth only. This mapper never records local cash or settlement.
// totalPrice/totalPaid/totalDue/paymentType are present in persisted supplier responses.
// Do not derive a refund from cancellation, an invoice balance, or negative totalDue.
const STATUS = Object.freeze({
  PAID_IN_FULL: "PAID", PAID: "PAID", NOT_PAID: "UNPAID", UNPAID: "UNPAID",
  PARTIALLY_PAID: "PARTIALLY_PAID", REFUNDED: "REFUNDED"
});

const number = (value) => {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "object") return number(value.amount);
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^-?\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const token = (value) => typeof value === "string" ? value.trim().toUpperCase().slice(0, 64) : "";
const currencyCode = (value) => /^[A-Z]{3}$/.test(token(value)) ? token(value) : null;
const amount = (rows) => {
  const present = rows.filter(([, value]) => value !== undefined && value !== null && value !== "");
  const values = present.map(([, value]) => number(value));
  return {
    value: values.length ? values[0] : null,
    paths: present.map(([path]) => path),
    invalid: values.some((value) => value === null),
    conflicting: values.some((value) => value !== values[0]),
    currencies: present.map(([, value]) => currencyCode(value?.currency)).filter(Boolean)
  };
};

const mapBokunPaymentStatus = (payload = {}) => {
  const raw = payload?.raw || payload || {};
  const root = raw?.booking || raw;
  const invoice = root.customerInvoice || root.invoice || {};
  const invoicePath = root.customerInvoice ? "customerInvoice" : "invoice";
  const activity = Array.isArray(root.activityBookings) ? root.activityBookings[0] || {} : {};
  const activityInvoice = activity.customerInvoice || activity.invoice || {};
  // Invoice payment totals can describe supplier settlement rather than customer
  // payment. Prefer booking-level fields; invoice totals are fallback only.
  const paid = amount([
    ["totalPaid", root.totalPaid], ["paidAmount", root.paidAmount], ["paidAmountAsMoney", root.paidAmountAsMoney]
  ]);
  const total = amount(root.totalPrice !== undefined || root.total !== undefined ? [
    ["totalPrice", root.totalPrice], ["total", root.total]
  ] : [[`${invoicePath}.totalAsMoney`, invoice.totalAsMoney]]);
  const due = amount([["totalDue", root.totalDue]]);
  const transactionCurrencies = [...new Set([
    currencyCode(invoice.totalAsMoney?.currency), currencyCode(invoice.currency),
    currencyCode(activityInvoice.totalAsMoney?.currency), currencyCode(activityInvoice.currency),
    ...(Array.isArray(root.customerPayments) ? root.customerPayments.flatMap((row) => [
      currencyCode(row.amountAsMoney?.currency), currencyCode(row.currency)
    ]) : [])
  ].filter(Boolean))];
  // root.currency may be the Bókun reseller/seller account currency. When a
  // customer invoice/payment Money object exists, its ISO code is the booking
  // transaction currency and root.currency must not conflict with it.
  const currencies = transactionCurrencies.length
    ? transactionCurrencies
    : [...new Set([currencyCode(root.currency), ...paid.currencies, ...total.currencies].filter(Boolean))];
  const currency = currencies.length === 1 ? currencies[0] : null;
  const rawStatuses = ["paymentStatus", "paymentType"].filter((key) => token(root[key]))
    .map((field) => ({ field, value: token(root[field]) }));
  const explicit = [...new Set(rawStatuses.map(({ value }) => STATUS[value]).filter(Boolean))];
  const evidence = {
    version: 1, rawStatus: rawStatuses, totalAmount: total.value, paidAmount: paid.value,
    dueAmount: due.value, refundedAmount: null,
    fields: [...paid.paths, ...total.paths, ...due.paths],
    reason: "MISSING_PAYMENT_EVIDENCE"
  };
  const result = (status, reason) => ({
    status, source: "BOKUN", reportedPaidAmount: paid.value !== null && paid.value >= 0 ? paid.value : null,
    currency, evidence: { ...evidence, reason }
  });
  if (currencies.length > 1 || [paid, total, due].some((row) => row.invalid || row.conflicting) ||
      (paid.value !== null && paid.value < 0) || (total.value !== null && total.value < 0) || explicit.length > 1) {
    return result("UNKNOWN", "CONFLICTING_OR_INVALID_PAYMENT_EVIDENCE");
  }
  // Explicit REFUNDED is accepted only from a payment field, never booking status.
  // No numeric refund alias is consumed until verified against supplier evidence.
  if (explicit[0] === "REFUNDED") return result("REFUNDED", "EXPLICIT_PAYMENT_STATUS");
  let calculated = null;
  if (paid.value !== null && total.value !== null && total.value > 0) {
    calculated = paid.value === 0 ? "UNPAID" : paid.value >= total.value ? "PAID" : "PARTIALLY_PAID";
  }
  if (explicit[0] && calculated && explicit[0] !== calculated) return result("UNKNOWN", "STATUS_AMOUNT_CONFLICT");
  if (explicit[0]) return result(explicit[0], "EXPLICIT_PAYMENT_STATUS");
  if (rawStatuses.length) return result("UNKNOWN", "UNRECOGNIZED_PAYMENT_STATUS");
  if (calculated) return result(calculated, "BOOKING_PAYMENT_AMOUNTS");
  return result("UNKNOWN", "MISSING_PAYMENT_EVIDENCE");
};

module.exports = { mapBokunPaymentStatus };
