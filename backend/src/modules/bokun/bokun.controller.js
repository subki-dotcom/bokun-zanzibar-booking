const asyncHandler = require("../../utils/asyncHandler");
const { successResponse } = require("../../utils/apiResponse");
const bokunService = require("./bokun.service");

const products = asyncHandler(async (req, res) => {
  const data = await bokunService.fetchProducts(req.requestId);

  return successResponse(res, {
    message: "Bokun products fetched",
    data
  });
});

const productDetails = asyncHandler(async (req, res) => {
  const data = await bokunService.fetchProductDetails(req.params.productId, req.requestId);

  return successResponse(res, {
    message: "Bokun product fetched",
    data
  });
});

const productBookingConfig = asyncHandler(async (req, res) => {
  const data = await bokunService.fetchProductBookingConfig(
    req.params.productId,
    {
      rateId: req.query.rateId || ""
    },
    req.requestId
  );

  return successResponse(res, {
    message: "Bokun booking config fetched",
    data
  });
});

const productLiveQuote = asyncHandler(async (req, res) => {
  const data = await bokunService.fetchProductLiveQuote(req.params.productId, req.body, req.requestId);

  return successResponse(res, {
    message: "Bokun live quote fetched",
    data
  });
});

const availability = asyncHandler(async (req, res) => {
  const data = await bokunService.fetchAvailability(req.body, req.requestId);

  return successResponse(res, {
    message: "Live availability fetched",
    data
  });
});

const bookingQuestions = asyncHandler(async (req, res) => {
  const data = await bokunService.fetchBookingQuestions(req.body, req.requestId);

  return successResponse(res, {
    message: "Booking questions fetched",
    data
  });
});

const createBooking = asyncHandler(async (req, res) => {
  const data = await bokunService.createBooking(req.body, req.requestId);

  return successResponse(res, {
    message: "Booking created in Bokun",
    data,
    statusCode: 201
  });
});

const lookupBooking = asyncHandler(async (req, res) => {
  const data = await bokunService.lookupBooking(req.params.reference, req.requestId);

  return successResponse(res, {
    message: "Bokun booking lookup",
    data
  });
});

const cancelBooking = asyncHandler(async (req, res) => {
  const data = await bokunService.cancelBooking(req.params.bookingId, req.body, req.requestId);

  return successResponse(res, {
    message: "Bokun booking cancel requested",
    data
  });
});

const editBooking = asyncHandler(async (req, res) => {
  const data = await bokunService.editBooking(req.params.bookingId, req.body, req.requestId);

  return successResponse(res, {
    message: "Bokun booking edit requested",
    data
  });
});

module.exports = {
  products,
  productDetails,
  productBookingConfig,
  productLiveQuote,
  availability,
  bookingQuestions,
  createBooking,
  lookupBooking,
  cancelBooking,
  editBooking
};
