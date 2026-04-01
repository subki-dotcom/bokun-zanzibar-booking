const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const mapBokunRatesToPriceCatalogOptions = (rateOptions = []) =>
  (rateOptions || [])
    .map((option = {}) => ({
      id: String(option.id || "").trim(),
      label: String(option.label || option.title || "Default").trim() || "Default",
      description: String(option.description || "").trim(),
      pricingType: String(option.pricingType || "per_person").trim() || "per_person",
      currency: String(option.currency || "USD").trim() || "USD",
      isDefault: Boolean(option.isDefault)
    }))
    .filter((option) => option.id);

export const mapBokunPricingCategories = (categories = []) => {
  const normalized = (categories || [])
    .map((category = {}) => ({
      id: String(category.id || category.categoryId || "").trim(),
      label: String(category.label || category.title || "Category").trim() || "Category",
      min: Math.max(0, toNumber(category.min ?? category.minQuantity ?? 0)),
      max: Math.max(0, toNumber(category.max ?? category.maxQuantity ?? 50)),
      defaultQuantity: Math.max(0, toNumber(category.defaultQuantity ?? 0))
    }))
    .filter((category) => category.id)
    .map((category) => ({
      ...category,
      max: Math.max(category.min, category.max)
    }));

  if (normalized.length) {
    return normalized;
  }

  return [
    {
      id: "adult",
      label: "Adult",
      min: 1,
      max: 20,
      defaultQuantity: 1
    }
  ];
};

export const buildDefaultPassengerState = (categories = []) =>
  mapBokunPricingCategories(categories).map((category) => ({
    pricingCategoryId: category.id,
    quantity: Math.max(category.min, category.defaultQuantity)
  }));

export const formatPriceLabel = (amount, currency = "USD", { divideBy = 1, fallback = "Check live pricing" } = {}) => {
  const numeric = Number(amount);
  const divisor = Math.max(1, Number(divideBy || 1));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }

  const value = numeric / divisor;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
};

export const resetQuoteOnSelectionChange = (next = {}) => ({
  quote: null,
  quoteStatus: "idle",
  quoteError: "",
  ...next
});
