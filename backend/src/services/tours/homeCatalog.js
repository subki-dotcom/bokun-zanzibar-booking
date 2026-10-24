// Pure rules for the home page: which travel style a tour belongs to, the card each tour shows, and how featured
// and best-selling tours are picked. Built only from the tour's own data (nothing invented).

const STYLES = [
  { key: "sea", label: "Sea tours", subtitle: "Mnemba, sandbanks, dolphins", cardType: "Boat trip" },
  { key: "cultural", label: "Cultural tours", subtitle: "Stone Town, spice farms", cardType: "Culture" },
  { key: "safari", label: "Safari trips", subtitle: "Serengeti, Ngorongoro, Tarangire", cardType: "Safari from Zanzibar" },
  { key: "private", label: "Private tours", subtitle: "Your own guide & car", cardType: "Private tour" },
  { key: "transfers", label: "Transfers", subtitle: "Airport & ferry to hotel", cardType: "Private car" }
];

const RULES = {
  transfers: /\btransfers?\b/i,
  safari: /\bsafari\b|serengeti|ngorongoro|tarangire|mikumi|selous|nyerere|manyara/i,
  sea: /mnemba|sandbank|nakupenda|dolphin|snorkel|dhow|lagoon|reef|turtle swim|kayak|boat/i,
  cultural: /stone town|spice|cooking|village|heritage|cultur|histor/i,
  private: /\bprivate\b/i
};

const text = (value) => String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

// The styles a tour belongs to (a tour can be in several, for example a private Stone Town walk).
const tourStyles = (tour = {}) => {
  const haystack = text(tour.title);
  if (RULES.transfers.test(haystack)) return ["transfers"];
  const styles = STYLES.map((style) => style.key).filter((key) => key !== "transfers" && RULES[key].test(haystack));
  // Prison Island alone is a boat trip; with Stone Town or a spice farm it is a culture day.
  if (/prison island/i.test(haystack) && !styles.includes("sea") && !styles.includes("cultural")) styles.unshift("sea");
  return styles;
};

// Short facts for a safari, only from what the product includes.
const SAFARI_FACTS = [
  [/flight/i, "Fly-in from Zanzibar"],
  [/guide/i, "Professional safari guides"],
  [/4x4|game drive/i, "4x4 safari vehicles"],
  [/park.*fee|entry fee/i, "Park fees included"],
  [/full.?board|meals/i, "Full board on safari"],
  [/lodge|camp|accommodation/i, "Lodges & camps"]
];
const safariFacts = (included = []) => {
  const items = (Array.isArray(included) ? included : []).map(text);
  return SAFARI_FACTS.filter(([pattern]) => items.some((item) => pattern.test(item))).map(([, label]) => label).slice(0, 3);
};

const firstImage = (tour = {}) => {
  const image = Array.isArray(tour.images) ? tour.images[0] : tour.image;
  return typeof image === "string" ? image : image?.url || image?.src || "";
};

// "3 hours", "2 days", "1 h 10 min".
const shortDuration = (value = "") =>
  text(value)
    .replace(/(\d+)\s*hours?\s+and\s+(\d+)\s*minutes?/i, "$1 h $2 min")
    .replace(/(\d+)\s*hours?/i, (match, n) => `${n} hour${n === "1" ? "" : "s"}`);

const daysIn = (duration = "") => {
  const match = text(duration).match(/(\d+)\s*days?/i);
  return match ? Number(match[1]) : 0;
};

const hasPickup = (tour = {}) =>
  (Array.isArray(tour.options) ? tour.options : []).some((option) => option?.active !== false && option?.pickupSupported) ||
  /pick-?\s*up/i.test(text(tour.pickupInfo));

const pricingUnit = (tour = {}) => {
  const types = (Array.isArray(tour.options) ? tour.options : []).map((option) => String(option?.pricingType || "")).filter(Boolean);
  return types.length && types.every((type) => /group|booking/i.test(type)) ? "group" : "person";
};

// A factual badge: multi-day, private, lunch, safari or instant confirmation (never "New").
const badgeFor = (tour = {}, styles = []) => {
  const days = daysIn(tour.duration);
  if (styles.includes("safari")) return days > 1 ? "Fly-in safari" : "Day safari";
  if (days > 1) return `${days} days`;
  if (styles.includes("private")) return "Private";
  if (/lunch/i.test(`${text(tour.title)} ${(tour.included || []).map(text).join(" ")}`)) return "Lunch included";
  if (styles.includes("transfers")) return "Instant confirmation";
  return "";
};

// The card the home page shows for a tour.
const toHomeCard = (tour = {}) => {
  const styles = tourStyles(tour);
  const primary = STYLES.find((style) => style.key === (styles.includes("private") && styles.length > 1 ? styles.find((key) => key !== "private") : styles[0]));
  const reviewCount = Number(tour.reviewCount || 0);
  return {
    id: String(tour.bokunProductId || ""),
    slug: String(tour.slug || ""),
    title: text(tour.title),
    summary: text(tour.shortDescription || tour.description).slice(0, 180),
    image: firstImage(tour),
    images: Array.isArray(tour.images) ? tour.images.length : 0,
    fromPrice: Number(tour.fromPrice || 0) > 0 ? Number(tour.fromPrice) : 0,
    currency: String(tour.currency || "USD"),
    unit: pricingUnit(tour),
    duration: shortDuration(tour.duration),
    meta: [shortDuration(tour.duration), styles.includes("private") ? "Private tour" : primary?.cardType || "", hasPickup(tour) && !styles.includes("transfers") ? "Hotel pickup" : ""]
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index),
    styles,
    badge: badgeFor(tour, styles),
    rating: reviewCount > 0 && Number(tour.rating) > 0 ? Number(Number(tour.rating).toFixed(1)) : 0,
    reviewCount: reviewCount > 0 ? reviewCount : 0,
    featured: Boolean(tour.featuredOnHome),
    facts: styles.includes("safari") ? safariFacts(tour.included) : []
  };
};

const titleKey = (title = "") => text(title).toLowerCase().replace(/^zanzibar:?\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();

// Cards that can be shown: a photo and a real price, one per title (the same tour is listed twice in some places).
const showable = (cards = [], bookings = new Map()) => {
  const byTitle = new Map();
  for (const card of cards) {
    if (!card.image || !card.fromPrice || !card.slug) continue;
    const key = titleKey(card.title);
    const current = byTitle.get(key);
    const score = (item) => (bookings.get(item.id) || 0) * 1000 + item.images;
    if (!current || score(card) > score(current)) byTitle.set(key, card);
  }
  return [...byTitle.values()];
};

// Featured: the tours staff marked, else the most booked across styles (one style at a time, so the row is varied).
const pickFeatured = (cards = [], bookings = new Map(), limit = 6) => {
  const marked = cards.filter((card) => card.featured);
  if (marked.length) return { source: "admin", tours: marked.slice(0, limit) };
  const ranked = [...cards].sort((a, b) => (bookings.get(b.id) || 0) - (bookings.get(a.id) || 0) || b.images - a.images);
  const picked = [];
  const order = ["sea", "cultural", "private", "sea", "transfers", "safari", "cultural", "sea"];
  for (const style of order) {
    const next = ranked.find((card) => card.styles.includes(style) && !picked.includes(card));
    if (next) picked.push(next);
    if (picked.length >= limit) break;
  }
  for (const card of ranked) {
    if (picked.length >= limit) break;
    if (!picked.includes(card)) picked.push(card);
  }
  return { source: "auto", tours: picked.slice(0, limit) };
};

// Best sellers: real bookings first, never a tour already featured.
const pickBestSellers = (cards = [], bookings = new Map(), exclude = [], limit = 4) => {
  const skip = new Set(exclude.map((card) => card.id));
  const ranked = cards
    .filter((card) => !skip.has(card.id) && !card.styles.includes("safari"))
    .sort((a, b) => (bookings.get(b.id) || 0) - (bookings.get(a.id) || 0) || b.images - a.images)
    .slice(0, limit);
  return ranked.map((card, index) => ({
    ...card,
    badge: index === 0 && (bookings.get(card.id) || 0) > 0 ? "Best seller" : card.styles.includes("private") ? "Private" : (bookings.get(card.id) || 0) > 0 ? "Popular" : card.badge
  }));
};

// The five style tiles with their real count (hidden when empty) and, for transfers, the lowest price.
// Each tile gets its own cover: a tour of that style only when possible, the one with most photos, never reused.
const styleTiles = (cards = []) => {
  const usedCovers = new Set();
  return STYLES.map((style) => {
    const members = cards.filter((card) => card.styles.includes(style.key));
    const cheapest = members.filter((card) => card.fromPrice > 0).reduce((low, card) => (!low || card.fromPrice < low.fromPrice ? card : low), null);
    const cover = members
      .filter((card) => card.image && !usedCovers.has(card.image))
      .sort((a, b) => a.styles.length - b.styles.length || b.images - a.images)[0];
    if (cover) usedCovers.add(cover.image);
    return {
      key: style.key,
      label: style.label,
      subtitle: style.subtitle,
      count: members.length,
      fromPrice: cheapest?.fromPrice || 0,
      currency: cheapest?.currency || "USD",
      image: cover?.image || ""
    };
  }).filter((tile) => tile.count > 0);
};

module.exports = { STYLES, safariFacts, tourStyles, toHomeCard, showable, pickFeatured, pickBestSellers, styleTiles, titleKey };
