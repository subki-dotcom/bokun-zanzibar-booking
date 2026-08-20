const systemHealthService = require("../services/systemHealth");
const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");

const summary = asyncHandler(async (_req, res) => {
  const data = systemHealthService.getAdminSummary();
  return successResponse(res, {
    message: "System health summary fetched",
    data
  });
});

const checks = asyncHandler(async (_req, res) => {
  const data = systemHealthService.getAdminSummary();
  return successResponse(res, {
    message: "System health checks fetched",
    data: {
      generatedAt: data.generatedAt,
      status: data.status,
      checks: data.checks
    }
  });
});

module.exports = {
  checks,
  summary
};
