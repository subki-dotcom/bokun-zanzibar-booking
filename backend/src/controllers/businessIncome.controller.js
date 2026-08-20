const businessAccountingService = require("../services/businessAccounting");
const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");

const list = asyncHandler(async (req, res) => {
  const data = await businessAccountingService.listBusinessIncome(req.validated?.query || {});
  return successResponse(res, {
    message: "Business income fetched",
    data
  });
});

const create = asyncHandler(async (req, res) => {
  const data = await businessAccountingService.createBusinessIncome({
    input: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "Business income created",
    data,
    statusCode: data.action === "created" ? 201 : 200
  });
});

const update = asyncHandler(async (req, res) => {
  const data = await businessAccountingService.updateBusinessIncome({
    incomeId: req.validated.params.id,
    input: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "Business income updated",
    data
  });
});

module.exports = {
  create,
  list,
  update
};
