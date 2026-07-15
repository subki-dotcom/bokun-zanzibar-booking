const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");
const marketingService = require("../services/marketing");

const captureLead = asyncHandler(async (req, res) => {
  const data = await marketingService.captureLead(req.validated.body);
  return successResponse(res, { message: "Preference saved", data: { id: data._id } });
});

const listRecoveryLeads = asyncHandler(async (req, res) => {
  const data = await marketingService.listRecoveryLeads({ limit: req.query.limit });
  return successResponse(res, { message: "Recoverable checkout leads fetched", data });
});

module.exports = { captureLead, listRecoveryLeads };
