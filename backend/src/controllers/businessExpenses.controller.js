const businessAccountingService = require("../services/businessAccounting");
const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");

const list = asyncHandler(async (req, res) => {
  const data = await businessAccountingService.listBusinessExpenses(req.validated?.query || {});
  return successResponse(res, {
    message: "Business expenses fetched",
    data
  });
});

const create = asyncHandler(async (req, res) => {
  const data = await businessAccountingService.createBusinessExpense({
    input: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "Business expense created",
    data,
    statusCode: data.action === "created" ? 201 : 200
  });
});

const update = asyncHandler(async (req, res) => {
  const data = await businessAccountingService.updateBusinessExpense({
    expenseId: req.validated.params.id,
    input: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "Business expense updated",
    data
  });
});

module.exports = {
  create,
  list,
  update
};
