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

export const checkTourOptionsAvailability = async (slug, payload) => {
  const response = await axiosClient.post(`/tours/${slug}/options-availability`, payload);
  return response.data.data;
};

export const syncTours = async () => {
  const response = await axiosClient.post("/tours/sync");
  clearToursCache();
  return response.data.data;
};
