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

export const fetchTours = async ({ page = 1, limit = 9, force = false } = {}) => {
  const safePage = Math.max(1, Number(page || 1));
  const safeLimit = Math.max(1, Number(limit || 9));
  const cacheKey = `${safePage}:${safeLimit}`;

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
      params: { page: safePage, limit: safeLimit }
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
