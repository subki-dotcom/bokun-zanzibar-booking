const bokunClient = require("./bokunClient");
const mapper = require("./bokunMapper");
const { env } = require("../../config/env");
const logger = require("../../config/logger");
const AppError = require("../../utils/AppError");

const ensureArray = (value) => (Array.isArray(value) ? value : []);
const BOKUN_CACHE_TTL_MS = 2 * 60 * 1000;
const STARTING_PREVIEW_TIMEOUT_MS = 8000;
const STARTING_PREVIEW_DAYS_WINDOW = 14;

const productDetailsCache = new Map();
const bookingConfigCache = new Map();

const getCacheEntry = (store, key) => {
  const item = store.get(key);
  if (!item) {
    return null;
  }

  if (item.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }

  return item.value;
};

const setCacheEntry = (store, key, value, ttlMs = BOKUN_CACHE_TTL_MS) => {
  store.set(key, {
    value,
    expiresAt: Date.now() + Math.max(1000, Number(ttlMs || BOKUN_CACHE_TTL_MS))
  });
  return value;
};

const withTimeout = async (promise, timeoutMs, fallbackValue = null) => {
  const safeTimeout = Math.max(500, Number(timeoutMs || 0));
  let timeoutHandle = null;

  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timeoutHandle = setTimeout(() => resolve(fallbackValue), safeTimeout);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

const normalizeProductSearchResponse = (response) => {
  if (!response) {
    return [];
  }

  if (Array.isArray(response)) {
    return response;
  }

  const candidateKeys = [
    "activities",
    "products",
    "results",
    "items",
    "content",
    "data",
    "entries"
  ];

  for (const key of candidateKeys) {
    if (Array.isArray(response[key])) {
      return response[key];
    }
  }

  return [];
};

const fetchProducts = async (requestId) => {
  const path = `/activity.json/search?lang=EN&currency=${encodeURIComponent(env.DEFAULT_CURRENCY)}`;
  const response = await bokunClient.request({
    method: "post",
    path,
    payload: {
      page: 1,
      pageSize: 200
    },
    requestId
  });

  const products = normalizeProductSearchResponse(response).map((row) => mapper.mapProduct(row));

  return products.filter((row) => row.bokunProductId);
};

const fetchProductDetails = async (productId, requestId, options = {}) => {
  const safeProductId = String(productId || "").trim();
  if (!safeProductId) {
    return null;
  }

  const forceRefresh = Boolean(options?.forceRefresh);
  const cacheKey = `product:${safeProductId}`;
  if (!forceRefresh) {
    const cached = getCacheEntry(productDetailsCache, cacheKey);
    if (cached) {
      return cached;
    }
  }

  const response = await bokunClient.request({
    method: "get",
    path: `/activity.json/${safeProductId}?lang=EN&currency=${encodeURIComponent(env.DEFAULT_CURRENCY)}`,
    requestId
  });

  const mapped = response ? mapper.mapProduct(response) : null;
  if (mapped?.bokunProductId) {
    setCacheEntry(productDetailsCache, cacheKey, mapped);
  }

  return mapped;
};

const resolveCatalogId = (catalog = {}) =>
  String(catalog?.id || catalog?.catalogId || catalog?.activityPriceCatalogId || "").trim();

const resolveSelectedRateOption = (rateOptions = [], requestedRateId = "") => {
  const token = String(requestedRateId || "").trim();
  if (token) {
    const explicit = rateOptions.find((option) => String(option.id || "") === token);
    if (explicit) {
      return explicit;
    }
  }

  return rateOptions.find((option) => option.isDefault) || rateOptions[0] || null;
};

const toIsoDate = (value) => {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
  }

  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
};

const addIsoDays = (isoDate, days = 0) => {
  const base = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) {
    return isoDate;
  }

  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return toIsoDate(base);
};

const fetchProductPriceList = async ({
  productId = "",
  rateId = "",
  startDate = "",
  endDate = ""
} = {}, requestId) => {
  const safeProductId = String(productId || "").trim();
  if (!safeProductId) {
    return null;
  }

  const from = toIsoDate(startDate || new Date());
  const to = toIsoDate(endDate || addIsoDays(from, STARTING_PREVIEW_DAYS_WINDOW));
  const queryParams = new URLSearchParams({
    start: from,
    end: to,
    currency: env.DEFAULT_CURRENCY
  });

  const selectedRateId = String(rateId || "").trim();
  if (selectedRateId) {
    queryParams.set("activityPriceCatalogId", selectedRateId);
  }

  try {
    return await bokunClient.request({
      method: "get",
      path: `/activity.json/${encodeURIComponent(safeProductId)}/price-list?${queryParams.toString()}`,
      requestId
    });
  } catch (error) {
    logger.warn("Booking config price list unavailable", {
      requestId,
      productId: safeProductId,
      rateId: selectedRateId,
      error: error.message
    });
    return null;
  }
};

const ensurePricingCategories = (categories = []) => {
  const normalized = ensureArray(categories)
    .map((category = {}) => ({
      id: String(category.id || category.categoryId || "").trim(),
      label: String(category.label || category.title || "Category").trim() || "Category",
      min: Math.max(0, Number(category.min ?? category.minQuantity ?? 0)),
      max: Math.max(0, Number(category.max ?? category.maxQuantity ?? 50)),
      defaultQuantity: Math.max(0, Number(category.defaultQuantity ?? 0)),
      ticketCategory: String(category.ticketCategory || "").trim()
    }))
    .filter((category) => Boolean(category.id));

  if (normalized.length) {
    return normalized.map((category) => ({
      ...category,
      max: Math.max(category.min, category.max)
    }));
  }

  return [
    {
      id: "adult",
      label: "Adult",
      min: 1,
      max: 20,
      defaultQuantity: 1,
      ticketCategory: "ADULT"
    }
  ];
};

const slugifyCategoryId = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const mapRawProductPricingCategories = (rawProduct = {}) =>
  ensureArray(rawProduct?.pricingCategories)
    .map((category = {}) => {
      const rawId = String(category?.id || category?.pricingCategoryId || "").trim();
      const label = String(category?.title || category?.name || "").trim();
      const ticketCategory = String(category?.ticketCategory || "").trim();
      const token = `${ticketCategory} ${label}`.toLowerCase();
      const id = rawId || slugifyCategoryId(label || ticketCategory);

      if (!id) {
        return null;
      }

      return {
        id,
        label: label || ticketCategory || `Category ${id}`,
        min: 0,
        max: 50,
        defaultQuantity: token.includes("adult") ? 1 : 0,
        ticketCategory
      };
    })
    .filter(Boolean);

const buildDefaultPassengerStateFromCategories = (categories = []) =>
  ensurePricingCategories(categories).map((category) => ({
    pricingCategoryId: category.id,
    quantity: Math.max(category.min, category.defaultQuantity)
  }));

const mapPassengerMixToPax = (passengers = [], categories = []) => {
  const categoryById = new Map(
    ensurePricingCategories(categories).map((category) => [String(category.id), category])
  );
  const inputRows = ensureArray(passengers)
    .map((row = {}) => ({
      pricingCategoryId: String(row.pricingCategoryId || row.categoryId || "").trim(),
      quantity: Math.max(0, Number(row.quantity || 0))
    }))
    .filter((row) => row.pricingCategoryId);

  const effectiveRows = inputRows.length ? inputRows : buildDefaultPassengerStateFromCategories(categories);
  const safeRows = effectiveRows
    .map((row) => {
      const category = categoryById.get(String(row.pricingCategoryId));
      const minQuantity = Math.max(0, Number(category?.min ?? 0));
      const maxQuantity = Math.max(minQuantity, Number(category?.max ?? 50));

      return {
        pricingCategoryId: String(row.pricingCategoryId),
        quantity: Math.min(maxQuantity, Math.max(minQuantity, Number(row.quantity || 0)))
      };
    })
    .filter((row) => row.quantity > 0);

  const summary = {
    adults: 0,
    children: 0,
    infants: 0
  };

  safeRows.forEach((row) => {
    const category = categoryById.get(String(row.pricingCategoryId)) || {};
    const token = `${category.ticketCategory || ""} ${category.label || ""}`.toLowerCase();

    if (token.includes("adult")) {
      summary.adults += row.quantity;
      return;
    }

    if (token.includes("child")) {
      summary.children += row.quantity;
      return;
    }

    if (token.includes("infant") || token.includes("baby")) {
      summary.infants += row.quantity;
      return;
    }

    summary.adults += row.quantity;
  });

  const total = summary.adults + summary.children + summary.infants;
  if (total <= 0) {
    summary.adults = 1;
  }

  return {
    passengers: safeRows.length ? safeRows : [{ pricingCategoryId: ensurePricingCategories(categories)[0]?.id || "adult", quantity: 1 }],
    pax: summary
  };
};

const normalizeAvailabilityStatus = (value = "") => {
  const token = String(value || "").toUpperCase();
  if (token === "AVAILABLE" || token === "LIMITED") {
    return token;
  }

  if (token === "INSUFFICIENT_CAPACITY") {
    return "LIMITED";
  }

  return "NOT_AVAILABLE";
};

const toPriceNumber = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (typeof value === "object") {
    if (value.amount !== undefined) {
      return toPriceNumber(value.amount);
    }

    if (value.value !== undefined) {
      return toPriceNumber(value.value);
    }
  }

  return null;
};

const deriveTwoAdultStartingPrice = (mappedProduct = {}, selectedRateOption = null) => {
  const rawProduct = mappedProduct?.rawBokunProduct || {};
  const selectedRateId = String(selectedRateOption?.id || "");
  const selectedPricingType = String(selectedRateOption?.pricingType || "").toLowerCase();
  const isPerGroup = selectedPricingType.includes("group");
  const defaultPricedPerPerson = rawProduct?.ticketPerPerson !== false;

  const normalizeRatePrice = (amount, pricedPerPerson = true) => {
    const numeric = toPriceNumber(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return null;
    }

    return pricedPerPerson ? numeric * 2 : numeric;
  };

  const rateCandidates = ensureArray(rawProduct?.rates).filter((rate = {}) => {
    if (!selectedRateId) {
      return true;
    }
    return String(rate?.id || "") === selectedRateId;
  });

  const derivedFromRates = rateCandidates
    .map((rate = {}) =>
      normalizeRatePrice(
        rate?.nextDefaultPriceMoney ?? rate?.nextDefaultPrice ?? rate?.defaultPrice,
        rate?.pricedPerPerson !== false
      )
    )
    .filter((value) => Number.isFinite(value) && value > 0);

  if (derivedFromRates.length > 0) {
    return Math.min(...derivedFromRates);
  }

  const topLevelRate = normalizeRatePrice(
    rawProduct?.nextDefaultPriceMoney ?? rawProduct?.nextDefaultPrice,
    defaultPricedPerPerson && !isPerGroup
  );
  if (Number.isFinite(topLevelRate) && topLevelRate > 0) {
    return topLevelRate;
  }

  const mappedFallback = toPriceNumber(mappedProduct?.fromPrice);
  if (Number.isFinite(mappedFallback) && mappedFallback > 0) {
    return !defaultPricedPerPerson || isPerGroup ? mappedFallback : mappedFallback * 2;
  }

  return 0;
};

const fetchProductBookingConfig = async (productId, options = {}, requestId) => {
  const safeProductId = String(productId || "").trim();
  const requestedRateId = String(options?.rateId || "").trim();
  const includeStartingPreview = options?.includeStartingPreview !== false;

  const cacheKey = `booking-config:${safeProductId}:${requestedRateId || "default"}:${includeStartingPreview ? "with-preview" : "no-preview"}`;
  const cachedConfig = getCacheEntry(bookingConfigCache, cacheKey);
  if (cachedConfig) {
    return cachedConfig;
  }

  const mappedProduct = options?.prefetchedProduct || (await fetchProductDetails(safeProductId, requestId));
  if (!mappedProduct?.bokunProductId) {
    throw new AppError("Bokun product not found", 404, "BOKUN_PRODUCT_NOT_FOUND");
  }

  const rateOptions = mapper.mapBokunRatesToPriceCatalogOptions({
    priceCatalogs: mappedProduct.priceCatalogs || [],
    rawProduct: mappedProduct.rawBokunProduct || {},
    currency: mappedProduct.currency || env.DEFAULT_CURRENCY
  });
  const selectedRateOption = resolveSelectedRateOption(rateOptions, options?.rateId || "");
  const selectedRateId = String(selectedRateOption?.id || "");

  const optionIds = ensureArray(mappedProduct.options)
    .filter((option) => option?.active !== false)
    .map((option) => String(option?.bokunOptionId || ""))
    .filter(Boolean);

  const [priceList, startingPreview] = await Promise.all([
    fetchProductPriceList(
      {
        productId: mappedProduct.bokunProductId,
        rateId: selectedRateId
      },
      requestId
    ),
    includeStartingPreview
      ? withTimeout(
          fetchStartingPricePreview(
            {
              productId: mappedProduct.bokunProductId,
              optionIds,
              comparedAdults: 2,
              pax: { adults: 2, children: 0, infants: 0 },
              priceCatalogId: selectedRateId || "",
              daysWindow: STARTING_PREVIEW_DAYS_WINDOW
            },
            requestId
          ).catch((error) => {
            logger.warn("Starting price preview failed in booking config", {
              requestId,
              productId: mappedProduct.bokunProductId,
              error: error.message
            });
            return null;
          }),
          STARTING_PREVIEW_TIMEOUT_MS,
          null
        )
      : Promise.resolve(null)
  ]);

  const mappedPriceListCategories = mapper.mapBokunPricingCategories(priceList, selectedRateId);
  const mappedRawCategories = mapRawProductPricingCategories(mappedProduct.rawBokunProduct || {});
  const pricingCategories = ensurePricingCategories(
    mappedPriceListCategories.length ? mappedPriceListCategories : mappedRawCategories
  );
  const fallbackStartingPrice = deriveTwoAdultStartingPrice(mappedProduct, selectedRateOption);
  const startingFromPrice = Number(
    startingPreview?.lowestPriceForTwo?.amount ||
      fallbackStartingPrice ||
      0
  );

  const response = {
    productId: mappedProduct.bokunProductId,
    productTitle: mappedProduct.title || "",
    currency: mappedProduct.currency || env.DEFAULT_CURRENCY,
    defaultRateId: selectedRateId,
    startingFromPrice,
    rateOptions,
    defaultPricingCategories: pricingCategories,
    pricingCategories
  };

  return setCacheEntry(bookingConfigCache, cacheKey, response);
};

const fetchProductLiveQuote = async (productId, payload = {}, requestId) => {
  const date = String(payload?.date || "").trim();
  if (!date) {
    throw new AppError("date is required for live quote", 400, "DATE_REQUIRED");
  }

  const mappedProduct = await fetchProductDetails(productId, requestId);
  if (!mappedProduct?.bokunProductId) {
    throw new AppError("Bokun product not found", 404, "BOKUN_PRODUCT_NOT_FOUND");
  }

  const bookingConfig = await fetchProductBookingConfig(
    mappedProduct.bokunProductId,
    {
      rateId: payload?.rateId || payload?.priceCatalogId || "",
      includeStartingPreview: false,
      prefetchedProduct: mappedProduct
    },
    requestId
  );
  const selectedRateId = bookingConfig.defaultRateId || "";
  const optionIds = ensureArray(mappedProduct?.options)
    .filter((option) => option?.active !== false)
    .map((option) => String(option?.bokunOptionId || ""))
    .filter(Boolean);

  const passengerMix = mapPassengerMixToPax(
    payload?.passengers,
    bookingConfig.pricingCategories
  );
  const comparedAdults = Math.max(1, Number(passengerMix.pax.adults || 1));

  const matrix = await fetchOptionAvailabilityMatrix(
    {
      productId: bookingConfig.productId,
      travelDate: date,
      optionIds,
      pax: passengerMix.pax,
      comparedAdults,
      priceCatalogId: selectedRateId
    },
    requestId
  );

  const availableOptions = ensureArray(matrix?.options).filter((option) => option?.available);
  if (!availableOptions.length) {
    return {
      currency: payload?.currency || bookingConfig.currency || env.DEFAULT_CURRENCY,
      startingPrice: Number(matrix?.lowestPriceForTwo?.amount || bookingConfig.startingFromPrice || 0),
      totalPrice: 0,
      availabilityStatus: "NOT_AVAILABLE",
      remainingCapacity: 0,
      pricingBreakdown: [],
      selectedOptionId: null
    };
  }

  const selectedOption =
    availableOptions
      .filter((option) => Number(option?.lowestPriceForTwo || 0) > 0)
      .sort((a, b) => Number(a.lowestPriceForTwo) - Number(b.lowestPriceForTwo))[0] ||
    availableOptions[0];

  const quoteAvailability = await fetchAvailability(
    {
      productId: bookingConfig.productId,
      optionId: String(selectedOption?.optionId || ""),
      travelDate: date,
      pax: passengerMix.pax,
      priceCategoryParticipants: passengerMix.passengers,
      priceCatalogId: selectedRateId
    },
    requestId
  );

  return {
    currency:
      payload?.currency ||
      quoteAvailability?.currency ||
      bookingConfig.currency ||
      env.DEFAULT_CURRENCY,
    startingPrice: Number(matrix?.lowestPriceForTwo?.amount || bookingConfig.startingFromPrice || 0),
    totalPrice: Number(quoteAvailability?.pricing?.grossAmount || 0),
    availabilityStatus: normalizeAvailabilityStatus(selectedOption?.status),
    remainingCapacity: Number(selectedOption?.capacityLeft || 0),
    pricingBreakdown: ensureArray(quoteAvailability?.pricing?.lineItems).map((item) => ({
      label: item.label || "Item",
      quantity: Math.max(0, Number(item.quantity || 0)),
      unitPrice: Math.max(0, Number(item.unitPrice || 0)),
      total: Math.max(0, Number(item.total || 0))
    })),
    selectedOptionId: String(selectedOption?.optionId || ""),
    rateId: selectedRateId,
    passengers: passengerMix.passengers
  };
};

const fetchAvailability = async (payload, requestId) => {
  if (bokunClient.shouldMock) {
    const response = await bokunClient.request({
      method: "post",
      path: "/availability",
      payload,
      requestId
    });

    return mapper.mapAvailability(response);
  }

  const productId = String(payload?.productId || "");
  const travelDate = String(payload?.travelDate || "");
  const priceCatalogId = String(payload?.priceCatalogId || "");

  if (!productId) {
    throw new AppError("productId is required for availability request", 400, "PRODUCT_ID_REQUIRED");
  }

  if (!travelDate) {
    throw new AppError("travelDate is required for availability request", 400, "TRAVEL_DATE_REQUIRED");
  }

  const queryParams = new URLSearchParams({
    start: travelDate,
    end: travelDate,
    currency: env.DEFAULT_CURRENCY
  });

  if (priceCatalogId) {
    queryParams.set("activityPriceCatalogId", priceCatalogId);
  }

  const query = queryParams.toString();

  const availabilityPath = `/activity.json/${encodeURIComponent(productId)}/availabilities?${query}`;
  const [rawAvailabilities, priceList, productDetails] = await Promise.all([
    bokunClient.request({
      method: "get",
      path: availabilityPath,
      requestId
    }),
    bokunClient
      .request({
        method: "get",
        path: `/activity.json/${encodeURIComponent(productId)}/price-list?${query}`,
        requestId
      })
      .catch((error) => {
        logger.warn("Price list fallback skipped", {
          requestId,
          productId,
          travelDate,
          error: error.message
        });

        return null;
      }),
    bokunClient
      .request({
        method: "get",
        path: `/activity.json/${encodeURIComponent(productId)}?lang=EN&currency=${encodeURIComponent(
          env.DEFAULT_CURRENCY
        )}`,
        requestId
      })
      .catch((error) => {
        logger.warn("Product details fallback skipped for extras", {
          requestId,
          productId,
          travelDate,
          error: error.message
        });

        return null;
      })
  ]);

  const productDetailsRoot = productDetails
    ? productDetails.activity || productDetails.product || productDetails
    : null;
  const mappedDetails = productDetailsRoot ? mapper.mapProduct(productDetailsRoot) : null;

  return mapper.mapActivityAvailability({
    payload: {
      ...payload,
      bookableExtras: productDetailsRoot?.bookableExtras || [],
      bookablePriceCatalogs: mappedDetails?.priceCatalogs || []
    },
    rawAvailabilities,
    priceList,
    defaultCurrency: env.DEFAULT_CURRENCY
  });
};

const resolveRequestedPaxTotal = (pax = {}) => {
  const adults = Math.max(0, Number(pax?.adults || 0));
  const children = Math.max(0, Number(pax?.children || 0));
  const infants = Math.max(0, Number(pax?.infants || 0));
  const total = adults + children + infants;

  return total > 0 ? total : 1;
};

const formatIsoDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const addDaysIso = (isoDate, days = 0) => {
  const base = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) {
    return isoDate;
  }

  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return formatIsoDate(base);
};

const getSlotAvailabilityState = (slot = {}, requestedPaxTotal = 1) => {
  if (slot.soldOut || slot.unavailable) {
    return {
      available: false,
      status: "sold_out",
      capacityLeft: 0
    };
  }

  if (slot.unlimitedAvailability) {
    return {
      available: true,
      status: "available",
      capacityLeft: Number.MAX_SAFE_INTEGER
    };
  }

  const capacityLeft = Math.max(0, Number(slot.availabilityCount || 0));

  if (capacityLeft >= requestedPaxTotal && capacityLeft > 0) {
    return {
      available: true,
      status: capacityLeft <= 10 ? "limited" : "available",
      capacityLeft
    };
  }

  if (capacityLeft > 0) {
    return {
      available: false,
      status: "insufficient_capacity",
      capacityLeft
    };
  }

  return {
    available: false,
    status: "sold_out",
    capacityLeft: 0
  };
};

const getSlotTime = (slot = {}) => slot.startTime || slot.startTimeLabel || "Flexible";
const getSlotDate = (slot = {}) => {
  const rawDate = slot?.date ?? slot?.localDate ?? slot?.startDate ?? "";

  if (rawDate === null || rawDate === undefined || rawDate === "") {
    return "";
  }

  if (typeof rawDate === "number" && Number.isFinite(rawDate)) {
    const asDate = new Date(rawDate > 9999999999 ? rawDate : rawDate * 1000);
    const isoDate = formatIsoDate(asDate);
    return isoDate || "";
  }

  const rawString = String(rawDate);
  if (/^\d+$/.test(rawString)) {
    const asNumber = Number(rawString);
    if (Number.isFinite(asNumber)) {
      const asDate = new Date(asNumber > 9999999999 ? asNumber : asNumber * 1000);
      const isoDate = formatIsoDate(asDate);
      if (isoDate) {
        return isoDate;
      }
    }
  }

  const parsedDate = new Date(rawString);
  if (!Number.isNaN(parsedDate.getTime())) {
    const isoDate = formatIsoDate(parsedDate);
    if (isoDate) {
      return isoDate;
    }
  }

  return rawString.split("T")[0];
};

const extractOptionRateIds = (slot = {}) => {
  const ids = new Set();

  ensureArray(slot.rates).forEach((rate) => {
    if (rate?.id !== undefined && rate?.id !== null) {
      ids.add(String(rate.id));
    }
  });

  ensureArray(slot.pricesByRate).forEach((rate) => {
    if (rate?.activityRateId !== undefined && rate?.activityRateId !== null) {
      ids.add(String(rate.activityRateId));
    }
  });

  if (slot.defaultRateId !== undefined && slot.defaultRateId !== null) {
    ids.add(String(slot.defaultRateId));
  }

  return Array.from(ids);
};

const toNumber = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (typeof value === "object" && value.amount !== undefined) {
    return toNumber(value.amount);
  }

  return null;
};

const normalizeTierEntry = (entry = {}) => {
  const minRaw = Number(entry.minPassengersRequired ?? entry.minParticipantsRequired ?? 1);
  const maxRaw = Number(entry.maxPassengersRequired ?? entry.maxParticipantsRequired ?? minRaw);
  const amount = toNumber(entry.amount);

  return {
    min: Number.isFinite(minRaw) ? minRaw : 1,
    max: Number.isFinite(maxRaw) ? maxRaw : Number.isFinite(minRaw) ? minRaw : 1,
    amount: Number.isFinite(amount) ? amount : null
  };
};

const selectTierAmount = (tiers = [], participantCount = 1) => {
  const normalized = ensureArray(tiers)
    .map((tier) => normalizeTierEntry(tier))
    .filter((tier) => Number.isFinite(tier.amount) && tier.amount >= 0);

  if (!normalized.length) {
    return null;
  }

  const direct = normalized.find((tier) => participantCount >= tier.min && participantCount <= tier.max);
  if (direct) {
    return direct.amount;
  }

  const sorted = [...normalized].sort((a, b) => a.min - b.min);
  if (participantCount < sorted[0].min) {
    return sorted[0].amount;
  }

  return sorted[sorted.length - 1].amount;
};

const mapRatePassengersByRateId = (priceList = null) => {
  const map = new Map();

  ensureArray(priceList?.pricesByDateRange).forEach((range) => {
    ensureArray(range?.rates).forEach((rate) => {
      const rateId = String(rate?.rateId || "");
      if (!rateId) {
        return;
      }

      map.set(rateId, ensureArray(rate?.passengers));
    });
  });

  return map;
};

const normalizePassengerCategoryRow = (passenger = {}) => {
  const categoryId = String(passenger?.pricingCategoryId || passenger?.categoryId || "").trim();
  if (!categoryId) {
    return null;
  }

  const title = String(passenger?.title || passenger?.ticketCategory || `Category ${categoryId}`).trim();
  const ticketCategory = String(passenger?.ticketCategory || "").trim();
  const minQuantity = Math.max(0, Number(passenger?.minPerBooking || passenger?.minQuantity || 0));
  const maxQuantity = Math.max(minQuantity, Number(passenger?.maxPerBooking || passenger?.maxQuantity || 50));

  return {
    categoryId,
    title: title || `Category ${categoryId}`,
    ticketCategory,
    minQuantity,
    maxQuantity
  };
};

const getCategorySortWeight = (category = {}) => {
  const token = `${category?.ticketCategory || ""} ${category?.title || ""}`.toLowerCase();

  if (token.includes("adult")) return 1;
  if (token.includes("child")) return 2;
  if (token.includes("infant") || token.includes("baby")) return 3;

  return 9;
};

const extractPriceCategoriesFromPriceList = ({ priceList = null, optionIdSet = new Set() } = {}) => {
  const categoriesMap = new Map();

  ensureArray(priceList?.pricesByDateRange).forEach((range) => {
    ensureArray(range?.rates).forEach((rate) => {
      const rateId = String(rate?.rateId || "").trim();
      if (optionIdSet.size > 0 && rateId && !optionIdSet.has(rateId)) {
        return;
      }

      ensureArray(rate?.passengers).forEach((passenger) => {
        const normalized = normalizePassengerCategoryRow(passenger);
        if (!normalized) {
          return;
        }

        if (!categoriesMap.has(normalized.categoryId)) {
          categoriesMap.set(normalized.categoryId, normalized);
          return;
        }

        const current = categoriesMap.get(normalized.categoryId);
        current.minQuantity = Math.min(current.minQuantity, normalized.minQuantity);
        current.maxQuantity = Math.max(current.maxQuantity, normalized.maxQuantity);
      });
    });
  });

  return Array.from(categoriesMap.values()).sort((a, b) => {
    const weightDiff = getCategorySortWeight(a) - getCategorySortWeight(b);
    if (weightDiff !== 0) {
      return weightDiff;
    }

    return String(a.title || "").localeCompare(String(b.title || ""));
  });
};

const isAdultPassengerCategory = (passenger = {}) => {
  const token = `${passenger?.ticketCategory || ""} ${passenger?.title || ""}`.toLowerCase();
  return token.includes("adult");
};

const resolveRatePriceEntry = (slot = {}, optionId = "") => {
  const pricesByRate = ensureArray(slot?.pricesByRate);
  if (!pricesByRate.length) {
    return null;
  }

  const optionToken = String(optionId || "");
  const direct = pricesByRate.find((entry) => String(entry?.activityRateId || "") === optionToken);
  if (direct) {
    return direct;
  }

  const defaultToken = String(slot?.defaultRateId || "");
  const fromDefault = pricesByRate.find((entry) => String(entry?.activityRateId || "") === defaultToken);
  if (fromDefault) {
    return fromDefault;
  }

  return pricesByRate[0];
};

const resolveRateCurrency = (ratePriceEntry = {}, fallbackCurrency = env.DEFAULT_CURRENCY) =>
  ratePriceEntry?.pricePerBooking?.currency ||
  ratePriceEntry?.pricePerBooking?.amount?.currency ||
  ratePriceEntry?.pricePerCategoryUnit?.[0]?.amount?.currency ||
  fallbackCurrency;

const estimateTwoAdultPriceForOption = ({
  slot = {},
  optionId = "",
  comparedAdults = 2,
  ratePassengersByRateId = new Map()
}) => {
  const safeAdults = Math.max(1, Number(comparedAdults || 2));
  const ratePriceEntry = resolveRatePriceEntry(slot, optionId);

  if (!ratePriceEntry) {
    return null;
  }

  const currency = resolveRateCurrency(ratePriceEntry);
  const bookingAmount = toNumber(ratePriceEntry?.pricePerBooking);
  if (Number.isFinite(bookingAmount) && bookingAmount > 0) {
    return {
      amount: bookingAmount,
      currency
    };
  }

  const tiersByCategory = new Map();
  ensureArray(ratePriceEntry?.pricePerCategoryUnit).forEach((unit) => {
    const categoryId = String(unit?.id || unit?.pricingCategoryId || "default");
    if (!tiersByCategory.has(categoryId)) {
      tiersByCategory.set(categoryId, []);
    }
    tiersByCategory.get(categoryId).push(unit);
  });

  if (!tiersByCategory.size) {
    return null;
  }

  const rateId = String(ratePriceEntry?.activityRateId || optionId || "");
  const passengerDefinitions = ratePassengersByRateId.get(rateId) || [];

  let selectedCategoryId = passengerDefinitions
    .filter((passenger) => isAdultPassengerCategory(passenger))
    .map((passenger) => String(passenger?.pricingCategoryId || ""))
    .find(Boolean);

  if (!selectedCategoryId) {
    selectedCategoryId = passengerDefinitions.map((passenger) => String(passenger?.pricingCategoryId || "")).find(Boolean);
  }

  if (!selectedCategoryId) {
    selectedCategoryId = Array.from(tiersByCategory.keys())[0];
  }

  const selectedTierAmount = selectTierAmount(tiersByCategory.get(selectedCategoryId), safeAdults);
  if (Number.isFinite(selectedTierAmount) && selectedTierAmount >= 0) {
    return {
      amount: selectedTierAmount * safeAdults,
      currency
    };
  }

  const fallbackCandidates = Array.from(tiersByCategory.values())
    .map((entries) => selectTierAmount(entries, safeAdults))
    .filter((amount) => Number.isFinite(amount) && amount >= 0);

  if (fallbackCandidates.length) {
    const fallbackPerAdult = Math.min(...fallbackCandidates);
    return {
      amount: fallbackPerAdult * safeAdults,
      currency
    };
  }

  return null;
};

const fetchOptionAvailabilityMatrix = async (payload, requestId) => {
  const comparedAdults = Math.max(1, Number(payload?.comparedAdults || 2));

  if (bokunClient.shouldMock) {
    const availability = await fetchAvailability(payload, requestId);
    const optionIds = ensureArray(payload?.optionIds).map((id) => String(id)).filter(Boolean);
    const mockAmount = Number(availability?.pricing?.grossAmount || availability?.pricing?.baseAmount || 0);

    return {
      travelDate: payload.travelDate,
      available: Boolean(availability.available),
      comparedAdults,
      priceCategories: ensureArray(availability?.priceCategories),
      lowestPriceForTwo: mockAmount > 0
        ? {
            amount: mockAmount,
            currency: availability?.currency || env.DEFAULT_CURRENCY,
            comparedAdults
          }
        : null,
      options: optionIds.map((optionId) => ({
        optionId,
        available: Boolean(availability.available),
        status: availability.available ? "available" : "sold_out",
        slots: availability.slots || [],
        firstAvailableStartTime: availability.slots?.find((slot) => slot.status !== "sold_out")?.time || "",
        capacityLeft: availability.slots?.find((slot) => slot.status !== "sold_out")?.capacityLeft || 0,
        lowestPriceForTwo: mockAmount > 0 ? mockAmount : null,
        currency: availability?.currency || env.DEFAULT_CURRENCY
      }))
    };
  }

  const productId = String(payload?.productId || "");
  const travelDate = String(payload?.travelDate || "");
  const priceCatalogId = String(payload?.priceCatalogId || "");
  const optionIds = ensureArray(payload?.optionIds).map((id) => String(id)).filter(Boolean);
  const optionIdSet = new Set(optionIds);

  if (!productId) {
    throw new AppError("productId is required for availability request", 400, "PRODUCT_ID_REQUIRED");
  }

  if (!travelDate) {
    throw new AppError("travelDate is required for availability request", 400, "TRAVEL_DATE_REQUIRED");
  }

  const queryParams = new URLSearchParams({
    start: travelDate,
    end: travelDate,
    currency: env.DEFAULT_CURRENCY
  });

  if (priceCatalogId) {
    queryParams.set("activityPriceCatalogId", priceCatalogId);
  }

  const query = queryParams.toString();

  const [rawAvailabilities, priceList] = await Promise.all([
    bokunClient.request({
      method: "get",
      path: `/activity.json/${encodeURIComponent(productId)}/availabilities?${query}`,
      requestId
    }),
    bokunClient
      .request({
        method: "get",
        path: `/activity.json/${encodeURIComponent(productId)}/price-list?${query}`,
        requestId
      })
      .catch((error) => {
        logger.warn("Price list skipped for option matrix pricing", {
          requestId,
          productId,
          travelDate,
          error: error.message
        });

        return null;
      })
  ]);
  const ratePassengersByRateId = mapRatePassengersByRateId(priceList);
  const priceCategories = extractPriceCategoriesFromPriceList({ priceList, optionIdSet });

  const requestedPaxTotal = resolveRequestedPaxTotal(payload?.pax);
  const availabilityMap = new Map();
  const initializedOptionIds = optionIds.length ? optionIds : [];

  initializedOptionIds.forEach((optionId) => {
    availabilityMap.set(optionId, {
      optionId,
      available: false,
      status: "sold_out",
      capacityLeft: 0,
      firstAvailableStartTime: "",
      slots: [],
      lowestPriceForTwo: null,
      currency: env.DEFAULT_CURRENCY
    });
  });

  const availableFallbackSlots = [];

  ensureArray(rawAvailabilities).forEach((slot) => {
    const slotState = getSlotAvailabilityState(slot, requestedPaxTotal);
    const slotTime = getSlotTime(slot);
    const rateIds = extractOptionRateIds(slot);

    if (!rateIds.length) {
      if (slotState.available) {
        availableFallbackSlots.push({
          time: slotTime,
          capacityLeft: slotState.capacityLeft,
          status: slotState.status
        });
      }
      return;
    }

    rateIds.forEach((optionId) => {
      if (optionIdSet.size && !optionIdSet.has(optionId)) {
        return;
      }

      if (!availabilityMap.has(optionId)) {
        availabilityMap.set(optionId, {
          optionId,
          available: false,
          status: "sold_out",
          capacityLeft: 0,
          firstAvailableStartTime: "",
          slots: [],
          lowestPriceForTwo: null,
          currency: env.DEFAULT_CURRENCY
        });
      }

      const optionAvailability = availabilityMap.get(optionId);
      const hasTime = optionAvailability.slots.some((item) => item.time === slotTime && item.status === slotState.status);

      if (!hasTime) {
        optionAvailability.slots.push({
          time: slotTime,
          capacityLeft: slotState.capacityLeft,
          status: slotState.status
        });
      }

      if (slotState.available) {
        optionAvailability.available = true;
        optionAvailability.status = slotState.status;
        optionAvailability.capacityLeft = Math.max(optionAvailability.capacityLeft || 0, slotState.capacityLeft || 0);
        if (!optionAvailability.firstAvailableStartTime) {
          optionAvailability.firstAvailableStartTime = slotTime;
        }

        const estimatedPrice = estimateTwoAdultPriceForOption({
          slot,
          optionId,
          comparedAdults,
          ratePassengersByRateId
        });

        if (estimatedPrice && Number(estimatedPrice.amount) > 0) {
          optionAvailability.currency = estimatedPrice.currency || optionAvailability.currency || env.DEFAULT_CURRENCY;
          if (
            optionAvailability.lowestPriceForTwo === null ||
            Number(estimatedPrice.amount) < Number(optionAvailability.lowestPriceForTwo)
          ) {
            optionAvailability.lowestPriceForTwo = Number(estimatedPrice.amount);
          }
        }
      } else if (!optionAvailability.available && slotState.status === "insufficient_capacity") {
        optionAvailability.status = "insufficient_capacity";
        optionAvailability.capacityLeft = Math.max(optionAvailability.capacityLeft || 0, slotState.capacityLeft || 0);
      }
    });
  });

  if (availableFallbackSlots.length) {
    const fallbackOptionIds = optionIds.filter((optionId) => !availabilityMap.has(optionId) || !/^\d+$/.test(optionId));

    fallbackOptionIds.forEach((optionId) => {
      availabilityMap.set(optionId, {
        optionId,
        available: true,
        status: "available",
        capacityLeft: Math.max(...availableFallbackSlots.map((slot) => Number(slot.capacityLeft || 0))),
        firstAvailableStartTime: availableFallbackSlots[0]?.time || "",
        slots: availableFallbackSlots,
        lowestPriceForTwo: null,
        currency: env.DEFAULT_CURRENCY
      });
    });
  }

  const options = Array.from(availabilityMap.values());
  const pricedCandidates = options
    .filter((option) => option.available && Number(option.lowestPriceForTwo || 0) > 0)
    .sort((a, b) => Number(a.lowestPriceForTwo) - Number(b.lowestPriceForTwo));

  const lowestPriceForTwo = pricedCandidates.length
    ? {
        optionId: pricedCandidates[0].optionId,
        amount: Number(pricedCandidates[0].lowestPriceForTwo),
        currency: pricedCandidates[0].currency || env.DEFAULT_CURRENCY,
        comparedAdults
      }
    : null;

  return {
    travelDate,
    available: options.some((option) => option.available),
    comparedAdults,
    priceCategories,
    lowestPriceForTwo,
    options
  };
};

const buildMatrixOptionRow = (optionId = "") => ({
  optionId: String(optionId || ""),
  available: false,
  status: "sold_out",
  capacityLeft: 0,
  firstAvailableStartTime: "",
  firstAvailableTravelDate: "",
  cheapestTravelDate: "",
  cheapestStartTime: "",
  slots: [],
  lowestPriceForTwo: null,
  currency: env.DEFAULT_CURRENCY
});

const fetchStartingPricePreview = async (payload, requestId) => {
  if (bokunClient.shouldMock) {
    const fallbackDate = formatIsoDate(new Date());
    const availability = await fetchAvailability(
      {
        ...payload,
        travelDate: payload?.travelDate || fallbackDate
      },
      requestId
    );
    const optionIds = ensureArray(payload?.optionIds).map((id) => String(id)).filter(Boolean);
    const amount = Number(availability?.pricing?.grossAmount || availability?.pricing?.baseAmount || 0);

    return {
      travelDate: payload?.travelDate || fallbackDate,
      available: Boolean(availability.available),
      comparedAdults: Math.max(1, Number(payload?.comparedAdults || 2)),
      priceCategories: ensureArray(availability?.priceCategories),
      lowestPriceForTwo:
        amount > 0
          ? {
              optionId: optionIds[0] || "",
              amount,
              currency: availability?.currency || env.DEFAULT_CURRENCY,
              comparedAdults: Math.max(1, Number(payload?.comparedAdults || 2)),
              travelDate: payload?.travelDate || fallbackDate,
              startTime: availability?.slots?.[0]?.time || ""
            }
          : null,
      options: optionIds.map((optionId) => ({
        ...buildMatrixOptionRow(optionId),
        available: Boolean(availability.available),
        status: availability.available ? "available" : "sold_out",
        slots: availability.slots || [],
        firstAvailableStartTime: availability?.slots?.[0]?.time || "",
        firstAvailableTravelDate: payload?.travelDate || fallbackDate,
        cheapestTravelDate: payload?.travelDate || fallbackDate,
        cheapestStartTime: availability?.slots?.[0]?.time || "",
        lowestPriceForTwo: amount > 0 ? amount : null,
        currency: availability?.currency || env.DEFAULT_CURRENCY
      }))
    };
  }

  const productId = String(payload?.productId || "");
  const optionIds = ensureArray(payload?.optionIds).map((id) => String(id)).filter(Boolean);
  const optionIdSet = new Set(optionIds);
  const comparedAdults = Math.max(1, Number(payload?.comparedAdults || 2));
  const daysWindow = Math.max(1, Math.min(90, Number(payload?.daysWindow || 30)));
  const startDate = String(payload?.startDate || formatIsoDate(new Date()));
  const endDate = String(payload?.endDate || addDaysIso(startDate, daysWindow - 1));
  const priceCatalogId = String(payload?.priceCatalogId || "");

  if (!productId) {
    throw new AppError("productId is required for starting price preview", 400, "PRODUCT_ID_REQUIRED");
  }

  const queryParams = new URLSearchParams({
    start: startDate,
    end: endDate,
    currency: env.DEFAULT_CURRENCY
  });

  if (priceCatalogId) {
    queryParams.set("activityPriceCatalogId", priceCatalogId);
  }

  const query = queryParams.toString();

  const [rawAvailabilities, priceList] = await Promise.all([
    bokunClient.request({
      method: "get",
      path: `/activity.json/${encodeURIComponent(productId)}/availabilities?${query}`,
      requestId
    }),
    bokunClient
      .request({
        method: "get",
        path: `/activity.json/${encodeURIComponent(productId)}/price-list?${query}`,
        requestId
      })
      .catch((error) => {
        logger.warn("Price list skipped for starting price preview", {
          requestId,
          productId,
          startDate,
          endDate,
          error: error.message
        });

        return null;
      })
  ]);

  const ratePassengersByRateId = mapRatePassengersByRateId(priceList);
  const priceCategories = extractPriceCategoriesFromPriceList({ priceList, optionIdSet });
  const requestedPaxTotal = resolveRequestedPaxTotal(payload?.pax || { adults: comparedAdults, children: 0, infants: 0 });
  const availabilityMap = new Map();

  optionIds.forEach((optionId) => {
    availabilityMap.set(optionId, buildMatrixOptionRow(optionId));
  });

  ensureArray(rawAvailabilities).forEach((slot) => {
    const slotState = getSlotAvailabilityState(slot, requestedPaxTotal);
    const slotTime = getSlotTime(slot);
    const slotDate = getSlotDate(slot);
    const rateIds = extractOptionRateIds(slot);

    if (!rateIds.length) {
      return;
    }

    rateIds.forEach((optionId) => {
      if (optionIdSet.size && !optionIdSet.has(optionId)) {
        return;
      }

      if (!availabilityMap.has(optionId)) {
        availabilityMap.set(optionId, buildMatrixOptionRow(optionId));
      }

      const row = availabilityMap.get(optionId);
      const hasSameSlot = row.slots.some(
        (entry) => entry.time === slotTime && entry.status === slotState.status && entry.date === slotDate
      );

      if (!hasSameSlot) {
        row.slots.push({
          time: slotTime,
          date: slotDate,
          capacityLeft: slotState.capacityLeft,
          status: slotState.status
        });
      }

      if (slotState.available) {
        row.available = true;
        row.status = slotState.status;
        row.capacityLeft = Math.max(row.capacityLeft || 0, slotState.capacityLeft || 0);

        if (!row.firstAvailableTravelDate || (slotDate && slotDate < row.firstAvailableTravelDate)) {
          row.firstAvailableTravelDate = slotDate;
          row.firstAvailableStartTime = slotTime;
        }

        const estimatedPrice = estimateTwoAdultPriceForOption({
          slot,
          optionId,
          comparedAdults,
          ratePassengersByRateId
        });

        if (estimatedPrice && Number(estimatedPrice.amount) > 0) {
          row.currency = estimatedPrice.currency || row.currency || env.DEFAULT_CURRENCY;
          const nextAmount = Number(estimatedPrice.amount);
          const currentAmount =
            row.lowestPriceForTwo === null || row.lowestPriceForTwo === undefined
              ? null
              : Number(row.lowestPriceForTwo);

          const isBetterAmount = currentAmount === null || nextAmount < currentAmount;
          const isSameAmountEarlierDate =
            currentAmount !== null &&
            nextAmount === currentAmount &&
            slotDate &&
            row.cheapestTravelDate &&
            slotDate < row.cheapestTravelDate;

          if (isBetterAmount || isSameAmountEarlierDate || !row.cheapestTravelDate) {
            row.lowestPriceForTwo = nextAmount;
            row.cheapestTravelDate = slotDate;
            row.cheapestStartTime = slotTime;
          }
        }
      } else if (!row.available && slotState.status === "insufficient_capacity") {
        row.status = "insufficient_capacity";
        row.capacityLeft = Math.max(row.capacityLeft || 0, slotState.capacityLeft || 0);
      }
    });
  });

  const options = Array.from(availabilityMap.values());
  const pricedCandidates = options
    .filter((option) => option.available && Number(option.lowestPriceForTwo || 0) > 0)
    .sort((a, b) => {
      const amountDiff = Number(a.lowestPriceForTwo) - Number(b.lowestPriceForTwo);
      if (amountDiff !== 0) {
        return amountDiff;
      }

      const aDate = String(a.cheapestTravelDate || "9999-12-31");
      const bDate = String(b.cheapestTravelDate || "9999-12-31");
      return aDate.localeCompare(bDate);
    });

  const lowestPriceForTwo = pricedCandidates.length
    ? {
        optionId: pricedCandidates[0].optionId,
        amount: Number(pricedCandidates[0].lowestPriceForTwo),
        currency: pricedCandidates[0].currency || env.DEFAULT_CURRENCY,
        comparedAdults,
        travelDate: pricedCandidates[0].cheapestTravelDate || pricedCandidates[0].firstAvailableTravelDate || "",
        startTime: pricedCandidates[0].cheapestStartTime || pricedCandidates[0].firstAvailableStartTime || ""
      }
    : null;

  const previewTravelDate =
    lowestPriceForTwo?.travelDate ||
    options.find((option) => option.firstAvailableTravelDate)?.firstAvailableTravelDate ||
    startDate;

  return {
    travelDate: previewTravelDate,
    available: options.some((option) => option.available),
    comparedAdults,
    priceCategories,
    lowestPriceForTwo,
    options
  };
};

const fetchBookingQuestions = async (payload, requestId) => {
  if (bokunClient.shouldMock) {
    const response = await bokunClient.request({
      method: "post",
      path: "/booking-questions",
      payload,
      requestId
    });

    return (response || []).map(mapper.mapBookingQuestion);
  }

  const productId = String(payload?.productId || "");

  if (!productId) {
    throw new AppError("productId is required for booking questions", 400, "PRODUCT_ID_REQUIRED");
  }

  try {
    const response = await bokunClient.request({
      method: "post",
      path: "/booking-questions",
      payload,
      requestId
    });

    return (response || []).map(mapper.mapBookingQuestion);
  } catch (error) {
    logger.warn("Falling back to product contact fields for booking questions", {
      requestId,
      productId,
      optionId: payload?.optionId || "",
      error: error.message
    });

    const details = await bokunClient.request({
      method: "get",
      path: `/activity.json/${encodeURIComponent(productId)}?lang=EN&currency=${encodeURIComponent(
        env.DEFAULT_CURRENCY
      )}`,
      requestId
    });

    const contactFieldMap = {
      FIRST_NAME: { id: "firstName", label: "First name", type: "text", required: true },
      LAST_NAME: { id: "lastName", label: "Last name", type: "text", required: true },
      EMAIL: { id: "email", label: "Email", type: "text", required: true },
      PHONE_NUMBER: { id: "phoneNumber", label: "Phone number", type: "text", required: true },
      TITLE: {
        id: "title",
        label: "Title",
        type: "select",
        required: false,
        options: ["Mr", "Mrs", "Ms", "Dr"]
      }
    };

    const fallbackQuestions = (details.mainContactFields || [])
      .map((fieldEntry) => {
        const mapping = contactFieldMap[fieldEntry.field];
        if (!mapping) {
          return null;
        }

        return {
          id: mapping.id,
          label: mapping.label,
          type: mapping.type,
          scope: "booking",
          required: Boolean(fieldEntry.required || mapping.required),
          options: mapping.options || []
        };
      })
      .filter(Boolean);

    return fallbackQuestions;
  }
};

const createBooking = async (payload, requestId) => {
  const response = await bokunClient.request({
    method: "post",
    path: "/bookings",
    payload,
    requestId
  });

  return mapper.mapBookingResponse(response);
};

const lookupBooking = async (reference, requestId) => {
  const response = await bokunClient.request({
    method: "get",
    path: `/bookings/${reference}`,
    requestId
  });

  return mapper.mapBookingResponse(response);
};

const cancelBooking = async (bookingId, payload, requestId) => {
  return bokunClient.request({
    method: "post",
    path: `/bookings/${bookingId}/cancel`,
    payload,
    requestId
  });
};

const editBooking = async (bookingId, payload, requestId) => {
  return bokunClient.request({
    method: "post",
    path: `/bookings/${bookingId}/edit`,
    payload,
    requestId
  });
};

module.exports = {
  fetchProducts,
  fetchProductDetails,
  fetchProductBookingConfig,
  fetchProductLiveQuote,
  fetchAvailability,
  fetchOptionAvailabilityMatrix,
  fetchStartingPricePreview,
  fetchBookingQuestions,
  createBooking,
  lookupBooking,
  cancelBooking,
  editBooking
};
