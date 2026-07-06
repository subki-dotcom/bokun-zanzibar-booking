const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");
const commissionsService = require("../services/commissions");

const summary = asyncHandler(async (_req, res) => {
  const data = await commissionsService.listCommissionSummary();

  return successResponse(res, {
    message: "Commission summary fetched",
    data
  });
});

const listAgentCommissions = asyncHandler(async (_req, res) => {
  const data = await commissionsService.listAgentCommissions();

  return successResponse(res, {
    message: "Agent commissions fetched",
    data
  });
});

const markPaid = asyncHandler(async (req, res) => {
  const data = await commissionsService.markCommissionPaid(req.params.id);

  return successResponse(res, {
    message: "Commission marked as paid",
    data
  });
});

module.exports = {
  summary,
  listAgentCommissions,
  markPaid
};
