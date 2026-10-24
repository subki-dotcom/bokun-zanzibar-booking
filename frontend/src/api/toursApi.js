import axiosClient from "./axiosClient";

const TOUR_LIST_CACHE_TTL_MS = 60 * 1000;
const TOUR_DETAIL_CACHE_TTL_MS = 60 * 1000;
const TOUR_CATEGORIES_CACHE_TTL_MS = 5 * 60 * 1000;

const tourListCache = new Map();
const tourListRequests = new Map();
const tourDetailCache = new Map();
const tourDetailRequests = new Map();
let categoriesCache = null;
let categoriesRequest = null;

const readCache = (cache, key, ttlMs) => {
  const cached = cache.get(key);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.cachedAt > ttlMs) {
    cache.delete(key);
    return null;
  }

  return cached.value;
};

const writeCache = (cache, key, value) => {
  cache.set(key, {
    cachedAt: Date.now(),
    value
  });
  return value;
};

const clearToursCache = () => {
  tourListCache.clear();
  tourListRequests.clear();
  tourDetailCache.clear();
  tourDetailRequests.clear();
  categoriesCache = null;
  categoriesRequest = null;
};

// category: a travel style label ("Sea tours"); the server pages through that style only.
// query: words to search for in titles and summaries ("stone-town", "mnemba").
export const fetchTours = async ({ page = 1, limit = 9, category = "", query = "", force = false } = {}) => {
  const safePage = Math.max(1, Number(page || 1));
  const safeLimit = Math.max(1, Number(limit || 9));
  const style = category && category !== "all" ? String(category) : "";
  const search = String(query || "").trim().slice(0, 80);
  const cacheKey = `${safePage}:${safeLimit}:${style}:${search}`;

  if (!force) {
    const cached = readCache(tourListCache, cacheKey, TOUR_LIST_CACHE_TTL_MS);
    if (cached) {
      return cached;
    }

    const pending = tourListRequests.get(cacheKey);
    if (pending) {
      return pending;
    }
  }

  const request = axiosClient
    .get("/tours", {
      params: { page: safePage, limit: safeLimit, ...(style ? { category: style } : {}), ...(search ? { q: search } : {}) }
    })
    .then((response) =>
      writeCache(tourListCache, cacheKey, {
        items: response.data.data || [],
        pagination: response.data.meta || {}
      })
    )
    .finally(() => {
      tourListRequests.delete(cacheKey);
    });

  tourListRequests.set(cacheKey, request);
  return request;
};

// Everything the home page shows (styles with counts, featured, best sellers, safari, reviews), cached by the server.
let homeDataRequest = null;
export const fetchHomeData = () => {
  if (!homeDataRequest) {
    homeDataRequest = axiosClient
      .get("/tours/home")
      .then((response) => response.data.data)
      .catch((error) => {
        homeDataRequest = null;
        throw error;
      });
  }
  return homeDataRequest;
};

export const fetchTourCategories = async ({ force = false } = {}) => {
  if (!force && categoriesCache && Date.now() - categoriesCache.cachedAt <= TOUR_CATEGORIES_CACHE_TTL_MS) {
    return categoriesCache.value;
  }

  if (!force && categoriesRequest) {
    return categoriesRequest;
  }

  categoriesRequest = axiosClient
    .get("/tours/categories")
    .then((response) => {
      categoriesCache = {
        cachedAt: Date.now(),
        value: response.data.data || []
      };
      return categoriesCache.value;
    })
    .finally(() => {
      categoriesRequest = null;
    });

  return categoriesRequest;
};

export const fetchTourBySlug = async (slug, { force = false } = {}) => {
  const cacheKey = String(slug || "").trim();

  if (!force) {
    const cached = readCache(tourDetailCache, cacheKey, TOUR_DETAIL_CACHE_TTL_MS);
    if (cached) {
      return cached;
    }

    const pending = tourDetailRequests.get(cacheKey);
    if (pending) {
      return pending;
    }
  }

  const request = axiosClient
    .get(`/tours/${cacheKey}`)
    .then((response) => writeCache(tourDetailCache, cacheKey, response.data.data))
    .finally(() => {
      tourDetailRequests.delete(cacheKey);
    });

  tourDetailRequests.set(cacheKey, request);
  return request;
};

export const fetchTourOptions = async (id) => {
  const response = await axiosClient.get(`/tours/${id}/options`);
  return response.data.data;
};

// Availability for a tour, date and party, built the same way wherever it is asked for, so a background prefetch
// (when the guest picks a date) and the "Check availability" click share one request.
export const availabilityRequestPayload = ({ travelDate = "", pax = {}, rateId = "" } = {}) => ({
  travelDate: String(travelDate || ""),
  pax: {
    adults: Math.max(0, Number(pax?.adults || 0)),
    children: Math.max(0, Number(pax?.children || 0)),
    infants: Math.max(0, Number(pax?.infants || 0))
  },
  priceCatalogId: String(rateId || "")
});

const AVAILABILITY_CACHE_TTL_MS = 3 * 60 * 1000;
const availabilityRequests = new Map();

export const checkTourOptionsAvailability = (slug, payload) => {
  const key = JSON.stringify([slug, payload]);
  const reused = availabilityRequests.get(key);
  if (reused && Date.now() - reused.at < AVAILABILITY_CACHE_TTL_MS) {
    return reused.promise;
  }

  const promise = axiosClient
    .post(`/tours/${slug}/options-availability`, payload)
    .then((response) => response.data.data)
    .catch((error) => {
      availabilityRequests.delete(key);
      throw error;
    });
  availabilityRequests.set(key, { at: Date.now(), promise });
  return promise;
};

// Staff: products and their website visibility.
export const fetchAdminWebsiteProducts = async () => {
  const response = await axiosClient.get("/tours/admin/products");
  return response.data.data || [];
};

export const updateAdminWebsiteProductVisibility = async (productId, hidden) => {
  const response = await axiosClient.patch(`/tours/admin/products/${encodeURIComponent(productId)}/visibility`, { hidden });
  clearToursCache();
  return response.data.data;
};

// Staff choose the tours shown in "Handpicked Zanzibar experiences" on the home page.
// placement "home" (Handpicked Zanzibar experiences) or "menu" (the one tour in the header's Tours & activities menu).
export const updateAdminWebsiteProductFeatured = async (productId, featured, placement = "home") => {
  const response = await axiosClient.patch(`/tours/admin/products/${encodeURIComponent(productId)}/featured`, { featured, placement });
  homeDataRequest = null;
  menuDataRequests.clear();
  return response.data.data;
};

// The header menu: its tour card, the top tours and, per search, the number of tours and the lowest price.
// One request per set of searches for the whole visit.
const menuDataRequests = new Map();
export const fetchMenuData = (searches = []) => {
  const key = [...new Set(searches)].sort().join("|");
  if (!menuDataRequests.has(key)) {
    const params = new URLSearchParams();
    key.split("|").filter(Boolean).forEach((query) => params.append("q", query));
    menuDataRequests.set(
      key,
      axiosClient
        .get(`/tours/menu?${params.toString()}`)
        .then((response) => response.data.data)
        .catch((error) => {
          menuDataRequests.delete(key);
          throw error;
        })
    );
  }
  return menuDataRequests.get(key);
};

// Each bookable option's start times and exact total for a date and the chosen travellers (as checkout prices it).
const optionQuoteRequests = new Map();
export const fetchTourOptionQuotes = (slug, { travelDate = "", passengers = [], rateId = "" } = {}) => {
  const key = JSON.stringify([slug, travelDate, rateId, passengers]);
  const reused = optionQuoteRequests.get(key);
  if (reused && Date.now() - reused.at < AVAILABILITY_CACHE_TTL_MS) return reused.promise;
  const promise = axiosClient
    // Products with many options take longer to price than the default 30 seconds on a slow connection.
    .post(`/tours/${encodeURIComponent(slug)}/option-quotes`, { travelDate, passengers, rateId }, { timeout: 60000 })
    .then((response) => response.data.data)
    .catch((error) => {
      optionQuoteRequests.delete(key);
      throw error;
    });
  optionQuoteRequests.set(key, { at: Date.now(), promise });
  return promise;
};

// Dates with a bookable start time, for the tour calendar.
const availableDatesRequests = new Map();
export const fetchTourAvailableDates = (slug, { from = "", days = 90 } = {}) => {
  const key = `${slug}|${from}|${days}`;
  if (!availableDatesRequests.has(key)) {
    availableDatesRequests.set(key, axiosClient
      .get(`/tours/${encodeURIComponent(slug)}/available-dates`, { params: { from, days } })
      .then((response) => response.data.data)
      .catch((error) => {
        availableDatesRequests.delete(key);
        throw error;
      }));
  }
  return availableDatesRequests.get(key);
};

export const prefetchTourOptionsAvailability = (slug, payload) => {
  if (!slug || !payload?.travelDate) return;
  checkTourOptionsAvailability(slug, payload).catch(() => {});
};

export const searchToursByAvailability = async ({ travelDate, pax, slugs } = {}) => {
  const response = await axiosClient.post("/tours/availability-search", { travelDate, pax, slugs });
  return response.data.data || [];
};

export const syncTours = async ({ timeout = 180000 } = {}) => {
  const response = await axiosClient.post("/tours/sync", {}, { timeout });
  clearToursCache();
  return response.data.data;
};
