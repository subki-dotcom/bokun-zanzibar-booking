// The tours page: facts each listing needs (from the product snapshot and the stored Bókun product), and the
// filtering, sorting, paging and counts of the whole catalogue. Pure functions; the service loads and caches the rows.
const { STYLES, matchesSearch, styleKeyFor, titleKey, toHomeCard } = require("./homeCatalog");

const CATEGORY_LABELS = {
  transfers: "Transfer",
  safari: "Safari",
  sea: "Sea tour",
  cultural: "Cultural tour",
  private: "Private tour"
};
// The card's label is the first of these the tour belongs to.
const LABEL_ORDER = ["transfers", "safari", "sea", "cultural", "private"];

const DURATIONS = [
  { key: "short", label: "Up to 4 hours", test: (minutes) => minutes > 0 && minutes <= 240 },
  { key: "half-day", label: "Half day (4–6 h)", test: (minutes) => minutes > 240 && minutes <= 360 },
  { key: "full-day", label: "Full day", test: (minutes) => minutes > 360 && minutes <= 1440 },
  { key: "multi-day", label: "Multi-day", test: (minutes) => minutes > 1440 }
];

const TIMES = [
  { key: "morning", label: "Morning", test: (minute) => minute < 12 * 60 },
  { key: "afternoon", label: "Afternoon", test: (minute) => minute >= 12 * 60 && minute < 17 * 60 },
  { key: "evening", label: "Sunset & evening", test: (minute) => minute >= 17 * 60 }
];

const GOOD_TO_KNOW = [
  { key: "free-cancellation", label: "Free cancellation", fact: "freeCancellation" },
  { key: "pickup", label: "Hotel pickup included", fact: "pickup" },
  { key: "private", label: "Private tour", fact: "privateTour" },
  { key: "lunch", label: "Lunch included", fact: "lunch" }
];

const SORTS = ["recommended", "price_asc", "price_desc", "duration_asc", "duration_desc", "title_asc"];
const PAGE_SIZE = 9;

// "8 hours", "1 hour and 30 minutes", "2 days", "45 min" → minutes.
const minutesFromText = (text = "") => {
  const value = String(text).toLowerCase();
  const number = (pattern) => Number((value.match(pattern) || [])[1] || 0);
  const minutes =
    number(/(\d+(?:\.\d+)?)\s*(?:weeks?|wk)/) * 7 * 1440 +
    number(/(\d+(?:\.\d+)?)\s*days?/) * 1440 +
    number(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h\b)/) * 60 +
    number(/(\d+)\s*(?:minutes?|mins?|m\b)/);
  return Math.round(minutes);
};

// Bókun's duration fields, or the duration text when they are missing.
const durationMinutes = (raw = {}, text = "") => {
  const fromFields =
    (Number(raw.durationWeeks) || 0) * 7 * 1440 +
    (Number(raw.durationDays) || 0) * 1440 +
    (Number(raw.durationHours) || 0) * 60 +
    (Number(raw.durationMinutes) || 0);
  return fromFields > 0 ? fromFields : minutesFromText(text);
};

// Free cancellation when the policy has a no-charge period (e.g. "free until 24 hours before"); the text is the
// fallback for products without rules.
const freeCancellation = (raw = {}, policyText = "") => {
  const rules = Array.isArray(raw.cancellationPolicy?.penaltyRules) ? raw.cancellationPolicy.penaltyRules : [];
  if (rules.length) return rules.some((rule) => Number(rule.percentage ?? rule.charge) === 0);
  return /free cancellation/i.test(String(policyText));
};

const PICKUP_TYPES = new Set(["PICK_UP", "MEET_ON_LOCATION_OR_PICK_UP"]);

// What the filters and the card need to know about one product.
const listingFacts = (row = {}) => {
  const raw = row.rawBokunProduct || {};
  const options = Array.isArray(row.options) ? row.options.filter((option) => option?.active !== false) : [];
  const included = (Array.isArray(row.included) ? row.included : []).join(" ");
  return {
    durationMinutes: durationMinutes(raw, row.duration),
    startMinutes: (Array.isArray(raw.startTimes) ? raw.startTimes : [])
      .map((time) => Number(time?.hour) * 60 + Number(time?.minute || 0))
      .filter((minute) => Number.isFinite(minute))
      .sort((a, b) => a - b),
    freeCancellation: freeCancellation(raw, row.cancellationPolicy),
    pickup: PICKUP_TYPES.has(String(raw.meetingType || "")) || options.some((option) => option.pickupSupported),
    privateTour: raw.privateActivity === true || /\bprivate\b/i.test(String(row.title || "")),
    lunch: /\blunch\b/i.test(included)
  };
};

// One card on the tours page: the home page card plus its category label, facts and review source.
const toListingCard = (row = {}) => {
  const card = toHomeCard(row);
  const facts = listingFacts(row);
  const labelKey = LABEL_ORDER.find((key) => card.styles.includes(key)) || "";
  const topRated = card.reviewCount >= 5 && card.rating >= 4.5;
  return {
    ...card,
    category: labelKey ? { key: labelKey, label: CATEGORY_LABELS[labelKey] } : null,
    badge: topRated ? "Top rated" : card.badge,
    meta: facts.pickup ? "Hotel pickup" : "Meeting point",
    freeCancellation: facts.freeCancellation,
    reviewSource: card.reviewCount ? String(row.reviewSource || "") : "",
    facts,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).getTime() : 0
  };
};

// Same title (ignoring words like "Zanzibar" or "tour"): one listing only, the one with the most bookings, then photos.
const withoutRepeatedTitles = (cards = [], bookings = new Map()) => {
  const best = new Map();
  const score = (card) => (bookings.get(card.id) || 0) * 1000 + card.images;
  cards.forEach((card) => {
    const key = titleKey(card.title);
    const current = best.get(key);
    if (!current || score(card) > score(current)) best.set(key, card);
  });
  const keep = new Set([...best.values()].map((card) => card.id));
  return cards.filter((card) => keep.has(card.id));
};

const listOf = (value) =>
  (Array.isArray(value) ? value : String(value || "").split(","))
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean);

// Query values → clean filters. Unknown values are dropped, so a hand-edited address cannot break the page.
const readFilters = (query = {}) => {
  const [low, high] = String(query.price || "").split("-").map((value) => Number(value));
  const page = Math.max(1, Math.min(50, Number.parseInt(query.page, 10) || 1));
  return {
    category: styleKeyFor(query.category || ""),
    q: String(query.q || "").slice(0, 80),
    duration: listOf(query.duration).filter((key) => DURATIONS.some((item) => item.key === key)),
    time: listOf(query.time).filter((key) => TIMES.some((item) => item.key === key)),
    good: listOf(query.good).filter((key) => GOOD_TO_KNOW.some((item) => item.key === key)),
    priceMin: Number.isFinite(low) && low > 0 ? low : 0,
    priceMax: Number.isFinite(high) && high > 0 ? high : 0,
    sort: SORTS.includes(query.sort) ? query.sort : "recommended",
    page,
    limit: Math.max(1, Math.min(60, Number.parseInt(query.limit, 10) || PAGE_SIZE))
  };
};

const passes = (card, filters, { skipCategory = false } = {}) => {
  if (!skipCategory && filters.category && !card.styles.includes(filters.category)) return false;
  if (filters.q && !matchesSearch({ title: card.title, shortDescription: card.summary }, filters.q)) return false;
  if (filters.duration.length && !filters.duration.some((key) => DURATIONS.find((item) => item.key === key).test(card.facts.durationMinutes))) return false;
  if (filters.time.length && !filters.time.some((key) => card.facts.startMinutes.some(TIMES.find((item) => item.key === key).test))) return false;
  if (filters.good.some((key) => !card.facts[GOOD_TO_KNOW.find((item) => item.key === key).fact])) return false;
  if (filters.priceMin && !(card.fromPrice >= filters.priceMin)) return false;
  if (filters.priceMax && !(card.fromPrice > 0 && card.fromPrice <= filters.priceMax)) return false;
  return true;
};

const sorters = (bookings) => ({
  recommended: (a, b) =>
    (bookings.get(b.id) || 0) - (bookings.get(a.id) || 0) || b.reviewCount - a.reviewCount || b.images - a.images || b.updatedAt - a.updatedAt,
  price_asc: (a, b) => (a.fromPrice || Infinity) - (b.fromPrice || Infinity),
  price_desc: (a, b) => (b.fromPrice || 0) - (a.fromPrice || 0),
  duration_asc: (a, b) => (a.facts.durationMinutes || Infinity) - (b.facts.durationMinutes || Infinity),
  duration_desc: (a, b) => (b.facts.durationMinutes || 0) - (a.facts.durationMinutes || 0),
  title_asc: (a, b) => a.title.localeCompare(b.title)
});

// The page of results, how many in all, and what the filter panel can offer (counts and the price range come from
// the whole catalogue, so they do not jump as filters change).
const searchCatalog = (cards = [], query = {}, bookings = new Map()) => {
  const filters = readFilters(query);
  const matching = cards.filter((card) => passes(card, filters)).sort(sorters(bookings)[filters.sort]);
  const prices = cards.map((card) => card.fromPrice).filter((price) => price > 0);
  const end = filters.page * filters.limit;
  return {
    items: matching.slice(end - filters.limit, end).map(({ facts, updatedAt, ...card }) => ({
      ...card,
      durationMinutes: facts.durationMinutes
    })),
    total: matching.length,
    page: filters.page,
    limit: filters.limit,
    pages: Math.max(1, Math.ceil(matching.length / filters.limit)),
    filters: { ...filters, category: filters.category ? STYLES.find((style) => style.key === filters.category).label : "" },
    facets: {
      total: cards.length,
      categories: STYLES.map((style) => ({ key: style.key, label: style.label, count: cards.filter((card) => card.styles.includes(style.key)).length })).filter(
        (row) => row.count > 0
      ),
      price: { min: prices.length ? Math.floor(Math.min(...prices)) : 0, max: prices.length ? Math.ceil(Math.max(...prices)) : 0 },
      durations: DURATIONS.filter((item) => cards.some((card) => item.test(card.facts.durationMinutes))).map(({ key, label }) => ({ key, label })),
      times: TIMES.filter((item) => cards.some((card) => card.facts.startMinutes.some(item.test))).map(({ key, label }) => ({ key, label })),
      good: GOOD_TO_KNOW.filter((item) => cards.some((card) => card.facts[item.fact])).map(({ key, label }) => ({ key, label }))
    }
  };
};

module.exports = {
  DURATIONS,
  TIMES,
  GOOD_TO_KNOW,
  SORTS,
  minutesFromText,
  listingFacts,
  toListingCard,
  withoutRepeatedTitles,
  readFilters,
  searchCatalog
};
