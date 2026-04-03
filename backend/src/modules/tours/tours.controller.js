const asyncHandler = require("../../utils/asyncHandler");
const { successResponse } = require("../../utils/apiResponse");
const toursService = require("./tours.service");

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

  return successResponse(res, {
    message: "Tours fetched",
    data: result.items,
    meta: result.pagination
  });
});

const listCategories = asyncHandler(async (req, res) => {
  const categories = await toursService.listTourCategories(req.requestId);

  return successResponse(res, {
    message: "Tour categories fetched",
    data: categories
  });
});

const getTourBySlug = asyncHandler(async (req, res) => {
  const data = await toursService.getTourBySlug(req.params.slug, req.requestId);

  return successResponse(res, {
    message: "Tour details fetched",
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
  getTourOptions,
  checkOptionsAvailability,
  syncProducts
};
