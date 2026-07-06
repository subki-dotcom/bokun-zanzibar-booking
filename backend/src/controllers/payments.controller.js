const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");
const paymentsService = require("../services/payments");

const listPayments = asyncHandler(async (_req, res) => {
  const data = await paymentsService.listPayments();

  return successResponse(res, {
    message: "Payments fetched",
    data
  });
});

module.exports = {
  listPayments
};