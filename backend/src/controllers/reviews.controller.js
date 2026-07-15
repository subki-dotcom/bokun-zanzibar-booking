const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");
const reviewsService = require("../services/reviews");

const listPublicReviews = asyncHandler(async (_req, res) => {
  const data = await reviewsService.fetchGoogleReviews();
  res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
  return successResponse(res, { message: "Public reviews fetched", data });
});

module.exports = { listPublicReviews };
