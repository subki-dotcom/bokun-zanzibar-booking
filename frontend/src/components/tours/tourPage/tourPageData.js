// Presentation data for the tour page, derived only from the tour itself (nothing invented).

// "Full-Day Zanzibar Dolphins, Turtle Salaam Cave & Jozani Forest" -> "Dolphins, Turtle Salaam Cave & Jozani Forest".
export const shortTourName = (title = "") => {
  let name = String(title || "").trim();
  for (let i = 0; i < 3; i += 1) {
    name = name.replace(/^(?:(?:full|half)[\s-]day|zanzibar:?|from\s+[^:]+:)\s+/i, "").trim();
  }
  return name || String(title || "").trim();
};

// Breadcrumb group from Bókun's experience type.
export const tourCategoryLabel = (tour = {}) => {
  const type = String(tour.experienceType || "").toLowerCase();
  if (/multi/.test(type)) return "Multi-day tours";
  if (/transport|transfer/.test(type)) return "Transfers";
  if (/day tour|activity/.test(type)) return "Day trips";
  return "Tours";
};

const titleCase = (value = "") =>
  String(value)
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());

// "Kizimkazi & Jozani, Zanzibar" from the itinerary stop locations, or the destination alone.
export const tourLocationLabel = (tour = {}) => {
  const destination = String(tour.destination || "Zanzibar").trim();
  const places = [];
  for (const item of Array.isArray(tour.itineraryItems) ? tour.itineraryItems : []) {
    const first = String(item?.location || "").split(/[,\s]+/).find(Boolean);
    if (!first) continue;
    const place = titleCase(first);
    if (place.toLowerCase() === destination.toLowerCase()) continue;
    if (!places.some((existing) => existing.toLowerCase() === place.toLowerCase())) places.push(place);
  }
  const shown = places.slice(0, 2);
  return shown.length ? `${shown.join(" & ")}, ${destination}` : destination;
};

const imageUrl = (image) => (typeof image === "string" ? image : image?.url || image?.thumbnailUrl || image?.src || "");

// Gallery photos; a photo also used for an itinerary stop is captioned with that stop.
export const galleryPhotos = (tour = {}) => {
  const captions = new Map();
  for (const item of Array.isArray(tour.itineraryItems) ? tour.itineraryItems : []) {
    const url = imageUrl(item?.image);
    if (url && item?.title && !captions.has(url)) captions.set(url, String(item.title).trim());
  }
  const seen = new Set();
  return (Array.isArray(tour.images) ? tour.images : [])
    .map(imageUrl)
    .filter((url) => url && !seen.has(url) && seen.add(url))
    .map((url, index) => ({
      url,
      caption: captions.get(url) || "",
      alt: captions.get(url) || `${String(tour.title || "Tour").trim()} photo ${index + 1}`
    }));
};

// Stars for a rating, as "full" | "half" | "empty".
export const starStates = (rating = 0) =>
  Array.from({ length: 5 }, (_, index) => {
    const value = Number(rating) - index;
    if (value >= 0.75) return "full";
    if (value >= 0.25) return "half";
    return "empty";
  });

export const hasRealReviews = (tour = {}) => Number(tour.reviewCount || 0) > 0 && Number(tour.rating || 0) > 0;
