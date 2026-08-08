const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");
const bokunService = require("../services/bokun");
const bokunConfirmedBookingsService = require("../services/bokunConfirmedBookings");

const products = asyncHandler(async (req, res) => {
  const data = await bokunService.fetchProducts(req.requestId);

  return successResponse(res, {
    message: "Bokun products fetched",
    data
  });
});

const countries = asyncHandler(async (req, res) => {
  const data = await bokunService.fetchCountries(req.requestId);

  return successResponse(res, {
    message: "Bokun countries fetched",
    data
  });
});

const productDetails = asyncHandler(async (req, res) => {
  const data = await bokunService.fetchProductDetails(req.params.productId, req.requestId, {
    forceRefresh: req.query.forceRefresh === "true"
  });

  return successResponse(res, {
    message: "Bokun product fetched",
    data
  });
});

const pickupPlaces = asyncHandler(async (req, res) => {
  const data = await bokunService.fetchPickupPlaceCatalog(req.requestId, {
    limit: req.query.limit || 900,
    forceRefresh: req.query.forceRefresh === "true"
  });

  return successResponse(res, {
    message: "Bokun pickup places fetched",
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

const importConfirmedBookings = asyncHandler(async (req, res) => {
  const body = req.validated?.body || {};
  const data = await bokunConfirmedBookingsService.syncConfirmedBookings({
    ...body,
    source: "admin_manual_import",
    requestId: req.requestId
  });

  return successResponse(res, {
    message: body.dryRun ? "Bokun confirmed booking import dry-run completed" : "Bokun confirmed booking import completed",
    data
  });
});

const resyncBooking = asyncHandler(async (req, res) => {
  const body = req.validated?.body || {};
  const data = await bokunConfirmedBookingsService.manualResync({
    reference: req.validated.params.reference,
    source: "admin_single_resync",
    requestId: req.requestId,
    dryRun: Boolean(body.dryRun)
  });

  return successResponse(res, {
    message: body.dryRun ? "Bokun booking resync dry-run completed" : "Bokun booking resynced",
    data
  });
});

module.exports = {
  products,
  countries,
  productDetails,
  pickupPlaces,
  productBookingConfig,
  productLiveQuote,
  availability,
  bookingQuestions,
  createBooking,
  lookupBooking,
  cancelBooking,
  editBooking,
  importConfirmedBookings,
  resyncBooking
};
