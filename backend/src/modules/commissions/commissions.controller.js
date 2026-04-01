const asyncHandler = require("../../utils/asyncHandler");
const { successResponse } = require("../../utils/apiResponse");
const commissionsService = require("./commissions.service");

const summary = asyncHandler(async (_req, res) => {
  const data = await commissionsService.listCommissionSummary();

  return successResponse(res, {
    message: "Commission summary fetched",
    data
  });
});

module.exports = {
  summary
};