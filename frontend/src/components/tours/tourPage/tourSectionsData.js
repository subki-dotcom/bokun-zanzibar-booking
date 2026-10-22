// Content for the tour page sections, built only from the tour's real data. A fact that is not true or not known is
// left out rather than guessed.
import { durationTag, humanizeListItem, excludedForTour, tourHasPickup } from "../single/tourDisplayText.js";
import { pickupAreaFromOption } from "../../../utils/pickupPlaces.js";
import { cancellationDisplayText } from "../../../utils/cancellationPolicy.js";

const plain = (value = "") =>
  String(value || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .trim();

// "24 hours" from "Free cancellation is available until 24 hours before departure."
export const freeCancellationWindow = (summary = "") => {
  const match = String(summary || "").match(/free cancellation is available until\s+(.+?)\s+before\b/i);
  return match ? match[1].trim() : "";
};

const groupMax = (groupSize = "") => {
  const numbers = String(groupSize || "").match(/\d+/g);
  return numbers ? Math.max(...numbers.map(Number)) : 0;
};

export const keyFacts = (tour = {}) => {
  const facts = [];
  const duration = String(tour.duration || "").trim();
  if (duration) {
    const tag = durationTag(duration, tour.experienceType);
    facts.push({ id: "duration", icon: "clock", title: duration, detail: tag ? `${tag}, approx.` : "Approx." });
  }
  const window = freeCancellationWindow(tour.cancellationPolicy);
  if (window) facts.push({ id: "cancellation", icon: "check", title: "Free cancellation", detail: `Up to ${window} before` });
  if (tourHasPickup(tour)) facts.push({ id: "pickup", icon: "bus", title: "Hotel pickup", detail: "Choose your hotel at checkout" });
  facts.push({ id: "confirmation", icon: "shield", title: "Email confirmation", detail: "Sent after payment" });
  const guide = tour.liveTourGuide || {};
  const languages = (guide.languages && guide.languages.length ? guide.languages : tour.languages || []).filter(Boolean);
  if (guide.supported || languages.length) {
    facts.push({ id: "guide", icon: "message", title: guide.supported ? "Live guide" : "Languages", detail: languages.join(", ") || "Guided" });
  }
  const max = groupMax(tour.groupSize);
  if (max > 0) facts.push({ id: "group", icon: "users", title: max <= 15 ? "Small group" : "Group size", detail: `Max ${max} travelers` });
  return facts;
};

// Overview paragraphs from the description (HTML or text).
export const overviewParagraphs = (tour = {}) =>
  plain(tour.description || tour.shortDescription || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

export const includedLists = (tour = {}) => ({
  included: (tour.included || []).map((item) => humanizeListItem(plain(item))).filter(Boolean),
  excluded: excludedForTour(tour.excluded || [], tourHasPickup(tour)).map((item) => humanizeListItem(plain(item))).filter(Boolean)
});

// Itinerary stops in their Bókun order (day, then index; ties keep Bókun's order).
export const itineraryStops = (tour = {}) => {
  const items = Array.isArray(tour.itineraryItems) ? tour.itineraryItems : [];
  if (items.length) {
    return items
      .map((item, position) => ({ item, position }))
      .sort((a, b) => (Number(a.item.day) || 0) - (Number(b.item.day) || 0) || (Number(a.item.index) || 0) - (Number(b.item.index) || 0) || a.position - b.position)
      .map(({ item }) => ({
        title: plain(item.title),
        description: plain(item.description),
        image: typeof item.image === "string" ? item.image : item.image?.url || "",
        meta: [plain(item.duration), plain(item.admission)].filter(Boolean)
      }))
      .filter((stop) => stop.title || stop.description);
  }
  return (Array.isArray(tour.itinerary) ? tour.itinerary : [])
    .map((text) => plain(text))
    .filter(Boolean)
    .map((description) => ({ title: "", description, image: "", meta: [] }));
};

// "Kizimkazi hotels, or any Zanzibar hotel" from the option names.
export const pickupAreasText = (tour = {}) => {
  if (!tourHasPickup(tour)) return "";
  const areas = [];
  for (const option of (tour.options || []).filter((item) => item?.active !== false)) {
    const area = pickupAreaFromOption(option?.name);
    if (area) areas.push(`${area} hotels`);
    else if (/pick-?\s*up\s+from\s+(any|all)\b/i.test(option?.name || "")) areas.push(`any ${tour.destination || "Zanzibar"} hotel`);
  }
  const unique = [...new Set(areas)];
  if (!unique.length) return plain(tour.pickupInfo) || `Pickup from hotels in ${tour.destination || "Zanzibar"}.`;
  return unique.length === 1 ? unique[0] : `${unique.slice(0, -1).join(", ")}, or ${unique[unique.length - 1]}`;
};

// The cancellation policy as one sentence (no supplier labels), with the free-cancellation window to emphasise.
export const cancellationText = (tour = {}) => {
  const text = cancellationDisplayText(tour.cancellationPolicy || "");
  return { text, emphasis: freeCancellationWindow(text) };
};
