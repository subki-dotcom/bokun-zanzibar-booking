const slugify = require("slugify");

const ensureArray = (value) => (Array.isArray(value) ? value : []);

const toNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (value && typeof value === "object" && value.amount !== undefined && value.amount !== null) {
    return toNumber(value.amount);
  }

  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const pickNumericPreferPositive = (...values) => {
  let fallback = null;

  for (const value of values) {
    const numeric = toNumber(value);
    if (numeric === null) {
      if (typeof value === "string") {
        const token = String(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
        if (token) {
          const parsedToken = Number(token[0]);
          if (Number.isFinite(parsedToken)) {
            if (fallback === null) {
              fallback = parsedToken;
            }

            if (parsedToken > 0) {
              return parsedToken;
            }
          }
        }
      }
      continue;
    }

    if (fallback === null) {
      fallback = numeric;
    }

    if (numeric > 0) {
      return numeric;
    }
  }

  return fallback === null ? 0 : fallback;
};

const pickPrice = (...values) => pickNumericPreferPositive(...values);

const decodeEntities = (value = "") =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

const stripHtml = (value = "") => {
  const text = String(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  return decodeEntities(text).replace(/\s+/g, " ").trim();
};

const splitHtmlLines = (value = "") => {
  const normalized = String(value)
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ");

  return decodeEntities(normalized)
    .split(/\n+/)
    .map((row) => row.replace(/\s+/g, " ").trim())
    .filter(Boolean);
};

const addUniqueLine = (rows = [], line = "") => {
  const cleaned = String(line || "").trim();
  if (!cleaned) {
    return rows;
  }

  if (!rows.some((item) => item.toLowerCase() === cleaned.toLowerCase())) {
    rows.push(cleaned);
  }

  return rows;
};

const extractTextCandidates = (value) => {
  if (value === null || value === undefined) {
    return [];
  }

  if (typeof value === "string") {
    return splitHtmlLines(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap(extractTextCandidates);
  }

  if (typeof value === "object") {
    const preferredKeys = [
      "text",
      "title",
      "description",
      "label",
      "name",
      "value",
      "information",
      "content"
    ];

    const lines = [];
    preferredKeys.forEach((key) => {
      if (value[key] !== undefined && value[key] !== null) {
        extractTextCandidates(value[key]).forEach((line) => addUniqueLine(lines, line));
      }
    });

    if (lines.length > 0) {
      return lines;
    }

    return Object.values(value).flatMap(extractTextCandidates);
  }

  return [];
};

const buildTextList = (...sources) => {
  const lines = [];
  sources.forEach((source) => {
    extractTextCandidates(source).forEach((line) => addUniqueLine(lines, line));
  });
  return lines;
};

const humanizeKnowBeforeToken = (token = "") => {
  const normalized = String(token || "").trim().toUpperCase();
  if (!normalized) {
    return "";
  }

  const knownLabels = {
    PUBLIC_TRANSPORTATION_NEARBY: "Public transportation is available nearby.",
    PASSPORT_REQUIRED: "Passport is required.",
    INFANTS_MUST_SIT_ON_LAPS: "Infants must sit on laps.",
    INFANT_SEATS_AVAILABLE: "Infant seats are available.",
    ANIMALS_OR_PETS_ALLOWED: "Animals or pets are allowed."
  };

  if (knownLabels[normalized]) {
    return knownLabels[normalized];
  }

  const sentence = normalized
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return `${sentence}.`;
};

const truncateText = (value = "", maxLength = 300) => {
  if (!value || value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trim()}...`;
};

const stringifyDuration = (rawDuration) => {
  if (typeof rawDuration === "string") {
    return rawDuration;
  }

  if (typeof rawDuration === "number" && rawDuration > 0) {
    if (rawDuration % 60 === 0) {
      return `${rawDuration / 60}h`;
    }

    return `${rawDuration}m`;
  }

  return "";
};

const humanizeToken = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  return raw
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const normalizeLanguage = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const token = raw.toUpperCase();
  const languageMap = {
    EN: "English",
    EN_GB: "English",
    EN_US: "English",
    FR: "French",
    DE: "German",
    IT: "Italian",
    ES: "Spanish",
    SW: "Swahili",
    PT: "Portuguese",
    AR: "Arabic",
    RU: "Russian",
    ZH: "Chinese"
  };

  if (languageMap[token]) {
    return languageMap[token];
  }

  const shortCode = token.split(/[-_]/)[0];
  if (languageMap[shortCode]) {
    return languageMap[shortCode];
  }

  return humanizeToken(raw);
};

const buildDurationLabel = (root = {}) => {
  const durationText = stripHtml(root.durationText || root.durationLabel || "");
  if (durationText) {
    return durationText;
  }

  const weeks = Math.max(0, Number(root.durationWeeks || 0));
  const days = Math.max(0, Number(root.durationDays || 0));
  const hours = Math.max(0, Number(root.durationHours || 0));
  const minutes = Math.max(0, Number(root.durationMinutes || 0));

  const chunks = [];
  if (weeks > 0) {
    chunks.push(`${weeks}w`);
  }
  if (days > 0) {
    chunks.push(`${days}d`);
  }
  if (hours > 0) {
    chunks.push(`${hours}h`);
  }
  if (minutes > 0) {
    chunks.push(`${minutes}m`);
  }

  if (chunks.length > 0) {
    return chunks.join(" ");
  }

  const durationType = String(root.durationType || "").toUpperCase();
  const durationValue = Number(root.duration);
  if (Number.isFinite(durationValue) && durationValue > 0) {
    if (durationType === "WEEKS") {
      return `${durationValue}w`;
    }
    if (durationType === "DAYS") {
      return `${durationValue}d`;
    }
    if (durationType === "HOURS") {
      return `${durationValue}h`;
    }
    if (durationType === "MINUTES") {
      return `${durationValue}m`;
    }
  }

  return stringifyDuration(root.duration);
};

const extractGuideLanguages = (root = {}) => {
  const languages = [];

  ensureArray(root.guidanceTypes).forEach((guidanceType) => {
    ensureArray(guidanceType.displayLanguages).forEach((language) => {
      addUniqueLine(languages, language);
    });

    ensureArray(guidanceType.languages).forEach((language) => {
      addUniqueLine(languages, normalizeLanguage(language));
    });
  });

  if (languages.length === 0) {
    ensureArray(root.languages).forEach((language) => addUniqueLine(languages, normalizeLanguage(language)));
  }

  return languages;
};

const mapLiveTourGuide = (root = {}) => {
  const guidanceTypes = ensureArray(root.guidanceTypes);
  const supportedFromGuidanceTypes = guidanceTypes.some((guidanceType) =>
    String(guidanceType?.guidanceType || "")
      .toUpperCase()
      .includes("GUID")
  );

  const supported =
    typeof root.liveTourGuide === "boolean"
      ? root.liveTourGuide
      : typeof root.hasLiveTourGuide === "boolean"
        ? root.hasLiveTourGuide
        : supportedFromGuidanceTypes;

  return {
    supported: Boolean(supported),
    guidanceType: humanizeToken(guidanceTypes[0]?.guidanceType || ""),
    languages: extractGuideLanguages(root)
  };
};

const mapCategories = (root = {}) => {
  const categories = [];

  ensureArray(root.categories).forEach((category) => {
    const rawCategory =
      typeof category === "string"
        ? category
        : category?.name || category?.title || category?.label || category?.value;

    addUniqueLine(categories, humanizeToken(rawCategory));
  });

  addUniqueLine(categories, humanizeToken(root.productCategory));

  return categories.filter(Boolean);
};

const mapExperienceType = (root = {}) =>
  humanizeToken(root.experienceType || root.activityType || root.activityCategory || root.type || "");

const mapDifficulty = (root = {}) => humanizeToken(root.difficultyLevel || root.difficulty || "");

const compactJoin = (parts = [], separator = ", ") =>
  parts
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(separator);

const formatAddress = (address = {}) =>
  compactJoin([
    address.addressLine1,
    address.addressLine2,
    address.addressLine3,
    address.city,
    address.state
  ]);

const mapStartPointLines = (startPoints = []) =>
  ensureArray(startPoints)
    .map((startPoint) => {
      const title = stripHtml(startPoint?.title || startPoint?.name || "");
      const addressText = formatAddress(startPoint?.address || {});
      return compactJoin([title, addressText], " - ");
    })
    .filter(Boolean);

const mapPickupGroupLines = (pickupPlaceGroups = []) =>
  ensureArray(pickupPlaceGroups)
    .map((group) => {
      const groupTitle = stripHtml(group?.title || group?.name || "");
      const placeNames = ensureArray(group?.pickupPlaces)
        .map((place) => stripHtml(place?.title || place?.name || ""))
        .filter(Boolean);

      const placesText = placeNames.length ? placeNames.join(", ") : "";
      return compactJoin([groupTitle, placesText], " - ");
    })
    .filter(Boolean);

const mapMeetingInfo = (root = {}) => {
  const lines = buildTextList(
    root.meetingInfo,
    root.meetingPoint?.description,
    root.meetingPointDescription,
    root.meetingInstructions,
    mapStartPointLines(root.startPoints)
  );

  return lines.join(" | ");
};

const mapPickupInfo = (root = {}) => {
  const lines = buildTextList(
    root.pickupInfo,
    root.pickupInstructions,
    mapPickupGroupLines(root.pickupPlaceGroups)
  );

  if (!lines.length && root.noPickupMsg) {
    lines.push(stripHtml(root.noPickupMsg));
  }

  if (!lines.length && root.meetingType === "PICK_UP" && root.pickupService === true) {
    lines.push("Pickup available for this product.");
  }

  return lines.join(" | ");
};

const mapProductItinerary = (root = {}, mappedOptions = []) =>
  {
    const explicit = buildTextList(
      root.itinerary,
      root.itineraryItems,
      root.activityItinerary,
      ensureArray(root.routes).map((route) => route?.title || route?.description),
      mappedOptions.flatMap((option) => ensureArray(option?.itinerary))
    );

    if (explicit.length > 0) {
      return explicit;
    }

    const descriptionText = stripHtml(
      root.itineraryDescription ||
        root.description ||
        root.activityDescription ||
        root.shortDescription ||
        root.summary ||
        ""
    );

    if (!descriptionText) {
      return [];
    }

    const sentenceCandidates = descriptionText
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= 24);

    if (sentenceCandidates.length > 1) {
      return sentenceCandidates.slice(0, 6).map((sentence) => sentence.slice(0, 220));
    }

    const sequenced = descriptionText
      .replace(/\s+(then|after that|afterwards|finally|finish with|start with)\s+/gi, " | ")
      .split("|")
      .map((segment) => segment.trim())
      .filter((segment) => segment.length >= 24);

    if (sequenced.length > 1) {
      return sequenced.slice(0, 6).map((segment) => segment.slice(0, 220));
    }

    return [descriptionText.slice(0, 220)];
  };

const mapOption = (rawOption = {}) => ({
  bokunOptionId: String(rawOption.id || rawOption.optionId || ""),
  name: rawOption.name || rawOption.title || rawOption.rateName || "Untitled Option",
  description: stripHtml(rawOption.description || rawOption.rateDescription || ""),
  language: rawOption.language || rawOption.guideLanguage || "",
  pricingSummary:
    rawOption.pricingSummary ||
    rawOption.priceSummary ||
    rawOption.priceText ||
    "",
  pickupSupported:
    typeof rawOption.pickupSupported === "boolean"
      ? rawOption.pickupSupported
      : rawOption.pickupSelectionType
        ? rawOption.pickupSelectionType !== "UNAVAILABLE"
        : false,
  meetingPointSupported: rawOption.meetingPointSupported !== false,
  active: rawOption.active !== false,
  itinerary: buildTextList(rawOption.itinerary, rawOption.itineraryItems),
  importantInformation: buildTextList(rawOption.importantInformation)
});

const mapPriceCatalog = (rawCatalog = {}) => {
  const catalog = rawCatalog.catalog || rawCatalog;
  const activityPriceCatalogId = String(rawCatalog.id || rawCatalog.activityPriceCatalogId || "");
  const catalogId = String(rawCatalog.catalogId || catalog.id || activityPriceCatalogId || "");

  return {
    activityPriceCatalogId,
    catalogId,
    title: catalog.title || rawCatalog.title || "Default",
    active: rawCatalog.active !== false,
    isVendorDefault: Boolean(
      catalog.isVendorDefaultCatalog !== undefined
        ? catalog.isVendorDefaultCatalog
        : rawCatalog.isVendorDefault
    ),
    currency: catalog.currency || rawCatalog.currency || "",
    validFrom: catalog.startDate || catalog.validFrom || null,
    validTo: catalog.endDate || catalog.validTo || null
  };
};

const resolveCatalogId = (catalog = {}) =>
  String(catalog?.activityPriceCatalogId || catalog?.catalogId || catalog?.id || "").trim();

const normalizeCatalogOption = (catalog = {}, fallbackCurrency = "USD") => {
  const id = resolveCatalogId(catalog);
  if (!id) {
    return null;
  }

  return {
    id,
    label: String(catalog?.title || catalog?.name || "Default").trim() || "Default",
    description: String(catalog?.description || "").trim(),
    pricingType: String(catalog?.pricingType || "per_person").trim() || "per_person",
    currency: String(catalog?.currency || fallbackCurrency || "USD").trim() || "USD",
    isDefault: Boolean(catalog?.isVendorDefault)
  };
};

const mapBokunRatesToPriceCatalogOptions = ({
  priceCatalogs = [],
  rawProduct = {},
  currency = "USD"
} = {}) => {
  const mapped = ensureArray(priceCatalogs)
    .map((catalog) => normalizeCatalogOption(catalog, currency))
    .filter(Boolean);

  if (mapped.length > 0) {
    return mapped;
  }

  const fallback = ensureArray(rawProduct?.activityPriceCatalogs)
    .map((catalogRow = {}) => {
      const normalized = mapPriceCatalog(catalogRow);
      return normalizeCatalogOption(normalized, currency);
    })
    .filter(Boolean);

  return fallback;
};

const normalizePricingCategory = (passenger = {}) => {
  const id = String(passenger?.pricingCategoryId || passenger?.categoryId || "").trim();
  if (!id) {
    return null;
  }

  const label = String(passenger?.title || passenger?.ticketCategory || `Category ${id}`).trim();
  const ticketCategory = String(passenger?.ticketCategory || "").trim();
  const min = Math.max(0, Number(passenger?.minPerBooking ?? passenger?.minQuantity ?? 0));
  const max = Math.max(min, Number(passenger?.maxPerBooking ?? passenger?.maxQuantity ?? 50));
  const token = `${ticketCategory} ${label}`.toLowerCase();
  const defaultQuantity = token.includes("adult") ? 1 : 0;

  return {
    id,
    label: label || `Category ${id}`,
    min,
    max,
    defaultQuantity,
    ticketCategory
  };
};

const getCategoryWeight = (category = {}) => {
  const token = `${category?.ticketCategory || ""} ${category?.label || ""}`.toLowerCase();
  if (token.includes("adult")) return 1;
  if (token.includes("child")) return 2;
  if (token.includes("infant") || token.includes("baby")) return 3;
  if (token.includes("senior")) return 4;
  if (token.includes("group")) return 5;
  return 9;
};

const mapBokunPricingCategories = (priceList = null, selectedRateId = "") => {
  const categoriesMap = new Map();
  const selectedRateToken = String(selectedRateId || "").trim();
  const allRates = [];

  ensureArray(priceList?.pricesByDateRange).forEach((range) => {
    ensureArray(range?.rates).forEach((rate) => {
      allRates.push(rate);
    });
  });

  const hasMatchingRateId = selectedRateToken
    ? allRates.some((rate) => String(rate?.rateId || "").trim() === selectedRateToken)
    : false;

  allRates.forEach((rate) => {
    const rateId = String(rate?.rateId || "").trim();
    if (selectedRateToken && hasMatchingRateId && rateId && rateId !== selectedRateToken) {
      return;
    }

    ensureArray(rate?.passengers).forEach((passenger) => {
      const normalized = normalizePricingCategory(passenger);
      if (!normalized) {
        return;
      }

      if (!categoriesMap.has(normalized.id)) {
        categoriesMap.set(normalized.id, normalized);
        return;
      }

      const current = categoriesMap.get(normalized.id);
      current.min = Math.min(current.min, normalized.min);
      current.max = Math.max(current.max, normalized.max);
    });
  });

  return Array.from(categoriesMap.values()).sort((a, b) => {
    const weightDiff = getCategoryWeight(a) - getCategoryWeight(b);
    if (weightDiff !== 0) {
      return weightDiff;
    }

    return String(a.label || "").localeCompare(String(b.label || ""));
  });
};

const resolveMinimumOptionPrice = (options = []) => {
  const amounts = ensureArray(options)
    .map((option = {}) =>
      pickPrice(
        option.fromPrice,
        option.priceFrom,
        option.lowestPrice,
        option.startingPrice,
        option.price,
        option.price?.amount,
        option.startingPrice?.amount,
        option.pricingSummary,
        option.priceSummary
      )
    )
    .filter((amount) => Number.isFinite(amount) && amount > 0);

  return amounts.length ? Math.min(...amounts) : 0;
};

const resolveProductRating = (root = {}) => {
  const rating = pickNumericPreferPositive(
    root.rating,
    root.ratingAverage,
    root.averageRating,
    root.reviewRating,
    root.reviewsAverage,
    root.ratingData?.average,
    root.reviewStats?.ratingAverage,
    root.reviewSummary?.rating,
    root.reviewSummary?.averageRating,
    root.tripAdvisorRating,
    root.tripadvisorRating
  );

  if (!Number.isFinite(rating) || rating <= 0) {
    return 0;
  }

  return Number(rating.toFixed(1));
};

const resolveProductReviewCount = (root = {}) => {
  const count = pickNumericPreferPositive(
    root.reviewCount,
    root.totalReviews,
    root.reviewsCount,
    root.numberOfReviews,
    root.ratingData?.count,
    root.reviewStats?.count,
    root.reviewSummary?.count,
    root.reviewSummary?.reviewCount,
    root.reviewSummary?.totalReviews,
    root.tripAdvisorReviewCount,
    root.tripadvisorReviewCount
  );

  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }

  return Math.round(count);
};

const mapProduct = (rawProduct = {}) => {
  const root = rawProduct.activity || rawProduct;
  const productId = String(root.id || root.productId || "");
  const title = root.title || root.name || root.activityName || "Untitled Tour";

  const optionsSource = ensureArray(root.options).length
    ? ensureArray(root.options)
    : ensureArray(root.rates);

  const imageUrls = ensureArray(root.images).length
    ? ensureArray(root.images)
    : ensureArray(root.photos).map((photo) => photo?.originalUrl || photo?.url).filter(Boolean);

  const categories = mapCategories(root);
  const optionFromPrice = resolveMinimumOptionPrice(optionsSource);

  const currency = root.currency || root.paymentCurrency || "USD";
  const fromPrice = pickPrice(
    root.fromPrice,
    root.priceFrom,
    root.lowestPrice,
    root.startingPrice,
    root.price,
    root.price?.amount,
    root.startingPrice?.amount,
    root.retailPrice,
    root.advertisedPrice,
    optionFromPrice
  );
  const rating = resolveProductRating(root);
  const reviewCount = resolveProductReviewCount(root);

  const mappedOptions = optionsSource.map(mapOption).filter((option) => option.bokunOptionId);
  const mappedPriceCatalogs = ensureArray(root.activityPriceCatalogs)
    .map(mapPriceCatalog)
    .filter((catalog) => catalog.catalogId);

  // Some Bokun products do not expose explicit rate variants in search payload.
  // We still expose one default selectable option so UI and checkout flow remain usable.
  if (mappedOptions.length === 0 && productId) {
    mappedOptions.push({
      bokunOptionId: `${productId}-default`,
      name: "Standard Option",
      description: "Default booking option from Bokun product settings.",
      language: root.baseLanguage || "",
      pricingSummary: fromPrice > 0 ? `From ${currency} ${fromPrice}` : "",
      pickupSupported: root.fields?.meetingType === "PICK_UP",
      meetingPointSupported: true,
      active: true,
      itinerary: [],
      importantInformation: []
    });
  }

  return {
    bokunProductId: productId,
    title,
    slug: `${root.slug || slugify(title, { lower: true, strict: true })}-${productId}`.replace(/-+$/, ""),
    description: stripHtml(root.description || root.activityDescription || root.summary || ""),
    shortDescription: truncateText(
      stripHtml(root.shortDescription || root.summary || root.excerpt || ""),
      320
    ),
    duration: buildDurationLabel(root),
    experienceType: mapExperienceType(root),
    difficulty: mapDifficulty(root),
    liveTourGuide: mapLiveTourGuide(root),
    images: imageUrls,
    itinerary: mapProductItinerary(root, mappedOptions),
    meetingInfo: mapMeetingInfo(root),
    pickupInfo: mapPickupInfo(root),
    included: buildTextList(root.included, root.inclusions),
    excluded: buildTextList(root.excluded, root.exclusions),
    importantInformation: buildTextList(
      root.importantInformation,
      root.importantInfo,
      ensureArray(root.knowBeforeYouGoItems).map(humanizeKnowBeforeToken),
      root.noPickupMsg
    ),
    highlights: buildTextList(root.highlights, root.keywords),
    categories,
    destination: root.destination || root.location?.name || "Zanzibar",
    status: root.status || (root.active === false ? "inactive" : "active"),
    currency,
    fromPrice,
    rating,
    reviewCount,
    options: mappedOptions,
    priceCatalogs: mappedPriceCatalogs,
    lastSyncedAt: new Date(),
    rawBokunProduct: root
  };
};

const normalizePax = (pax = {}) => {
  const adults = Math.max(0, Number(pax.adults || 0));
  const children = Math.max(0, Number(pax.children || 0));
  const infants = Math.max(0, Number(pax.infants || 0));
  const total = adults + children + infants;

  return {
    adults,
    children,
    infants,
    total,
    totalForPricing: total > 0 ? total : 1
  };
};

const normalizeTicketCategory = (value = "") => {
  const token = String(value).toLowerCase();

  if (token.includes("adult")) {
    return "adult";
  }

  if (token.includes("child")) {
    return "child";
  }

  if (token.includes("infant") || token.includes("baby")) {
    return "infant";
  }

  return "other";
};

const resolveQuantityForPassenger = (passenger = {}, paxSummary) => {
  const category = normalizeTicketCategory(passenger.ticketCategory || passenger.title || "");

  if (category === "adult") {
    return paxSummary.adults;
  }

  if (category === "child") {
    return paxSummary.children;
  }

  if (category === "infant") {
    return paxSummary.infants;
  }

  return 0;
};

const resolveCurrency = (...values) => {
  for (const value of values) {
    if (value && typeof value === "string") {
      return value;
    }
  }

  return "USD";
};

const selectTierEntry = (entries = [], participantCount = 1) => {
  const tiers = ensureArray(entries)
    .map((entry) => {
      const minParticipants = Number(entry.minPassengersRequired ?? entry.minParticipantsRequired ?? 1);
      const maxParticipants = Number(entry.maxPassengersRequired ?? entry.maxParticipantsRequired ?? minParticipants);
      const amountValue = entry.amount?.amount ?? entry.amount;
      const amount = Number(amountValue ?? 0);

      if (!Number.isFinite(amount)) {
        return null;
      }

      return {
        min: Number.isFinite(minParticipants) ? minParticipants : 1,
        max: Number.isFinite(maxParticipants) ? maxParticipants : minParticipants,
        amount,
        currency: resolveCurrency(entry.amount?.currency, entry.currency)
      };
    })
    .filter(Boolean);

  if (!tiers.length) {
    return null;
  }

  const direct = tiers.find((tier) => participantCount >= tier.min && participantCount <= tier.max);
  if (direct) {
    return direct;
  }

  const sorted = [...tiers].sort((a, b) => a.min - b.min);
  return sorted.find((tier) => participantCount <= tier.max) || sorted[sorted.length - 1];
};

const getSlotStatus = (slot = {}) => {
  if (slot.soldOut || slot.unavailable) {
    return "sold_out";
  }

  if (slot.unlimitedAvailability) {
    return "available";
  }

  const remaining = Number(slot.availabilityCount || 0);
  if (remaining > 10) {
    return "available";
  }

  if (remaining > 0) {
    return "limited";
  }

  return "sold_out";
};

const getSlotTime = (slot = {}) => slot.startTime || slot.startTimeLabel || "Flexible";

const slotSupportsOption = (slot = {}, optionRateId) => {
  if (!optionRateId) {
    return true;
  }

  const inRates = ensureArray(slot.rates).some((rate) => Number(rate.id) === optionRateId);
  if (inRates) {
    return true;
  }

  const inPricesByRate = ensureArray(slot.pricesByRate).some((item) => Number(item.activityRateId) === optionRateId);
  if (inPricesByRate) {
    return true;
  }

  return Number(slot.defaultRateId) === optionRateId;
};

const resolveRatePrice = (slot = {}, optionRateId) => {
  const pricesByRate = ensureArray(slot.pricesByRate);

  if (!pricesByRate.length) {
    return null;
  }

  if (optionRateId) {
    const selected = pricesByRate.find((item) => Number(item.activityRateId) === optionRateId);
    if (selected) {
      return selected;
    }
  }

  const defaultRateId = Number(slot.defaultRateId || 0);
  if (defaultRateId > 0) {
    const selected = pricesByRate.find((item) => Number(item.activityRateId) === defaultRateId);
    if (selected) {
      return selected;
    }
  }

  return pricesByRate[0];
};

const resolveRateDefinition = (slot = {}, selectedRateId) =>
  ensureArray(slot.rates).find((rate) => Number(rate.id) === Number(selectedRateId)) || null;

const resolveSelectedRateContext = ({ slot = {}, optionRateId = null }) => {
  const selectedRatePrice = resolveRatePrice(slot, optionRateId);
  const selectedRateId =
    Number(selectedRatePrice?.activityRateId || 0) ||
    Number(optionRateId || 0) ||
    Number(slot.defaultRateId || 0) ||
    null;

  return {
    selectedRatePrice,
    selectedRateId,
    selectedRateDefinition: resolveRateDefinition(slot, selectedRateId)
  };
};

const resolvePriceListRate = ({ priceList = null, selectedRateId }) => {
  if (!priceList || !selectedRateId) {
    return null;
  }

  const ranges = ensureArray(priceList.pricesByDateRange);
  for (const range of ranges) {
    const matched = ensureArray(range.rates).find((rate) => Number(rate.rateId) === Number(selectedRateId));
    if (matched) {
      return matched;
    }
  }

  return null;
};

const normalizeCategoryParticipants = (participants = []) =>
  ensureArray(participants)
    .map((item) => ({
      categoryId: String(item.categoryId || item.pricingCategoryId || ""),
      quantity: Math.max(0, Number(item.quantity || 0)),
      title: item.title || "",
      ticketCategory: item.ticketCategory || ""
    }))
    .filter((item) => item.categoryId);

const normalizePriceCatalogs = (priceCatalogs = []) =>
  ensureArray(priceCatalogs)
    .map(mapPriceCatalog)
    .filter((catalog) => catalog.catalogId);

const resolveSelectedPriceCatalog = (requestedCatalogId = "", availablePriceCatalogs = []) => {
  const normalizedCatalogs = normalizePriceCatalogs(availablePriceCatalogs).filter(
    (catalog) => catalog.active !== false
  );

  if (!normalizedCatalogs.length) {
    return {
      selected: null,
      available: []
    };
  }

  const requested = String(requestedCatalogId || "");
  const selected =
    normalizedCatalogs.find((catalog) => catalog.catalogId === requested) ||
    normalizedCatalogs.find((catalog) => catalog.isVendorDefault) ||
    normalizedCatalogs[0];

  return {
    selected,
    available: normalizedCatalogs
  };
};

const buildCategoryContext = ({
  priceListRate = null,
  paxSummary,
  categoryIds = [],
  requestedParticipants = []
}) => {
  const quantitiesByCategory = {};
  const labelByCategory = {};
  const ticketCategoryById = {};
  const requestedMap = new Map(
    normalizeCategoryParticipants(requestedParticipants).map((item) => [item.categoryId, item])
  );
  let totalRequestedParticipants = 0;
  let hasRequestedParticipants = false;

  ensureArray(priceListRate?.passengers).forEach((passenger) => {
    const categoryId = String(passenger.pricingCategoryId || "");
    if (!categoryId) {
      return;
    }

    labelByCategory[categoryId] = passenger.title || passenger.ticketCategory || `Category ${categoryId}`;
    ticketCategoryById[categoryId] = passenger.ticketCategory || "";

    const requested = requestedMap.get(categoryId);
    if (requested) {
      quantitiesByCategory[categoryId] = requested.quantity;
      totalRequestedParticipants += requested.quantity;
      hasRequestedParticipants = true;
      return;
    }

    const quantity = resolveQuantityForPassenger(passenger, paxSummary);
    if (quantity > 0) {
      quantitiesByCategory[categoryId] = (quantitiesByCategory[categoryId] || 0) + quantity;
    }
  });

  if (hasRequestedParticipants) {
    for (const categoryId of categoryIds) {
      if (quantitiesByCategory[categoryId] === undefined) {
        quantitiesByCategory[categoryId] = 0;
      }
      if (!labelByCategory[categoryId]) {
        labelByCategory[categoryId] = `Category ${categoryId}`;
      }
    }
  } else if (Object.keys(quantitiesByCategory).length === 0 && categoryIds.length) {
    const fallbackCategoryId = String(categoryIds[0]);
    quantitiesByCategory[fallbackCategoryId] = paxSummary.totalForPricing;
    labelByCategory[fallbackCategoryId] = "Passengers";
  }

  return {
    quantitiesByCategory,
    labelByCategory,
    ticketCategoryById,
    participantCountForTier: hasRequestedParticipants
      ? Math.max(1, totalRequestedParticipants)
      : paxSummary.totalForPricing
  };
};

const buildOptionalExtras = ({
  selectedRateDefinition = null,
  bookableExtras = [],
  pax = {},
  priceCategoryParticipants = [],
  defaultCurrency = "USD"
}) => {
  const paxSummary = normalizePax(pax);
  const requestedParticipants = normalizeCategoryParticipants(priceCategoryParticipants);
  const requestedTotal = requestedParticipants.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const participantTotal = Math.max(1, requestedTotal || paxSummary.totalForPricing);
  const extrasById = new Map(
    ensureArray(bookableExtras).map((extra) => [Number(extra.id), extra])
  );

  return ensureArray(selectedRateDefinition?.extraConfigs)
    .filter((config) => String(config.selectionType || "").toUpperCase() === "OPTIONAL")
    .map((config) => {
      const activityExtraId = Number(config.activityExtraId || 0);
      if (!activityExtraId) {
        return null;
      }

      const definition = extrasById.get(activityExtraId);
      const amount = toNumber(definition?.price) ?? 0;
      const pricedPerPerson =
        Boolean(config.pricedPerPerson) || String(definition?.pricingType || "").toUpperCase() === "PER_PERSON";

      let maxQuantity = 1;
      if (pricedPerPerson || definition?.limitByPax === true) {
        maxQuantity = participantTotal;
      } else if (Number(definition?.maxPerBooking || 0) > 0) {
        maxQuantity = Number(definition.maxPerBooking);
      } else {
        maxQuantity = 10;
      }

      return {
        code: String(activityExtraId),
        label: definition?.title || `Extra ${activityExtraId}`,
        description: definition?.information || "",
        amount,
        currency: resolveCurrency(definition?.currency, defaultCurrency),
        pricingType: definition?.pricingType || (pricedPerPerson ? "PER_PERSON" : "PER_BOOKING"),
        pricedPerPerson,
        selectionType: "OPTIONAL",
        maxQuantity
      };
    })
    .filter(Boolean);
};

const mapPricingFromSlot = ({
  slot = {},
  optionRateId = null,
  pax = {},
  priceCategoryParticipants = [],
  priceList = null,
  defaultCurrency = "USD"
}) => {
  const paxSummary = normalizePax(pax);
  const { selectedRatePrice, selectedRateId, selectedRateDefinition } = resolveSelectedRateContext({
    slot,
    optionRateId
  });
  const priceListRate = resolvePriceListRate({ priceList, selectedRateId });

  const currency = resolveCurrency(
    selectedRatePrice?.pricePerBooking?.currency,
    selectedRatePrice?.pricePerBooking?.amount?.currency,
    selectedRatePrice?.pricePerCategoryUnit?.[0]?.amount?.currency,
    priceListRate?.passengers?.[0]?.tieredPrices?.[0]?.currency,
    defaultCurrency
  );

  const lineItems = [];

  const bookingPrice = Number(selectedRatePrice?.pricePerBooking?.amount ?? 0);
  if (bookingPrice > 0) {
    lineItems.push({
      label: selectedRateDefinition?.title || "Base rate",
      quantity: 1,
      unitPrice: bookingPrice,
      total: bookingPrice
    });
  } else {
    const tiersByCategory = new Map();

    ensureArray(selectedRatePrice?.pricePerCategoryUnit).forEach((tier) => {
      const categoryId = String(tier.id || tier.pricingCategoryId || "default");
      if (!tiersByCategory.has(categoryId)) {
        tiersByCategory.set(categoryId, []);
      }

      tiersByCategory.get(categoryId).push(tier);
    });

    const categoryIds = Array.from(tiersByCategory.keys());
    const { quantitiesByCategory, labelByCategory, ticketCategoryById, participantCountForTier } = buildCategoryContext({
      priceListRate,
      paxSummary,
      categoryIds,
      requestedParticipants: priceCategoryParticipants
    });
    const pricedPerPerson = selectedRateDefinition?.pricedPerPerson !== false;
    const priceCategories = [];

    categoryIds.forEach((categoryId) => {
      const quantity = Number(quantitiesByCategory[categoryId] || 0);
      const selectedTier = selectTierEntry(tiersByCategory.get(categoryId), participantCountForTier);
      if (!selectedTier) {
        return;
      }

      const unitPrice = Number(selectedTier.amount || 0);
      if (!Number.isFinite(unitPrice)) {
        return;
      }

      const maxQuantity = Number(selectedRateDefinition?.maxPerBooking || 0) > 0
        ? Number(selectedRateDefinition.maxPerBooking)
        : 50;
      priceCategories.push({
        categoryId,
        title: labelByCategory[categoryId] || `Category ${categoryId}`,
        ticketCategory: ticketCategoryById[categoryId] || "",
        quantity,
        minQuantity: 0,
        maxQuantity
      });

      if (quantity <= 0) {
        return;
      }

      const effectiveQuantity = pricedPerPerson ? quantity : 1;
      const total = unitPrice * effectiveQuantity;

      lineItems.push({
        label: labelByCategory[categoryId] || `Category ${categoryId}`,
        quantity: effectiveQuantity,
        unitPrice,
        total
      });
    });

    const baseAmount = lineItems.reduce((sum, item) => sum + Number(item.total || 0), 0);

    return {
      currency,
      baseAmount,
      extraAmount: 0,
      grossAmount: baseAmount,
      lineItems,
      priceCategories
    };
  }

  const baseAmount = lineItems.reduce((sum, item) => sum + Number(item.total || 0), 0);

  return {
    currency,
    baseAmount,
    extraAmount: 0,
    grossAmount: baseAmount,
    lineItems,
    priceCategories: []
  };
};

const mapActivityAvailability = ({ payload = {}, rawAvailabilities = [], priceList = null, defaultCurrency = "USD" }) => {
  const optionRateId = Number(payload.optionId || 0) || null;
  const selectedCatalog = resolveSelectedPriceCatalog(
    payload.priceCatalogId || "",
    payload.bookablePriceCatalogs || []
  );
  const slotsSource = ensureArray(rawAvailabilities);
  const matchingSlots = slotsSource.filter((slot) => slotSupportsOption(slot, optionRateId));
  const scopedSlots = matchingSlots.length ? matchingSlots : slotsSource;

  const internalSlots = scopedSlots.map((slot) => ({
    raw: slot,
    time: getSlotTime(slot),
    capacityLeft: slot.unlimitedAvailability ? 9999 : Number(slot.availabilityCount || 0),
    status: getSlotStatus(slot)
  }));

  const mergedSlots = new Map();
  internalSlots.forEach((slot) => {
    const existing = mergedSlots.get(slot.time);

    if (!existing) {
      mergedSlots.set(slot.time, {
        time: slot.time,
        capacityLeft: slot.capacityLeft,
        status: slot.status
      });
      return;
    }

    existing.capacityLeft = Math.max(existing.capacityLeft, slot.capacityLeft);
    if (existing.status !== "available") {
      existing.status = slot.status === "available" ? "available" : existing.status === "limited" ? "limited" : slot.status;
    }
  });

  const slots = Array.from(mergedSlots.values());
  const selectedForPricing =
    internalSlots.find((slot) => slot.time === payload.startTime && (slot.status === "available" || slot.status === "limited")) ||
    internalSlots.find((slot) => slot.status === "available" || slot.status === "limited") ||
    internalSlots[0] ||
    null;
  const selectedRateContext = resolveSelectedRateContext({
    slot: selectedForPricing?.raw || {},
    optionRateId
  });

  const pricing = mapPricingFromSlot({
    slot: selectedForPricing?.raw || {},
    optionRateId,
    pax: payload.pax || {},
    priceCategoryParticipants: payload.priceCategoryParticipants || [],
    priceList,
    defaultCurrency
  });

  const extras = buildOptionalExtras({
    selectedRateDefinition: selectedRateContext.selectedRateDefinition,
    bookableExtras: ensureArray(payload.bookableExtras),
    pax: payload.pax || {},
    priceCategoryParticipants: payload.priceCategoryParticipants || [],
    defaultCurrency
  });

  return {
    available: slots.some((slot) => slot.status === "available" || slot.status === "limited"),
    travelDate: payload.travelDate || selectedForPricing?.raw?.date || "",
    optionId: payload.optionId || "",
    priceCatalog: selectedCatalog.selected,
    availablePriceCatalogs: selectedCatalog.available,
    currency: pricing.currency,
    slots,
    priceCategories: pricing.priceCategories || [],
    extras,
    pricing
  };
};

const mapAvailability = (raw = {}) => ({
  available: Boolean(raw.available),
  travelDate: raw.travelDate,
  optionId: raw.optionId,
  priceCatalog: raw.priceCatalog
    ? {
        activityPriceCatalogId: String(raw.priceCatalog.activityPriceCatalogId || ""),
        catalogId: String(raw.priceCatalog.catalogId || ""),
        title: raw.priceCatalog.title || "Default",
        active: raw.priceCatalog.active !== false,
        isVendorDefault: Boolean(raw.priceCatalog.isVendorDefault),
        currency: raw.priceCatalog.currency || "",
        validFrom: raw.priceCatalog.validFrom || null,
        validTo: raw.priceCatalog.validTo || null
      }
    : null,
  availablePriceCatalogs: normalizePriceCatalogs(raw.availablePriceCatalogs || []),
  currency: raw.currency || raw.pricing?.currency || "USD",
  priceCategories: ensureArray(raw.priceCategories).map((category) => ({
    categoryId: String(category.categoryId || category.pricingCategoryId || ""),
    title: category.title || "Category",
    ticketCategory: category.ticketCategory || "",
    quantity: Number(category.quantity || 0),
    minQuantity: Number(category.minQuantity || 0),
    maxQuantity: Number(category.maxQuantity || 50)
  })),
  extras: ensureArray(raw.extras).map((extra) => ({
    code: String(extra.code || ""),
    label: extra.label || "Extra",
    description: extra.description || "",
    amount: Number(extra.amount || 0),
    currency: extra.currency || "USD",
    pricingType: extra.pricingType || "PER_BOOKING",
    pricedPerPerson: Boolean(extra.pricedPerPerson),
    selectionType: extra.selectionType || "OPTIONAL",
    maxQuantity: Number(extra.maxQuantity || 1)
  })),
  slots: (raw.slots || []).map((slot) => ({
    time: slot.time,
    capacityLeft: Number(slot.capacityLeft || 0),
    status: slot.status || "unknown"
  })),
  pricing: {
    currency: raw.pricing?.currency || "USD",
    baseAmount: Number(raw.pricing?.baseAmount || 0),
    extraAmount: Number(raw.pricing?.extraAmount || 0),
    grossAmount: Number(raw.pricing?.grossAmount || 0),
    lineItems: (raw.pricing?.lineItems || []).map((item) => ({
      label: item.label,
      quantity: Number(item.quantity || 0),
      unitPrice: Number(item.unitPrice || 0),
      total: Number(item.total || 0)
    }))
  }
});

const mapBookingQuestion = (rawQuestion = {}) => ({
  id: rawQuestion.id || rawQuestion.questionId,
  label: rawQuestion.label || rawQuestion.title || "Question",
  type: rawQuestion.type || "text",
  scope: rawQuestion.scope || "booking",
  required: Boolean(rawQuestion.required),
  options: rawQuestion.options || []
});

const mapBookingResponse = (raw = {}) => ({
  bokunBookingId: raw.id || raw.bookingId,
  bookingReference: raw.bookingReference || raw.reference,
  confirmationCode: raw.confirmationCode || raw.bookingReference || "",
  status: raw.status || "CONFIRMED",
  travelDate: raw.travelDate,
  startTime: raw.startTime || "",
  productId: raw.productId,
  optionId: raw.optionId,
  customer: raw.customer || {},
  pax: raw.pax || {},
  raw
});

module.exports = {
  mapProduct,
  mapOption,
  mapBokunRatesToPriceCatalogOptions,
  mapBokunPricingCategories,
  mapActivityAvailability,
  mapAvailability,
  mapBookingQuestion,
  mapBookingResponse
};
