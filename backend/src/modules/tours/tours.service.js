const ProductSnapshot = require("../../models/ProductSnapshot");
const SyncLog = require("../../models/SyncLog");
const AppError = require("../../utils/AppError");
const bokunService = require("../../integrations/bokun");
const mongoose = require("mongoose");
const logger = require("../../config/logger");

const LIVE_DETAIL_CONCURRENCY = 3;
const PUBLIC_SNAPSHOT_AUTO_SYNC_COOLDOWN_MS = 2 * 60 * 1000;
let publicSnapshotAutoSyncInFlight = null;
let lastPublicSnapshotAutoSyncAt = 0;

const isFallbackOption = (option = {}, productId = "") => {
  const optionId = String(option.bokunOptionId || "");
  const optionName = String(option.name || "").trim().toLowerCase();

  if (!optionId) {
    return true;
  }

  if (optionId === `${productId}-default`) {
    return true;
  }

  if (optionName === "standard option") {
    return true;
  }

  return false;
};

const hasOnlyFallbackOptions = (tour = {}) => {
  const options = Array.isArray(tour.options) ? tour.options : [];

  if (!options.length) {
    return true;
  }

  return options.every((option) => isFallbackOption(option, tour.bokunProductId));
};

const hasMissingPriceCatalogs = (tour = {}) => {
  const catalogs = Array.isArray(tour.priceCatalogs) ? tour.priceCatalogs : [];
  return catalogs.length === 0;
};

const hasLegacyContentGap = (tour = {}) => {
  const raw = tour.rawBokunProduct || {};
  const itinerary = Array.isArray(tour.itinerary) ? tour.itinerary : [];
  const included = Array.isArray(tour.included) ? tour.included : [];
  const excluded = Array.isArray(tour.excluded) ? tour.excluded : [];
  const importantInformation = Array.isArray(tour.importantInformation) ? tour.importantInformation : [];
  const categories = Array.isArray(tour.categories) ? tour.categories : [];
  const liveTourGuide = tour.liveTourGuide || {};

  const rawIncludedPresent = Boolean(raw.included || (Array.isArray(raw.inclusions) && raw.inclusions.length));
  const rawExcludedPresent = Boolean(raw.excluded || (Array.isArray(raw.exclusions) && raw.exclusions.length));
  const rawKnowBeforePresent = Array.isArray(raw.knowBeforeYouGoItems) && raw.knowBeforeYouGoItems.length > 0;
  const rawItineraryPresent = Boolean(raw.itinerary || (Array.isArray(raw.itineraryItems) && raw.itineraryItems.length));
  const rawOptionItineraryPresent = Array.isArray(raw.options || raw.rates)
    ? (raw.options || raw.rates).some(
        (option) => Boolean(option?.itinerary || (Array.isArray(option?.itineraryItems) && option.itineraryItems.length))
      )
    : false;
  const rawMeetingPresent = Boolean(
    raw.meetingInfo ||
      raw.meetingPoint?.description ||
      (Array.isArray(raw.startPoints) && raw.startPoints.length > 0)
  );
  const rawPickupPresent = Boolean(
    raw.pickupInfo ||
      raw.noPickupMsg ||
      raw.meetingType === "PICK_UP" ||
      (Array.isArray(raw.pickupPlaceGroups) && raw.pickupPlaceGroups.length > 0)
  );
  const rawExperienceTypePresent = Boolean(raw.activityType || raw.experienceType || raw.type);
  const rawDifficultyPresent = Boolean(raw.difficultyLevel || raw.difficulty);
  const rawCategoriesPresent = Boolean(
    raw.productCategory || (Array.isArray(raw.categories) && raw.categories.length > 0)
  );
  const rawGuidePresent = Array.isArray(raw.guidanceTypes) && raw.guidanceTypes.length > 0;

  if (rawIncludedPresent && included.length === 0) {
    return true;
  }

  if (rawExcludedPresent && excluded.length === 0) {
    return true;
  }

  if (rawKnowBeforePresent && importantInformation.length === 0) {
    return true;
  }

  if ((rawItineraryPresent || rawOptionItineraryPresent) && itinerary.length === 0) {
    return true;
  }

  if (rawMeetingPresent && !tour.meetingInfo) {
    return true;
  }

  if (rawPickupPresent && !tour.pickupInfo) {
    return true;
  }

  if (rawExperienceTypePresent && !tour.experienceType) {
    return true;
  }

  if (rawDifficultyPresent && !tour.difficulty) {
    return true;
  }

  if (rawCategoriesPresent && categories.length === 0) {
    return true;
  }

  if (rawGuidePresent && liveTourGuide.supported === undefined && !Array.isArray(liveTourGuide.languages)) {
    return true;
  }

  return false;
};

const mapWithConcurrency = async (items = [], mapper, concurrency = LIVE_DETAIL_CONCURRENCY) => {
  const output = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const current = cursor++;
      output[current] = await mapper(items[current], current);
    }
  });

  await Promise.all(workers);

  return output;
};

const pickLiveSyncFields = (liveProduct = {}) => ({
  title: liveProduct.title,
  description: liveProduct.description,
  shortDescription: liveProduct.shortDescription,
  duration: liveProduct.duration,
  experienceType: liveProduct.experienceType,
  difficulty: liveProduct.difficulty,
  liveTourGuide: liveProduct.liveTourGuide,
  images: liveProduct.images,
  itinerary: liveProduct.itinerary,
  meetingInfo: liveProduct.meetingInfo,
  pickupInfo: liveProduct.pickupInfo,
  included: liveProduct.included,
  excluded: liveProduct.excluded,
  importantInformation: liveProduct.importantInformation,
  highlights: liveProduct.highlights,
  categories: liveProduct.categories,
  destination: liveProduct.destination,
  status: liveProduct.status,
  currency: liveProduct.currency,
  fromPrice: liveProduct.fromPrice,
  rating: liveProduct.rating,
  reviewCount: liveProduct.reviewCount,
  options: liveProduct.options,
  priceCatalogs: liveProduct.priceCatalogs,
  rawBokunProduct: liveProduct.rawBokunProduct,
  lastSyncedAt: new Date()
});

const enrichProductWithLiveOptions = async (product, requestId) => {
  const needsHydration =
    hasOnlyFallbackOptions(product) || hasMissingPriceCatalogs(product) || hasLegacyContentGap(product);

  if (!product?.bokunProductId || !needsHydration) {
    return product;
  }

  try {
    const liveProduct = await bokunService.fetchProductDetails(product.bokunProductId, requestId);

    if (!liveProduct) {
      return product;
    }

    if (hasOnlyFallbackOptions(liveProduct) && hasMissingPriceCatalogs(liveProduct)) {
      return product;
    }

    return {
      ...product,
      ...pickLiveSyncFields(liveProduct)
    };
  } catch (error) {
    logger.warn("Live options hydration skipped", {
      productId: product.bokunProductId,
      requestId,
      error: error.message
    });

    return product;
  }
};

const hydrateTourOptionsIfNeeded = async (tour, requestId) => {
  const needsHydration =
    hasOnlyFallbackOptions(tour) || hasMissingPriceCatalogs(tour) || hasLegacyContentGap(tour);

  if (!tour?.bokunProductId || !needsHydration) {
    return tour;
  }

  const liveProduct = await enrichProductWithLiveOptions(tour, requestId);

  if (hasOnlyFallbackOptions(liveProduct) && hasMissingPriceCatalogs(liveProduct)) {
    return tour;
  }

  await ProductSnapshot.updateOne(
    { bokunProductId: tour.bokunProductId },
    { $set: pickLiveSyncFields(liveProduct) }
  );

  return ProductSnapshot.findOne({ bokunProductId: tour.bokunProductId }).lean();
};

const ensurePublicSnapshotCache = async (requestId = "") => {
  const activeCount = await ProductSnapshot.countDocuments({ status: "active" });
  if (activeCount > 0) {
    return activeCount;
  }

  if (publicSnapshotAutoSyncInFlight) {
    await publicSnapshotAutoSyncInFlight;
    return ProductSnapshot.countDocuments({ status: "active" });
  }

  const now = Date.now();
  if (now - lastPublicSnapshotAutoSyncAt < PUBLIC_SNAPSHOT_AUTO_SYNC_COOLDOWN_MS) {
    return activeCount;
  }

  lastPublicSnapshotAutoSyncAt = now;
  publicSnapshotAutoSyncInFlight = syncProducts(requestId, {
    id: null,
    role: "system_auto_public_snapshot"
  })
    .then((result) => {
      logger.info("Public snapshot auto-sync completed", {
        requestId,
        syncedCount: Number(result?.syncedCount || 0)
      });
      return result;
    })
    .catch((error) => {
      logger.warn("Public snapshot auto-sync failed", {
        requestId,
        error: error.message
      });
      return null;
    })
    .finally(() => {
      publicSnapshotAutoSyncInFlight = null;
    });

  await publicSnapshotAutoSyncInFlight;
  return ProductSnapshot.countDocuments({ status: "active" });
};

const hasMissingListingSignals = (tour = {}) =>
  Number(tour?.fromPrice || 0) <= 0 || Number(tour?.rating || 0) <= 0;

const hydrateMissingListingSignals = async (items = [], requestId = "") => {
  const candidates = (items || [])
    .filter((tour) => tour?.bokunProductId && hasMissingListingSignals(tour))
    .slice(0, 3);

  if (!candidates.length) {
    return items;
  }

  const refreshedByProductId = new Map();
  await mapWithConcurrency(
    candidates,
    async (tour) => {
      try {
        const liveProduct = await bokunService.fetchProductDetails(tour.bokunProductId, requestId);
        if (!liveProduct?.bokunProductId) {
          return;
        }

        const patch = pickLiveSyncFields(liveProduct);
        await ProductSnapshot.updateOne(
          { bokunProductId: tour.bokunProductId },
          { $set: patch }
        );
        refreshedByProductId.set(String(tour.bokunProductId), {
          ...tour,
          ...patch
        });
      } catch (error) {
        logger.warn("Listing signal hydration skipped", {
          productId: tour.bokunProductId,
          requestId,
          error: error.message
        });
      }
    },
    2
  );

  return (items || []).map(
    (tour) => refreshedByProductId.get(String(tour?.bokunProductId || "")) || tour
  );
};

const listTours = async ({ page = 1, limit = 9, requestId = "" } = {}) => {
  await ensurePublicSnapshotCache(requestId);

  const safePage = Math.max(1, Number(page || 1));
  const safeLimit = Math.min(60, Math.max(1, Number(limit || 9)));
  const skip = (safePage - 1) * safeLimit;

  const [items, totalItems] = await Promise.all([
    ProductSnapshot.find({ status: "active" })
      .select("bokunProductId title slug shortDescription duration images fromPrice rating reviewCount currency destination highlights categories lastSyncedAt")
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    ProductSnapshot.countDocuments({ status: "active" })
  ]);
  const hydratedItems = await hydrateMissingListingSignals(items, requestId);

  const totalPages = Math.max(1, Math.ceil(totalItems / safeLimit));

  return {
    items: hydratedItems,
    pagination: {
      page: safePage,
      limit: safeLimit,
      totalItems,
      totalPages,
      hasNextPage: safePage < totalPages,
      hasPrevPage: safePage > 1
    }
  };
};

const listTourCategories = async (requestId = "") => {
  await ensurePublicSnapshotCache(requestId);

  const rows = await ProductSnapshot.find({ status: "active" })
    .select("categories")
    .lean();

  const counter = new Map();

  rows.forEach((row) => {
    const categories = Array.isArray(row?.categories) ? row.categories : [];

    categories.forEach((item) => {
      const label =
        typeof item === "string"
          ? item
          : item?.label || item?.name || item?.title || "";

      const normalized = String(label || "").trim();
      if (!normalized) {
        return;
      }

      counter.set(normalized, Number(counter.get(normalized) || 0) + 1);
    });
  });

  return Array.from(counter.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

const getTourBySlug = async (slug, requestId) => {
  let tour = await ProductSnapshot.findOne({ slug }).lean();

  if (!tour) {
    await ensurePublicSnapshotCache(requestId);
    tour = await ProductSnapshot.findOne({ slug }).lean();
  }

  if (!tour) {
    throw new AppError("Tour not found", 404, "TOUR_NOT_FOUND");
  }

  return hydrateTourOptionsIfNeeded(tour, requestId);
};

const getTourOptions = async (id, requestId) => {
  await ensurePublicSnapshotCache(requestId);

  let tour = null;

  if (mongoose.Types.ObjectId.isValid(id)) {
    tour = await ProductSnapshot.findById(id).lean();
  }

  if (!tour) {
    tour = await ProductSnapshot.findOne({ bokunProductId: id }).lean();
  }

  if (!tour) {
    throw new AppError("Tour not found", 404, "TOUR_NOT_FOUND");
  }

  const hydratedTour = await hydrateTourOptionsIfNeeded(tour, requestId);

  return {
    productId: hydratedTour.bokunProductId,
    title: hydratedTour.title,
    options: hydratedTour.options
  };
};

const syncProducts = async (requestId, actor = {}) => {
  const syncLog = await SyncLog.create({
    operation: "products_sync",
    status: "started",
    details: {
      requestId,
      actor
    }
  });

  try {
    const products = await bokunService.fetchProducts(requestId);
    const productsWithLiveOptions = await mapWithConcurrency(
      products,
      (product) => enrichProductWithLiveOptions(product, requestId)
    );

    const operations = productsWithLiveOptions
      .filter((product) => product.bokunProductId)
      .map((product) => ({
        updateOne: {
          filter: { bokunProductId: product.bokunProductId },
          update: { $set: product },
          upsert: true
        }
      }));

    if (operations.length > 0) {
      await ProductSnapshot.bulkWrite(operations);
    }

    syncLog.status = "success";
    syncLog.syncedCount = operations.length;
    syncLog.completedAt = new Date();
    await syncLog.save();

    return {
      syncedCount: operations.length,
      syncLogId: syncLog._id
    };
  } catch (error) {
    syncLog.status = "failed";
    syncLog.details = {
      ...syncLog.details,
      error: error.message
    };
    syncLog.completedAt = new Date();
    await syncLog.save();

    throw error;
  }
};

const checkOptionsAvailability = async (slug, payload = {}, requestId) => {
  const tour = await ProductSnapshot.findOne({ slug }).lean();

  if (!tour) {
    throw new AppError("Tour not found", 404, "TOUR_NOT_FOUND");
  }

  const hydratedTour = await hydrateTourOptionsIfNeeded(tour, requestId);
  const activeOptions = (hydratedTour.options || []).filter((option) => option.active !== false);

  if (!hydratedTour.bokunProductId) {
    throw new AppError("Product id is missing for this tour", 400, "PRODUCT_ID_REQUIRED");
  }

  const hasExplicitTravelDate = Boolean(payload?.travelDate);
  const requestedAdults = Math.max(1, Number(payload?.pax?.adults || 1));
  const matrixPayload = {
    productId: hydratedTour.bokunProductId,
    pax: payload.pax || { adults: 1, children: 0, infants: 0 },
    comparedAdults: hasExplicitTravelDate ? requestedAdults : 2,
    priceCatalogId: payload.priceCatalogId || "",
    optionIds: activeOptions.map((option) => String(option.bokunOptionId || "")).filter(Boolean)
  };
  const matrix = hasExplicitTravelDate
    ? await bokunService.fetchOptionAvailabilityMatrix(
        {
          ...matrixPayload,
          travelDate: payload.travelDate
        },
        requestId
      )
    : await bokunService.fetchStartingPricePreview(
        {
          ...matrixPayload,
          startDate: payload.startDate || null,
          endDate: payload.endDate || null,
          daysWindow: payload.daysWindow || 30
        },
        requestId
      );

  const matrixByOptionId = new Map(
    (matrix.options || []).map((item) => [String(item.optionId || ""), item])
  );

  const options = activeOptions.map((option) => {
    const optionId = String(option.bokunOptionId || "");
    const availability = matrixByOptionId.get(optionId) || {};

    return {
      optionId,
      name: option.name,
      description: option.description,
      pricingSummary: option.pricingSummary,
      available: Boolean(availability.available),
      status: availability.status || "sold_out",
      firstAvailableStartTime: availability.firstAvailableStartTime || "",
      firstAvailableTravelDate: availability.firstAvailableTravelDate || "",
      cheapestTravelDate: availability.cheapestTravelDate || "",
      capacityLeft: Number(availability.capacityLeft || 0),
      lowestPriceForTwo: Number(availability.lowestPriceForTwo || 0) || null,
      currency: availability.currency || hydratedTour.currency || "USD",
      slots: availability.slots || []
    };
  });

  const availableOptionIds = options
    .filter((option) => option.available)
    .map((option) => option.optionId);

  const unavailableOptionIds = options
    .filter((option) => !option.available)
    .map((option) => option.optionId);

  return {
    tourSlug: hydratedTour.slug,
    travelDate: matrix.travelDate || payload.travelDate || "",
    autoLoaded: !hasExplicitTravelDate,
    totalOptions: options.length,
    availableCount: availableOptionIds.length,
    comparedAdults: Number(matrix.comparedAdults || 2),
    priceCategories: (matrix.priceCategories || []).map((category) => ({
      categoryId: String(category.categoryId || ""),
      title: category.title || "Category",
      ticketCategory: category.ticketCategory || "",
      minQuantity: Math.max(0, Number(category.minQuantity || 0)),
      maxQuantity: Math.max(0, Number(category.maxQuantity || 50))
    })),
    lowestPriceForTwo: matrix.lowestPriceForTwo || null,
    availableOptionIds,
    unavailableOptionIds,
    options
  };
};

module.exports = {
  listTours,
  listTourCategories,
  getTourBySlug,
  getTourOptions,
  checkOptionsAvailability,
  syncProducts
};
