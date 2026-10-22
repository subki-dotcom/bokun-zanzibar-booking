// Pure helpers for checkout trip details (participants, price catalogs, pickup places), shared by the public and agent checkouts.
export const normalizeTicketCategory = (value = "") => {
  const token = String(value || "").toLowerCase();

  if (token.includes("adult")) return "adult";
  if (token.includes("child")) return "child";
  if (token.includes("infant") || token.includes("baby")) return "infant";

  return "other";
};

export const decodeJsonMaybe = (raw = "") => {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
};

export const resolveCatalogId = (catalog = {}) =>
  String(catalog?.activityPriceCatalogId || catalog?.catalogId || catalog?.id || "").trim();

export const resolveCatalogById = (catalogs = [], catalogId = "") =>
  (catalogs || []).find((catalog) => resolveCatalogId(catalog) === String(catalogId || "").trim()) || null;

export const resolveDefaultCatalog = (catalogs = [], preferredCatalogId = "") => {
  const activeCatalogs = (catalogs || []).filter((catalog) => catalog?.active !== false);
  if (!activeCatalogs.length) {
    return { id: "", catalog: null };
  }

  if (preferredCatalogId) {
    const preferred = resolveCatalogById(activeCatalogs, preferredCatalogId);
    if (preferred) {
      return {
        id: resolveCatalogId(preferred),
        catalog: preferred
      };
    }
  }

  const defaultCatalog = activeCatalogs.find((catalog) => catalog?.isVendorDefault) || activeCatalogs[0];
  return {
    id: resolveCatalogId(defaultCatalog),
    catalog: defaultCatalog || null
  };
};

export const normalizeParticipants = (participants = []) =>
  (participants || [])
    .map((row = {}) => {
      const categoryId = String(row.categoryId || row.pricingCategoryId || "").trim();
      if (!categoryId) {
        return null;
      }

      return {
        categoryId,
        title: row.title || row.label || "Passenger",
        ticketCategory: row.ticketCategory || "",
        quantity: Math.max(0, Number(row.quantity || 0))
      };
    })
    .filter(Boolean);

export const buildPaxFromParticipants = (participants = []) => {
  let adults = 0;
  let children = 0;
  let infants = 0;

  (participants || []).forEach((participant) => {
    const quantity = Math.max(0, Number(participant.quantity || 0));
    const bucket = normalizeTicketCategory(participant.ticketCategory || participant.title);

    if (bucket === "adult") adults += quantity;
    else if (bucket === "child") children += quantity;
    else if (bucket === "infant") infants += quantity;
    else adults += quantity;
  });

  if (adults + children + infants <= 0) {
    adults = 1;
  }

  return { adults, children, infants };
};

export const syncParticipantsWithCategories = (current = [], categories = []) => {
  const currentMap = new Map(
    normalizeParticipants(current).map((row) => [String(row.categoryId), row])
  );

  if (!Array.isArray(categories) || !categories.length) {
    return normalizeParticipants(current);
  }

  return categories.map((category) => {
    const categoryId = String(category.categoryId || "").trim();
    const currentRow = currentMap.get(categoryId);
    const min = Math.max(0, Number(category.minQuantity || 0));
    const max = Math.max(min, Number(category.maxQuantity || 50));
    const currentQty = Number(currentRow?.quantity ?? category.quantity ?? 0);
    const quantity = Math.min(max, Math.max(min, currentQty));

    return {
      categoryId,
      title: category.title || currentRow?.title || "Passenger",
      ticketCategory: category.ticketCategory || currentRow?.ticketCategory || "",
      quantity
    };
  });
};

export const mapSessionExtrasToAvailability = (selectedExtras = [], availableExtras = []) => {
  const byCode = new Map((availableExtras || []).map((extra) => [String(extra.code), extra]));
  return (selectedExtras || [])
    .map((extra = {}) => {
      const match = byCode.get(String(extra.code || ""));
      if (!match) {
        return null;
      }

      return {
        code: String(match.code),
        label: match.label,
        amount: Number(match.amount || 0),
        quantity: Math.min(
          Math.max(1, Number(match.maxQuantity || 1)),
          Math.max(1, Number(extra.quantity || 1))
        )
      };
    })
    .filter(Boolean);
};

export const mergeLivePickupDetails = (tourData = {}, liveProduct = null) => {
  if (!liveProduct) {
    return tourData;
  }

  const livePickupPlaces = Array.isArray(liveProduct.pickupPlaces) ? liveProduct.pickupPlaces : [];
  const currentPickupPlaces = Array.isArray(tourData.pickupPlaces) ? tourData.pickupPlaces : [];

  return {
    ...tourData,
    pickupInfo: liveProduct.pickupInfo || tourData.pickupInfo || "",
    pickupPlaces: livePickupPlaces.length ? livePickupPlaces : currentPickupPlaces,
    options: Array.isArray(liveProduct.options) && liveProduct.options.length ? liveProduct.options : tourData.options,
    priceCatalogs:
      Array.isArray(liveProduct.priceCatalogs) && liveProduct.priceCatalogs.length
        ? liveProduct.priceCatalogs
        : tourData.priceCatalogs
  };
};

export const markProductPickupPlaces = (places = []) =>
  (Array.isArray(places) ? places : []).map((place) => ({
    ...place,
    productScoped: place.productScoped !== false
  }));

export const markFallbackPickupPlaces = (places = []) =>
  (Array.isArray(places) ? places : []).map((place) => ({
    ...place,
    productScoped: false
  }));

export const resolveLiveStartTimeId = ({ slots = [], startTime = "", fallbackId = "" } = {}) => {
  const selectedTime = String(startTime || "").trim();
  const availableSlots = Array.isArray(slots) ? slots : [];
  const selectedSlot = selectedTime
    ? availableSlots.find((slot) => String(slot?.time || "").trim() === selectedTime)
    : null;

  return String(selectedSlot?.startTimeId || fallbackId || "").trim();
};
