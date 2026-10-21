const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");
const toursService = require("../services/tours");

const setPublicCache = (res, { maxAge = 60, staleWhileRevalidate = 300 } = {}) => {
  res.set("Cache-Control", `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`);
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const listTours = asyncHandler(async (req, res) => {
  const page = parsePositiveInt(req.query.page, 1);
  const limit = parsePositiveInt(req.query.limit, 9);
  const result = await toursService.listTours({ page, limit, requestId: req.requestId });

  setPublicCache(res, { maxAge: 60, staleWhileRevalidate: 300 });
  return successResponse(res, {
    message: "Tours fetched",
    data: result.items,
    meta: result.pagination
  });
});

const listCategories = asyncHandler(async (req, res) => {
  const categories = await toursService.listTourCategories(req.requestId);

  setPublicCache(res, { maxAge: 300, staleWhileRevalidate: 900 });
  return successResponse(res, {
    message: "Tour categories fetched",
    data: categories
  });
});

// The raw Bókun product is internal (about a quarter of the response); the page never reads it. A rating is shown
// only with real reviews behind it.
const publicTour = ({ rawBokunProduct, ...tour } = {}) => {
  const reviewCount = Math.max(0, Math.round(Number(tour.reviewCount) || 0));
  return { ...tour, reviewCount, rating: reviewCount > 0 ? Number(tour.rating) || 0 : 0 };
};

const getTourBySlug = asyncHandler(async (req, res) => {
  const data = publicTour(await toursService.getTourBySlug(req.params.slug, req.requestId));

  setPublicCache(res, { maxAge: 60, staleWhileRevalidate: 300 });
  return successResponse(res, {
    message: "Tour details fetched",
    data
  });
});

const getAvailableDates = asyncHandler(async (req, res) => {
  const data = await toursService.getAvailableDates(
    req.params.slug,
    { from: String(req.query.from || ""), days: parsePositiveInt(req.query.days, 60) },
    req.requestId
  );

  setPublicCache(res, { maxAge: 300, staleWhileRevalidate: 600 });
  return successResponse(res, {
    message: "Available dates fetched",
    data
  });
});

const getTourOptions = asyncHandler(async (req, res) => {
  const data = await toursService.getTourOptions(req.params.id, req.requestId);

  return successResponse(res, {
    message: "Tour options fetched",
    data
  });
});

const checkOptionsAvailability = asyncHandler(async (req, res) => {
  const data = await toursService.checkOptionsAvailability(req.params.slug, req.body, req.requestId);

  return successResponse(res, {
    message: "Tour option availability fetched",
    data
  });
});

const searchToursByAvailability = asyncHandler(async (req, res) => {
  const data = await toursService.searchToursByAvailability({
    ...req.validated.body,
    requestId: req.requestId
  });

  return successResponse(res, {
    message: "Tour availability search completed",
    data
  });
});

const syncProducts = asyncHandler(async (req, res) => {
  const result = await toursService.syncProducts(req.requestId, {
    id: req.auth?.id || null,
    role: req.auth?.role || "system"
  });

  return successResponse(res, {
    message: "Product sync completed",
    data: result
  });
});

module.exports = {
  listTours,
  listCategories,
  getTourBySlug,
  getAvailableDates,
  getTourOptions,
  checkOptionsAvailability,
  searchToursByAvailability,
  syncProducts
};
