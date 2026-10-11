const supportedKeys = [
  "page",
  "limit",
  "search",
  "fromDate",
  "toDate",
  "channel",
  "paymentStatus",
  "settlementStatus",
  "reconciliationStatus",
  "currency",
  "status",
  "sort",
  "order"
];

export const buildPaymentReconciliationQuery = (params = {}) => {
  const query = new URLSearchParams();
  const values = { limit: 100, ...params };

  supportedKeys.forEach((key) => {
    const value = values[key];
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  });

  const text = query.toString();
  return text ? `?${text}` : "";
};