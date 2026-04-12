import { formatCurrency, toPlainText, truncateText } from "../../../utils/formatters";

const clampNumber = (value, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Math.min(max, Math.max(min, Number(value || 0)));

const parseFirstNumber = (value = "") => {
  const match = String(value || "").match(/(\d+(\.\d+)?)/);
  return match ? Number(match[1]) : 0;
};

const parseFirstFiniteNumber = (...candidates) => {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === "") {
      continue;
    }

    const normalized = typeof candidate === "string" ? candidate.replace(/,/g, "").trim() : candidate;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }

    if (typeof normalized === "string") {
      const token = parseFirstNumber(normalized);
      if (Number.isFinite(token) && token > 0) {
        return token;
      }
    }
  }

  return 0;
};

const resolveLowestOptionPrice = (options = []) => {
  const rows = Array.isArray(options) ? options : [];
  const amounts = rows
    .map((option = {}) =>
      parseFirstFiniteNumber(
        option.fromPrice,
        option.priceFrom,
        option.lowestPrice,
        option.price?.amount,
        option.pricingSummary
      )
    )
    .filter((amount) => Number.isFinite(amount) && amount > 0);

  return amounts.length ? Math.min(...amounts) : 0;
};

export const resolveSafeText = (value, fallback = "") => {
  const token = String(value || "").trim();
  return token || fallback;
};

export const formatListingDuration = (value = "") => {
  const token = resolveSafeText(value, "Flexible duration");
  return token;
};

const normalizePricingType = (tour = {}) => {
  const explicit = String(tour.pricingType || "").toLowerCase();
  if (explicit === "per_person" || explicit === "per_group") {
    return explicit;
  }

  const optionHint = String(
    tour.options?.[0]?.pricingSummary || tour.options?.[0]?.pricingType || ""
  ).toLowerCase();

  if (optionHint.includes("group") || optionHint.includes("private")) {
    return "per_group";
  }

  return "per_person";
};

const resolveBadge = (tour = {}) => {
  if (tour.bestseller || tour.bestSeller) {
    return "Best Seller";
  }

  if (tour.featured) {
    return "Featured";
  }

  if (tour.likelyToSellOut) {
    return "Likely to sell out";
  }

  if (tour.instantConfirmation) {
    return "Instant confirmation";
  }

  if (tour.badge) {
    return String(tour.badge);
  }

  const title = String(tour.title || tour.name || "").toLowerCase();
  const categories = (tour.categories || []).map((item) => String(item || "").toLowerCase());

  if (categories.some((item) => item.includes("best")) || title.includes("best")) return "Best Seller";
  if (categories.some((item) => item.includes("new")) || title.includes("new")) return "New";
  if (categories.some((item) => item.includes("private")) || title.includes("private")) return "Private";

  return "";
};

export const formatListingPrice = ({
  fromPrice = 0,
  currency = "USD",
  pricingType = "per_person"
} = {}) => {
  const safePrice = Number(fromPrice || 0);
  if (!Number.isFinite(safePrice) || safePrice <= 0) {
    return {
      heading: "",
      subtext: "",
      hasPrice: false
    };
  }

  const suffix = pricingType === "per_group" ? "/ group" : "/ person";
  return {
    heading: `From ${formatCurrency(safePrice, currency)}`,
    subtext: suffix,
    hasPrice: true
  };
};

export const mapBokunTourForListing = (tour = {}) => {
  const imageValue = Array.isArray(tour.images) ? tour.images[0] : "";
  const imageUrl =
    typeof imageValue === "string"
      ? imageValue
      : imageValue?.url || imageValue?.thumbnailUrl || imageValue?.src || "";
  const resolvedPrice = parseFirstFiniteNumber(
    tour.fromPrice,
    tour.priceFrom,
    tour.lowestPrice,
    tour.price?.amount,
    tour.pricingSummary,
    resolveLowestOptionPrice(tour.options)
  );
  const rating = parseFirstFiniteNumber(
    tour.rating,
    tour.ratingAverage,
    tour.reviewRating,
    tour.averageRating,
    tour.ratingData?.average,
    tour.reviewStats?.ratingAverage,
    tour.reviews?.average
  );
  const reviewCount = Math.max(
    0,
    Math.round(
      parseFirstFiniteNumber(
        tour.reviewCount,
        tour.totalReviews,
        tour.reviewsCount,
        tour.reviewStats?.count,
        tour.reviews?.count
      )
    )
  );
  const description = truncateText(
    toPlainText(tour.shortDescription || tour.excerpt || tour.description || ""),
    150
  );

  return {
    id: String(tour.bokunProductId || tour.id || tour.slug || ""),
    slug: resolveSafeText(tour.slug, String(tour.bokunProductId || tour.id || "")),
    title: resolveSafeText(tour.title || tour.name, "Untitled experience"),
    shortDescription: resolveSafeText(description, "Discover this Zanzibar experience."),
    durationText: formatListingDuration(tour.duration || tour.durationText),
    locationText: resolveSafeText(tour.destination || tour.location || tour.locationText, "Zanzibar"),
    fromPrice: resolvedPrice,
    pricingType: normalizePricingType(tour),
    currency: resolveSafeText(tour.currency, "USD"),
    badge: resolveBadge(tour) || "",
    image: resolveSafeText(
      imageUrl,
      "https://images.unsplash.com/photo-1518544866330-95a67b1b5f39?auto=format&fit=crop&w=1200&q=80"
    ),
    categories: Array.isArray(tour.categories) ? tour.categories.filter(Boolean) : [],
    rating,
    reviewCount
  };
};

export const mapBokunRatesToPriceCatalogOptions = (rateRows = []) =>
  (rateRows || [])
    .map((row) => ({
      id: String(row?.id || row?.catalogId || row?.activityPriceCatalogId || ""),
      label: row?.label || row?.title || "Default"
    }))
    .filter((row) => row.id);

export const mapBokunPricingCategories = (categories = []) =>
  (categories || [])
    .map((row) => ({
      id: String(row?.categoryId || row?.id || ""),
      label: row?.title || row?.label || "Passenger",
      min: clampNumber(row?.minQuantity || row?.min || 0, 0, 20),
      defaultQuantity: clampNumber(row?.quantity || row?.defaultQuantity || 0, 0, 20)
    }))
    .filter((row) => row.id);

export const getDurationBucket = (durationText = "") => {
  const token = String(durationText || "").toLowerCase();
  if (!token || token.includes("flex")) return "flexible";

  if (token.includes("day")) {
    const days = parseFirstNumber(token);
    if (days > 1) return "multi_day";
    return "full_day";
  }

  if (token.includes("hour") || token.includes("hr")) {
    const hours = parseFirstNumber(token);
    if (hours > 8) return "full_day";
    if (hours > 4) return "half_day";
    return "short";
  }

  return "flexible";
};

const includesQuery = (tour = {}, query = "") => {
  if (!query) return true;
  const haystack = `${tour.title} ${tour.shortDescription} ${tour.locationText} ${(tour.categories || []).join(" ")}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
};

export const applyListingFiltersAndSort = (items = [], filters = {}) => {
  const {
    query = "",
    category = "all",
    duration = "all",
    sort = "recommended"
  } = filters;

  let rows = [...(items || [])].filter((item) => includesQuery(item, query));

  if (category && category !== "all") {
    rows = rows.filter((item) =>
      (item.categories || []).some((entry) => String(entry || "").toLowerCase() === String(category).toLowerCase())
    );
  }

  if (duration && duration !== "all") {
    rows = rows.filter((item) => getDurationBucket(item.durationText) === duration);
  }

  const byPriceAsc = (a, b) => Number(a.fromPrice || 0) - Number(b.fromPrice || 0);
  const byDurationAsc = (a, b) => parseFirstNumber(a.durationText) - parseFirstNumber(b.durationText);

  if (sort === "price_low_high") {
    rows.sort(byPriceAsc);
  } else if (sort === "price_high_low") {
    rows.sort((a, b) => byPriceAsc(b, a));
  } else if (sort === "duration_short_long") {
    rows.sort(byDurationAsc);
  } else if (sort === "duration_long_short") {
    rows.sort((a, b) => byDurationAsc(b, a));
  } else if (sort === "title_a_z") {
    rows.sort((a, b) => a.title.localeCompare(b.title));
  }

  return rows;
};

export const buildCategoryFilterOptions = (items = []) => {
  const set = new Set();
  (items || []).forEach((item) => {
    (item.categories || []).forEach((category) => {
      const token = String(category || "").trim();
      if (token) set.add(token);
    });
  });

  return Array.from(set).sort((a, b) => a.localeCompare(b));
};

export const buildVisiblePages = ({ page = 1, totalPages = 1 } = {}) => {
  const safeTotal = Math.max(1, Number(totalPages || 1));
  const current = Math.max(1, Math.min(safeTotal, Number(page || 1)));
  const start = Math.max(1, current - 2);
  const end = Math.min(safeTotal, start + 4);
  const adjustedStart = Math.max(1, end - 4);
  const pages = [];

  for (let index = adjustedStart; index <= end; index += 1) {
    pages.push(index);
  }

  return pages;
};
