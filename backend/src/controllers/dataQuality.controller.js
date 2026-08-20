const dataQualityService = require("../services/dataQuality");
const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");

const summary = asyncHandler(async (req, res) => {
  const data = await dataQualityService.getSummary(req.validated?.query || {});
  return successResponse(res, {
    message: "Data quality summary fetched",
    data
  });
});

const issues = asyncHandler(async (req, res) => {
  const data = await dataQualityService.listIssues(req.validated?.query || {});
  return successResponse(res, {
    message: "Data quality issues fetched",
    data
  });
});

module.exports = {
  issues,
  summary
};
