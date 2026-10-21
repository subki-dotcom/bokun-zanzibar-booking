// Bókun sends some included/excluded items as codes (FOOD_AND_DRINKS): show them as words ("Food and drinks").
export const humanizeListItem = (value = "") => {
  const text = String(value || "").trim();
  if (!/^[A-Z0-9]+(?:_[A-Z0-9]+)+$/.test(text)) return text;
  const words = text.toLowerCase().split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// Tour badges: categories plus real highlight phrases. Bókun keywords arrive split into single words ("with", "&",
// "Stone"), so one-word highlights are left out; categories are kept as they are.
export const tourBadges = ({ categories = [], highlights = [] } = {}, limit = 7) => {
  const clean = (item) => String(item || "").trim();
  const phrases = (highlights || []).map(clean).filter((item) => /\s/.test(item) && item.length >= 6);
  const seen = new Set();
  return [...(categories || []).map(clean), ...phrases]
    .filter((item) => item && !seen.has(item.toLowerCase()) && seen.add(item.toLowerCase()))
    .slice(0, limit);
};

// A tour includes pickup when any option offers it or Bókun lists pickup places.
export const tourHasPickup = (tour = {}) =>
  (tour.options || []).some((option) => option?.pickupSupported) || (tour.pickupPlaces || []).length > 0;

const itemText = (item) => String(typeof item === "string" ? item : item?.text || item?.title || item?.label || "").trim();

// Important information without generic lines that do not apply: "public transportation nearby" says nothing on a
// tour that collects guests from their hotel.
export const importantInfoForTour = (tour = {}) => {
  const items = Array.isArray(tour.importantInformation) ? tour.importantInformation : [];
  if (!tourHasPickup(tour)) return items;
  return items.filter((item) => !/public transportation is available nearby/i.test(itemText(item)));
};

// Hours in a Bókun duration such as "8 hours", "7 hours and 30 minutes", "55 minutes" or "4 days".
export const durationHours = (duration = "") => {
  const text = String(duration || "").toLowerCase();
  const days = text.match(/(\d+(?:\.\d+)?)\s*days?\b/);
  if (days) return Number(days[1]) * 24;
  const hours = text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
  const minutes = text.match(/(\d+)\s*(?:minutes?|mins?)\b/);
  const total = (hours ? Number(hours[1]) : 0) + (minutes ? Number(minutes[1]) / 60 : 0);
  return total > 0 ? total : null;
};

// "Full day" from 6 hours, "Half day" below, "N-day tour" for multi-day tours; transfers get no day label.
export const durationTag = (duration = "", experienceType = "") => {
  if (/transport|transfer/i.test(experienceType)) return "";
  const hours = durationHours(duration);
  if (hours === null) return "";
  if (hours >= 24) return `${Math.round(hours / 24)}-day tour`;
  return hours >= 6 ? "Full day" : "Half day";
};

// Facts for the checkout header, all taken from the tour itself.
export const checkoutTags = (tour = {}) => {
  const duration = String(tour.duration || "").trim();
  const tag = durationTag(duration, tour.experienceType);
  return [
    duration ? { key: "duration", text: tag ? `${duration} · ${tag}` : duration } : null,
    tourHasPickup(tour) ? { key: "pickup", text: "Hotel pickup" } : null
  ].filter(Boolean);
};

// Excluded items that contradict the tour: when pickup is offered, "pickup" is not listed as excluded.
export const excludedForTour = (excluded = [], hasPickup = false) => {
  const items = Array.isArray(excluded) ? excluded : [];
  return hasPickup ? items.filter((item) => !/\bpick[\s-]?ups?\b/i.test(itemText(item))) : items;
};
