const asyncHandler = require("../../utils/asyncHandler");
const { successResponse } = require("../../utils/apiResponse");
const customersService = require("./customers.service");

const listCustomers = asyncHandler(async (_req, res) => {
  const data = await customersService.listCustomers();

  return successResponse(res, {
    message: "Customers fetched",
    data
  });
});

const getCustomer = asyncHandler(async (req, res) => {
  const data = await customersService.getCustomer(req.params.id);

  return successResponse(res, {
    message: "Customer details fetched",
    data
  });
});

module.exports = {
  listCustomers,
  getCustomer
};