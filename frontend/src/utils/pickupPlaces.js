// Pickup hotels for the chosen option. Bokun lists pickup places for the whole product, not per option, so an option
// named "Pickup from <area> hotels" keeps the places in that area (when any match); "any hotels" keeps all of them.
export const pickupAreaFromOption = (optionName = "") => {
  const match = String(optionName || "").match(/pick-?\s*up\s+from\s+(.+?)\s+hotels?\b/i);
  if (!match) return "";
  const area = match[1].trim();
  return /^(any|all)$/i.test(area) ? "" : area;
};

const placeKey = (place = {}) =>
  [place.title, place.address].map((value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ")).join("|");

export const pickupPlacesForOption = (places = [], optionName = "") => {
  const seen = new Set();
  const unique = (Array.isArray(places) ? places : []).filter((place) => {
    const key = placeKey(place);
    if (!String(place?.title || "").trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const area = pickupAreaFromOption(optionName).toLowerCase();
  const inArea = area
    ? unique.filter((place) => `${place.title || ""} ${place.address || ""}`.toLowerCase().includes(area))
    : [];
  const list = inArea.length ? inArea : unique;
  return [...list].sort((a, b) => String(a.title).localeCompare(String(b.title)));
};
