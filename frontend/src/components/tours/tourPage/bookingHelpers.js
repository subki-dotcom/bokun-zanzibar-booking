// Pure helpers for the tour page booking (no imports, so they can be tested directly).

// Traveller categories from the booking configuration (real age bands), keeping Bókun's ticket category.
export const travellerCategories = (config = {}) =>
  (config.pricingCategories || config.defaultPricingCategories || [])
    .map((category = {}) => ({
      id: String(category.id || category.categoryId || "").trim(),
      label: String(category.label || category.title || "Travelers").trim(),
      ticketCategory: String(category.ticketCategory || "").toUpperCase(),
      min: Math.max(0, Number(category.min ?? 0) || 0),
      max: Math.max(1, Number(category.max ?? 50) || 50),
      defaultQuantity: Math.max(0, Number(category.defaultQuantity ?? 0) || 0),
      minAge: Number.isFinite(Number(category.minAge)) ? Number(category.minAge) : null,
      maxAge: Number.isFinite(Number(category.maxAge)) ? Number(category.maxAge) : null
    }))
    .filter((category) => category.id);

export const ageLabel = (category = {}) => {
  const { minAge, maxAge } = category;
  if (minAge === null && maxAge === null) return "";
  if (maxAge === null || maxAge >= 99) return `Age ${minAge ?? 0}+`;
  return `Age ${minAge ?? 0}–${maxAge}`;
};

// adults / children / infants for checkout, from Bókun's ticket categories (adult when unknown).
export const paxFromCounts = (categories = [], counts = {}) => {
  const pax = { adults: 0, children: 0, infants: 0 };
  for (const category of categories) {
    const quantity = Math.max(0, Number(counts[category.id] || 0));
    if (!quantity) continue;
    if (/INFANT/.test(category.ticketCategory)) pax.infants += quantity;
    else if (/CHILD|YOUTH|STUDENT|TEEN/.test(category.ticketCategory)) pax.children += quantity;
    else pax.adults += quantity;
  }
  return pax;
};

export const isAdultCategory = (category = {}) => !/INFANT|CHILD|YOUTH|STUDENT|TEEN/.test(category.ticketCategory);

// "1 adult", "2 adults, 1 child".
export const travellersLabel = (pax = {}) =>
  [
    pax.adults ? `${pax.adults} adult${pax.adults === 1 ? "" : "s"}` : "",
    pax.children ? `${pax.children} child${pax.children === 1 ? "" : "ren"}` : "",
    pax.infants ? `${pax.infants} infant${pax.infants === 1 ? "" : "s"}` : ""
  ].filter(Boolean).join(", ") || "No travelers";

// Option names as shown to guests: Bókun's "W/" ("with") prefix is dropped.
export const displayOptionName = (name = "") => String(name || "").replace(/^\s*w\/\s*/i, "").trim() || "Tour option";

// More start times than fit as pills (transfers run every half hour): shown as a list, and the guest picks one
// (the first would be midnight).
export const MANY_TIMES = 12;
export const needsTimeChoice = (slots = []) => slots.length > MANY_TIMES;

export const slotKey = (slot = {}) => `${slot.startTimeId || ""}|${slot.time || ""}`;
export const bookableSlots = (slots = []) =>
  (slots || []).filter((slot) => slot?.time && slot.status !== "sold_out" && (slot.capacityLeft === undefined || Number(slot.capacityLeft) > 0));

