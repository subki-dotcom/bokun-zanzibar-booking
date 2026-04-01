import { formatCurrency, toPlainText, truncateText } from "../../../utils/formatters";

const clampNumber = (value, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Math.min(max, Math.max(min, Number(value || 0)));

const parseFirstNumber = (value = "") => {
  const match = String(value || "").match(/(\d+(\.\d+)?)/);
  return match ? Number(match[1]) : 0;
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
  if (tour.badge) {
    return String(tour.badge);
  }

  const title = String(tour.title || "").toLowerCase();
  const categories = (tour.categories || []).map((item) => String(item || "").toLowerCase());

  if (categories.some((item) => item.includes("best")) || title.includes("best")) return "Best Seller";
  if (categories.some((item) => item.includes("new")) || title.includes("new")) return "New";
  if (categories.some((item) => item.includes("private")) || title.includes("private")) return "Private";

  return "Live Pricing";
};

export const mapBokunTourForListing = (tour = {}) => {
  const description = truncateText(
    toPlainText(tour.shortDescription || tour.description || ""),
    170
  );

  return {
    id: String(tour.bokunProductId || tour.id || tour.slug || ""),
    slug: tour.slug || "",
    title: tour.title || "Untitled experience",
    shortDescription: description,
    durationText: tour.duration || "Flexible duration",
    locationText: tour.destination || "Zanzibar",
    fromPrice: Number(tour.fromPrice || 0),
    pricingType: normalizePricingType(tour),
    currency: tour.currency || "USD",
    badge: resolveBadge(tour),
    image:
      tour.images?.[0] ||
      "https://images.unsplash.com/photo-1518544866330-95a67b1b5f39?auto=format&fit=crop&w=1200&q=80",
    categories: Array.isArray(tour.categories) ? tour.categories.filter(Boolean) : []
  };
};

export const formatPriceLabel = ({ fromPrice = 0, currency = "USD", pricingType = "per_person" } = {}) => {
  const safePrice = Number(fromPrice || 0);
  if (!Number.isFinite(safePrice) || safePrice <= 0) {
    return {
      heading: "Check live pricing",
      subtext: "Live pricing and availability"
    };
  }

  const suffix = pricingType === "per_group" ? "per group" : "per person";
  return {
    heading: `From ${formatCurrency(safePrice, currency)}`,
    subtext: suffix
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
