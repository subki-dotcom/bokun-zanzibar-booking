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
  const style = typeof req.query.category === "string" ? req.query.category.slice(0, 40) : "";
  const query = typeof req.query.q === "string" ? req.query.q.slice(0, 80) : "";
  const result = await toursService.listTours({ page, limit, style, query, requestId: req.requestId });

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
const publicTour = (source = {}) => {
  const tour = { ...source };
  delete tour.rawBokunProduct;
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

const listProductsForAdmin = asyncHandler(async (req, res) => {
  const data = await toursService.listProductsForAdmin();
  return successResponse(res, { message: "Products fetched", data });
});

const setProductVisibility = asyncHandler(async (req, res) => {
  const data = await toursService.setProductVisibility(
    req.params.productId,
    req.body?.hidden === true,
    req.auth?.email || req.auth?.id || req.auth?.role || ""
  );
  return successResponse(res, { message: data.hiddenFromPublic ? "Product hidden from the website" : "Product shown on the website", data });
});

const setProductFeatured = asyncHandler(async (req, res) => {
  const placement = req.body?.placement === "menu" ? "menu" : "home";
  const data = await toursService.setProductFeatured(req.params.productId, req.body?.featured === true, placement);
  const on = placement === "menu" ? data.featuredInMenu : data.featuredOnHome;
  const where = placement === "menu" ? "the header menu" : "the home page";
  return successResponse(res, { message: on ? `Product featured in ${where}` : `Product removed from ${where}`, data });
});

// The tours page: ?category=sea&q=mnemba&duration=half-day,full-day&price=20-300&time=morning&good=pickup
// &sort=price_asc&page=2 (see toursService.searchTours).
const searchTours = asyncHandler(async (req, res) => {
  const pick = (key) => (typeof req.query[key] === "string" ? req.query[key].slice(0, 120) : "");
  const query = Object.fromEntries(["category", "q", "duration", "price", "time", "good", "sort", "page", "limit"].map((key) => [key, pick(key)]));
  const data = await toursService.searchTours(query, req.requestId);
  setPublicCache(res, { maxAge: 60, staleWhileRevalidate: 300 });
  return successResponse(res, { message: "Tours found", data });
});

// ?q=mnemba&q=prison-island…: the header menu's data (see toursService.getMenuData).
const getMenuData = asyncHandler(async (req, res) => {
  const raw = req.query.q;
  const queries = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((value) => typeof value === "string");
  const data = await toursService.getMenuData(queries, req.requestId);
  res.set("Cache-Control", "public, max-age=60");
  return successResponse(res, { message: "Header menu data", data });
});

const getHomeData = asyncHandler(async (req, res) => {
  const data = await toursService.getHomeData();
  res.set("Cache-Control", "public, max-age=60");
  return successResponse(res, { message: "Home page data", data });
});

const getOptionQuotes = asyncHandler(async (req, res) => {
  const data = await toursService.getOptionQuotes(req.params.slug, req.body || {}, req.requestId);
  return successResponse(res, { message: "Option quotes fetched", data });
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
  getOptionQuotes,
  listProductsForAdmin,
  setProductVisibility,
  setProductFeatured,
  getHomeData,
  getMenuData,
  searchTours,
  getTourOptions,
  checkOptionsAvailability,
  searchToursByAvailability,
  syncProducts
};
