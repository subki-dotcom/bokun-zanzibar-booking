const performanceReviewService = require("../services/performanceReview");
const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");

const summary = asyncHandler(async (_req, res) => {
  const data = performanceReviewService.getSummary();
  return successResponse(res, {
    message: "Performance review summary fetched",
    data
  });
});

const indexCoverage = asyncHandler(async (req, res) => {
  const data = performanceReviewService.getIndexCoverage(req.validated?.query || {});
  return successResponse(res, {
    message: "Index coverage review fetched",
    data
  });
});

const indexInventory = asyncHandler(async (_req, res) => {
  const data = performanceReviewService.getModelIndexInventory();
  return successResponse(res, {
    message: "Model index inventory fetched",
    data
  });
});

module.exports = {
  indexCoverage,
  indexInventory,
  summary
};
