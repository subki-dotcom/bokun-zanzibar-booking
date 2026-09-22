export const newBookingExpenseForm = (bookingReference = "") => ({
  bookingReference, category: "DIRECT_SUPPLIER_COST", description: "", amount: "",
  currency: "USD", expenseDate: new Date().toISOString().slice(0, 10),
  exchangeRate: "", exchangeRateDate: "", exchangeRateSource: "",
  idempotencyKey: globalThis.crypto.randomUUID()
});

export const bookingExpensePayload = (form, baseCurrency) => {
  const { exchangeRate, exchangeRateDate, exchangeRateSource, ...expense } = form;
  return {
    ...expense, amount: Number(form.amount), baseCurrency,
    ...(form.currency.trim().toUpperCase() !== baseCurrency ? {
      exchangeRate: Number(exchangeRate), exchangeRateDate, exchangeRateSource: exchangeRateSource.trim()
    } : {})
  };
};
