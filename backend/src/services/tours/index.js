const ProductSnapshot = require("../../models/ProductSnapshot");
const SyncLog = require("../../models/SyncLog");
const AppError = require("../../utils/AppError");
const bokunService = require("../../integrations/bokun");
const mongoose = require("mongoose");
const logger = require("../../config/logger");

const LIVE_DETAIL_CONCURRENCY = 3;
const PUBLIC_SNAPSHOT_AUTO_SYNC_COOLDOWN_MS = 2 * 60 * 1000;
const LISTING_SIGNAL_BACKGROUND_LIMIT = 4;
const LISTING_SIGNAL_RETRY_COOLDOWN_MS = 15 * 60 * 1000;
let publicSnapshotAutoSyncInFlight = null;
let lastPublicSnapshotAutoSyncAt = 0;
const listingSignalHydrationInFlight = new Set();
const listingSignalHydrationAttemptedAt = new Map();

// Tour details are served from the snapshot in the database. Bókun is asked again for title, images and itinerary
// in the background, at most once per product every few hours, so a visitor never waits for Bókun.
const PRESENTATION_REFRESH_MS = 3 * 60 * 60 * 1000;
const presentationRefreshedAt = new Map();
const presentationRefreshInFlight = new Map();

// Availability for one tour, date and party is reused for a few minutes; the live quote and checkout stay live.
const AVAILABILITY_CACHE_TTL_MS = 5 * 60 * 1000;
const STARTING_PRICE_CACHE_TTL_MS = 10 * 60 * 1000;
const AVAILABILITY_CACHE_MAX_ENTRIES = 500;
const availabilityCache = new Map();
const availabilityInFlight = new Map();

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

const hasDuplicatedPickupAddress = (pickupPlaces = []) =>
  pickupPlaces.some((place = {}) => {
    const parts = String(place.address || "")
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
    return parts.some((part, index) => parts.indexOf(part) !== index);
  });

const hasLegacyContentGap = (tour = {}) => {
  const raw = tour.rawBokunProduct || {};
  const itinerary = Array.isArray(tour.itinerary) ? tour.itinerary : [];
  const included = Array.isArray(tour.included) ? tour.included : [];
  const excluded = Array.isArray(tour.excluded) ? tour.excluded : [];
  const importantInformation = Array.isArray(tour.importantInformation) ? tour.importantInformation : [];
  const categories = Array.isArray(tour.categories) ? tour.categories : [];
  const pickupPlaces = Array.isArray(tour.pickupPlaces) ? tour.pickupPlaces : [];
  const liveTourGuide = tour.liveTourGuide || {};

  const rawIncludedPresent = Boolean(raw.included || (Array.isArray(raw.inclusions) && raw.inclusions.length));
  const rawExcludedPresent = Boolean(raw.excluded || (Array.isArray(raw.exclusions) && raw.exclusions.length));
  const rawKnowBeforePresent = Array.isArray(raw.knowBeforeYouGoItems) && raw.knowBeforeYouGoItems.length > 0;
  const rawItineraryPresent = Boolean(raw.itinerary || (Array.isArray(raw.itineraryItems) && raw.itineraryItems.length));
  const rawAgendaItemsPresent = Array.isArray(raw.agendaItems) && raw.agendaItems.length > 0;
  const itineraryItems = Array.isArray(tour.itineraryItems) ? tour.itineraryItems : [];
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
  const rawVideoPresent = Boolean(raw.video || (Array.isArray(raw.videos) && raw.videos.length > 0));
  const rawLanguagesPresent = Array.isArray(raw.languages) && raw.languages.length > 0;
  const rawGroupSizePresent = Boolean(
    raw.minimumParticipants || raw.minParticipants || raw.minPax || raw.maximumParticipants || raw.maxParticipants || raw.passCapacity || raw.capacity
  );
  const rawCancellationPolicyPresent = Boolean(raw.cancellationPolicy || raw.cancellationTerms);

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

  if (rawAgendaItemsPresent && itineraryItems.length === 0) {
    return true;
  }

  if (rawMeetingPresent && !tour.meetingInfo) {
    return true;
  }

  if (rawPickupPresent && !tour.pickupInfo) {
    return true;
  }

  if ((rawPickupPresent || tour.pickupInfo) && pickupPlaces.length === 0) {
    return true;
  }

  if (hasDuplicatedPickupAddress(pickupPlaces)) {
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

  if (rawVideoPresent && !tour.videoUrl) {
    return true;
  }

  if (rawLanguagesPresent && (!Array.isArray(tour.languages) || tour.languages.length === 0)) {
    return true;
  }

  if (rawGroupSizePresent && !tour.groupSize) {
    return true;
  }

  if (rawCancellationPolicyPresent && !tour.cancellationPolicy) {
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
  videoUrl: liveProduct.videoUrl,
  itinerary: liveProduct.itinerary,
  itineraryItems: liveProduct.itineraryItems,
  meetingInfo: liveProduct.meetingInfo,
  pickupInfo: liveProduct.pickupInfo,
  pickupPlaces: liveProduct.pickupPlaces,
  included: liveProduct.included,
  excluded: liveProduct.excluded,
  importantInformation: liveProduct.importantInformation,
  highlights: liveProduct.highlights,
  categories: liveProduct.categories,
  languages: liveProduct.languages,
  groupSize: liveProduct.groupSize,
  cancellationPolicy: liveProduct.cancellationPolicy,
  bestSeller: liveProduct.bestSeller,
  destination: liveProduct.destination,
  status: liveProduct.status,
  currency: liveProduct.currency,
  // fromPrice is not copied from Bókun's product: it is the one-adult starting price set by refreshListingFromPrice.
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

const hasSameItinerary = (left = [], right = []) => {
  const normalize = (items) =>
    (Array.isArray(items) ? items : []).map((item) => String(item || "").trim()).filter(Boolean);

  const leftItems = normalize(left);
  const rightItems = normalize(right);

  return leftItems.length === rightItems.length && leftItems.every((item, index) => item === rightItems[index]);
};

const hasSameItineraryItems = (left = [], right = []) =>
  JSON.stringify(Array.isArray(left) ? left : []) === JSON.stringify(Array.isArray(right) ? right : []);

const refreshTourItineraryFromBokun = async (tour, requestId) => {
  if (!tour?.bokunProductId) {
    return tour;
  }

  try {
    const liveProduct = await bokunService.fetchProductDetails(tour.bokunProductId, requestId);
    if (!liveProduct?.bokunProductId) {
      return tour;
    }

    const presentationFields = {
      title: liveProduct.title || tour.title,
      description: liveProduct.description || tour.description,
      shortDescription: liveProduct.shortDescription || tour.shortDescription,
      duration: liveProduct.duration || tour.duration,
      experienceType: liveProduct.experienceType || tour.experienceType,
      difficulty: liveProduct.difficulty || tour.difficulty,
      liveTourGuide: liveProduct.liveTourGuide || tour.liveTourGuide,
      images: Array.isArray(liveProduct.images) && liveProduct.images.length ? liveProduct.images : tour.images,
      videoUrl: liveProduct.videoUrl || "",
      itinerary: Array.isArray(liveProduct.itinerary) ? liveProduct.itinerary : [],
      itineraryItems: Array.isArray(liveProduct.itineraryItems) ? liveProduct.itineraryItems : [],
      languages: Array.isArray(liveProduct.languages) ? liveProduct.languages : [],
      groupSize: liveProduct.groupSize || "",
      cancellationPolicy: liveProduct.cancellationPolicy || "",
      bestSeller: Boolean(liveProduct.bestSeller),
      categories: Array.isArray(liveProduct.categories) ? liveProduct.categories : tour.categories
    };
    const hasPresentationChange = Object.entries(presentationFields).some(([key, value]) => {
      if (key === "itinerary") {
        return !hasSameItinerary(tour[key], value);
      }
      if (key === "itineraryItems") {
        return !hasSameItineraryItems(tour[key], value);
      }
      return JSON.stringify(tour[key] ?? null) !== JSON.stringify(value ?? null);
    });

    if (hasPresentationChange) {
      await ProductSnapshot.updateOne(
        { bokunProductId: tour.bokunProductId },
        { $set: presentationFields }
      );
    }

    return {
      ...tour,
      ...presentationFields
    };
  } catch (error) {
    logger.warn("Live Bokun itinerary refresh skipped", {
      productId: tour.bokunProductId,
      requestId,
      error: error.message
    });

    return tour;
  }
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

// Listing "From" prices are one-adult starting prices (see fetchOneAdultStartingPreview), checked again every 12 hours.
const FROM_PRICE_BASIS = "one_adult_v1";
const FROM_PRICE_REFRESH_MS = 12 * 60 * 60 * 1000;
const hasMissingListingSignals = (tour = {}) =>
  Number(tour?.fromPrice || 0) <= 0 ||
  tour?.fromPriceBasis !== FROM_PRICE_BASIS ||
  Date.now() - new Date(tour?.fromPriceCheckedAt || 0).getTime() > FROM_PRICE_REFRESH_MS;

const resolveListingOptionIds = (tour = {}) =>
  (Array.isArray(tour?.options) ? tour.options : [])
    .filter((option) => option?.active !== false)
    .map((option) => String(option?.bokunOptionId || "").trim())
    .filter(Boolean);

const resolveFromPriceUsingStartingPreview = async (tour = {}, requestId = "") => {
  const productId = String(tour?.bokunProductId || "").trim();
  if (!productId) {
    return 0;
  }

  try {
    const preview = await bokunService.fetchOneAdultStartingPreview(
      {
        productId,
        optionIds: resolveListingOptionIds(tour)
      },
      requestId
    );

    return bokunService.perPersonStartingAmount(preview?.lowestPriceForTwo);
  } catch (error) {
    logger.warn("Listing starting price preview skipped", {
      productId,
      requestId,
      error: error.message
    });
    return 0;
  }
};

const hydrateMissingListingSignals = async (items = [], requestId = "") => {
  const candidates = (items || [])
    .filter((tour) => tour?.bokunProductId && hasMissingListingSignals(tour))
    .slice(0, Math.min((items || []).length, 9));

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
        let resolvedFromPrice = 0;
        try {
          const bookingConfig = await bokunService.fetchProductBookingConfig(
            liveProduct.bokunProductId,
            {
              prefetchedProduct: liveProduct
            },
            requestId
          );

          resolvedFromPrice = bokunService.perPersonStartingAmount(bookingConfig?.startingPrice);
        } catch (error) {
          logger.warn("Listing booking-config price fallback skipped", {
            productId: tour.bokunProductId,
            requestId,
            error: error.message
          });
        }

        if (!Number.isFinite(resolvedFromPrice) || resolvedFromPrice <= 0) {
          resolvedFromPrice = await resolveFromPriceUsingStartingPreview(
            {
              ...tour,
              ...liveProduct
            },
            requestId
          );
        }

        if (Number.isFinite(resolvedFromPrice) && resolvedFromPrice > 0) {
          patch.fromPrice = resolvedFromPrice;
          patch.fromPriceBasis = FROM_PRICE_BASIS;
        }
        patch.fromPriceCheckedAt = new Date();

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

const shouldQueueListingSignalHydration = (tour = {}) => {
  const productId = String(tour?.bokunProductId || "").trim();
  if (!productId || !hasMissingListingSignals(tour)) {
    return false;
  }

  if (listingSignalHydrationInFlight.has(productId)) {
    return false;
  }

  const lastAttemptAt = Number(listingSignalHydrationAttemptedAt.get(productId) || 0);
  return Date.now() - lastAttemptAt > LISTING_SIGNAL_RETRY_COOLDOWN_MS;
};

const scheduleListingSignalHydration = (items = [], requestId = "") => {
  const candidates = (items || [])
    .filter(shouldQueueListingSignalHydration)
    .slice(0, LISTING_SIGNAL_BACKGROUND_LIMIT);

  if (!candidates.length) {
    return;
  }

  const productIds = candidates.map((tour) => String(tour.bokunProductId));
  productIds.forEach((productId) => {
    listingSignalHydrationInFlight.add(productId);
    listingSignalHydrationAttemptedAt.set(productId, Date.now());
  });

  const runHydration = async () => {
    try {
      await hydrateMissingListingSignals(candidates, requestId);
    } catch (error) {
      logger.warn("Background listing signal hydration failed", {
        requestId,
        error: error.message
      });
    } finally {
      productIds.forEach((productId) => listingSignalHydrationInFlight.delete(productId));
    }
  };

  if (typeof setImmediate === "function") {
    setImmediate(() => {
      void runHydration();
    });
    return;
  }

  setTimeout(() => {
    void runHydration();
  }, 0);
};

const normalizeListingSignalValues = (tour = {}) => {
  const fromPrice = Number(tour?.fromPrice);
  const rating = Number(tour?.rating);
  const reviewCount = Number(tour?.reviewCount);

  return {
    ...tour,
    fromPrice: Number.isFinite(fromPrice) && fromPrice > 0 ? fromPrice : 0,
    // A rating is shown only with real reviews behind it.
    rating: Number.isFinite(rating) && rating > 0 && reviewCount > 0 ? Number(rating.toFixed(1)) : 0,
    reviewCount: Number.isFinite(reviewCount) && reviewCount > 0 ? Math.round(reviewCount) : 0
  };
};

// Products shown on the public site: active and not hidden by staff.
const PUBLIC_LISTING_FILTER = Object.freeze({ status: "active", hiddenFromPublic: { $ne: true } });

// Listing cards show the short description, or the start of the full description when there is none.
const listingSummary = (tour = {}) => {
  const short = String(tour.shortDescription || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (short) return short;
  const full = String(tour.description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return full.length > 180 ? `${full.slice(0, 177).trim()}...` : full;
};

const listTours = async ({ page = 1, limit = 9, requestId = "" } = {}) => {
  await ensurePublicSnapshotCache(requestId);
  const totalItems = await ProductSnapshot.countDocuments(PUBLIC_LISTING_FILTER);

  const safePage = Math.max(1, Number(page || 1));
  const safeLimit = Math.min(60, Math.max(1, Number(limit || 9)));
  const skip = (safePage - 1) * safeLimit;

  const items = await ProductSnapshot.find(PUBLIC_LISTING_FILTER)
    .select("bokunProductId title slug shortDescription description duration images fromPrice fromPriceBasis fromPriceCheckedAt rating reviewCount currency destination highlights categories lastSyncedAt options.bokunOptionId options.active")
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(safeLimit)
    .lean();
  const normalizedItems = items.map(({ description, ...tour }) => ({
    ...normalizeListingSignalValues(tour),
    shortDescription: listingSummary({ ...tour, description })
  }));
  scheduleListingSignalHydration(items, requestId);

  const totalPages = Math.max(1, Math.ceil(totalItems / safeLimit));

  return {
    items: normalizedItems,
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

  const rows = await ProductSnapshot.find(PUBLIC_LISTING_FILTER)
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

const schedulePresentationRefresh = (tour, requestId) => {
  const productId = String(tour?.bokunProductId || "");
  if (!productId || presentationRefreshInFlight.has(productId)) return;
  if (Date.now() - (presentationRefreshedAt.get(productId) || 0) < PRESENTATION_REFRESH_MS) return;

  presentationRefreshedAt.set(productId, Date.now());
  const refresh = refreshTourItineraryFromBokun(tour, requestId)
    .catch(() => null)
    .finally(() => presentationRefreshInFlight.delete(productId));
  presentationRefreshInFlight.set(productId, refresh);
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

  // Only a snapshot missing its options or prices waits for Bókun; everything else is served from the database.
  const hydratedTour = await hydrateTourOptionsIfNeeded(tour, requestId);
  schedulePresentationRefresh(hydratedTour, requestId);
  // A missing or outdated "From" price is computed again in the background, as on the listing.
  scheduleListingSignalHydration([hydratedTour], requestId);
  return hydratedTour;
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

// Bookable dates for the tour calendar (no date is excluded when Bókun cannot be reached; the page then lets the
// guest pick any future date and checks it as before).
// Staff view of every active product with its public visibility.
const listProductsForAdmin = async () => {
  const rows = await ProductSnapshot.find({ status: "active" })
    .select("bokunProductId title slug fromPrice currency shortDescription description hiddenFromPublic hiddenAt hiddenBy updatedAt")
    .sort({ title: 1 })
    .lean();
  return rows.map(({ description, shortDescription, ...row }) => ({
    ...row,
    hiddenFromPublic: Boolean(row.hiddenFromPublic),
    hasShortDescription: Boolean(String(shortDescription || "").trim()),
    hasDescription: Boolean(String(description || "").replace(/<[^>]*>/g, "").trim())
  }));
};

const setProductVisibility = async (productId, hidden, actor = "") => {
  const updated = await ProductSnapshot.findOneAndUpdate(
    { bokunProductId: String(productId || "") },
    { $set: { hiddenFromPublic: Boolean(hidden), hiddenAt: hidden ? new Date() : null, hiddenBy: hidden ? String(actor || "") : "" } },
    { new: true }
  )
    .select("bokunProductId title slug hiddenFromPublic hiddenAt hiddenBy")
    .lean();
  if (!updated) throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
  return updated;
};

const getAvailableDates = async (slug, { from = "", days = 60 } = {}, requestId) => {
  const tour = await ProductSnapshot.findOne({ slug }).select("bokunProductId").lean();
  if (!tour) throw new AppError("Tour not found", 404, "TOUR_NOT_FOUND");
  return bokunService.fetchAvailableDates({ productId: tour.bokunProductId, startDate: from, days }, requestId);
};

const availabilityCacheKey = (slug, payload = {}) => JSON.stringify([
  slug,
  payload.travelDate || "",
  payload.startDate || "",
  payload.endDate || "",
  payload.daysWindow || "",
  payload.priceCatalogId || "",
  Number(payload?.pax?.adults || 0),
  Number(payload?.pax?.children || 0),
  Number(payload?.pax?.infants || 0)
]);

const checkOptionsAvailability = async (slug, payload = {}, requestId) => {
  const key = availabilityCacheKey(slug, payload);
  const cached = availabilityCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (availabilityInFlight.has(key)) return availabilityInFlight.get(key);

  const lookup = loadOptionsAvailability(slug, payload, requestId)
    .then((value) => {
      if (availabilityCache.size >= AVAILABILITY_CACHE_MAX_ENTRIES) {
        availabilityCache.delete(availabilityCache.keys().next().value);
      }
      const ttl = payload?.travelDate ? AVAILABILITY_CACHE_TTL_MS : STARTING_PRICE_CACHE_TTL_MS;
      availabilityCache.set(key, { value, expiresAt: Date.now() + ttl });
      return value;
    })
    .finally(() => availabilityInFlight.delete(key));
  availabilityInFlight.set(key, lookup);
  return lookup;
};

const loadOptionsAvailability = async (slug, payload = {}, requestId) => {
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
    comparedAdults: hasExplicitTravelDate ? requestedAdults : 1,
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
      pricingType: availability.pricingType || option.pricingType || "",
      maxPerBooking: availability.maxPerBooking || option.maxPerBooking || null,
      comparedAdults: Number(matrix.comparedAdults || 2),
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

const searchToursByAvailability = async ({ travelDate, pax, slugs = [], requestId = "" } = {}) => {
  const uniqueSlugs = Array.from(new Set((slugs || []).map((slug) => String(slug || "").trim()).filter(Boolean))).slice(0, 12);

  if (!travelDate || !uniqueSlugs.length) {
    return [];
  }

  const results = await mapWithConcurrency(
    uniqueSlugs,
    async (slug) => {
      try {
        const availability = await checkOptionsAvailability(slug, { travelDate, pax }, requestId);
        return {
          slug,
          available: availability.availableCount > 0,
          availableCount: availability.availableCount,
          lowestPrice: availability.lowestPriceForTwo || null,
          currency: availability.options.find((option) => option.available)?.currency || "USD"
        };
      } catch (error) {
        logger.warn({ err: error, slug, requestId }, "Tour availability search check failed");
        return {
          slug,
          available: false,
          availableCount: 0,
          unavailableReason: "Live availability could not be confirmed."
        };
      }
    },
    LIVE_DETAIL_CONCURRENCY
  );

  return results;
};

module.exports = {
  listTours,
  listTourCategories,
  getTourBySlug,
  getAvailableDates,
  listProductsForAdmin,
  setProductVisibility,
  getTourOptions,
  checkOptionsAvailability,
  searchToursByAvailability,
  syncProducts
};
