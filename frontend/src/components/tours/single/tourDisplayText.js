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
