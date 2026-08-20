const productionReadinessService = require("../services/productionReadiness");
const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");

const summary = asyncHandler(async (_req, res) => {
  const data = await productionReadinessService.getSummary();
  return successResponse(res, {
    message: "Production readiness summary fetched",
    data
  });
});

module.exports = {
  summary
};
