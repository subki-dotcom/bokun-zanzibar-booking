const asyncHandler = require("../../utils/asyncHandler");
const { successResponse } = require("../../utils/apiResponse");
const offersService = require("./offers.service");

const listOffers = asyncHandler(async (_req, res) => {
  const data = await offersService.listOffers();
  return successResponse(res, {
    message: "Offers fetched",
    data
  });
});

const createOffer = asyncHandler(async (req, res) => {
  const data = await offersService.createOffer(req.validated.body);

  return successResponse(res, {
    message: "Offer created",
    data,
    statusCode: 201
  });
});

module.exports = {
  listOffers,
  createOffer
};