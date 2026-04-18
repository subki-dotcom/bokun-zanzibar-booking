const asyncHandler = require("../../utils/asyncHandler");
const { successResponse } = require("../../utils/apiResponse");
const bookingService = require("./bookings.service");

const quote = asyncHandler(async (req, res) => {
  const data = await bookingService.quoteBooking({
    payload: req.validated.body,
    auth: req.auth || null,
    requestId: req.requestId
  });

  return successResponse(res, {
    message: "Live booking quote generated",
    data
  });
});

const create = asyncHandler(async (req, res) => {
  const data = await bookingService.createBooking({
    payload: req.validated.body,
    auth: req.auth || null,
    requestId: req.requestId
  });

  return successResponse(res, {
    message: "Booking created successfully",
    data,
    statusCode: 201
  });
});

const getByReference = asyncHandler(async (req, res) => {
  const data = await bookingService.getBookingByReference(req.params.reference);

  return successResponse(res, {
    message: "Booking details fetched",
    data
  });
});

const listRecent = asyncHandler(async (req, res) => {
  const data = await bookingService.listRecentBookings(req.auth || null);

  return successResponse(res, {
    message: "Recent bookings fetched",
    data
  });
});

const cancel = asyncHandler(async (req, res) => {
  const data = await bookingService.cancelBooking({
    id: req.params.id,
    reason: req.validated.body.reason,
    auth: req.auth || null,
    requestId: req.requestId
  });

  return successResponse(res, {
    message: "Booking cancelled",
    data
  });
});

const editRequest = asyncHandler(async (req, res) => {
  const data = await bookingService.requestBookingEdit({
    id: req.params.id,
    reason: req.validated.body.reason,
    payload: req.validated.body.payload,
    auth: req.auth || null,
    requestId: req.requestId
  });

  return successResponse(res, {
    message: "Booking edit request submitted",
    data
  });
});

const stats = asyncHandler(async (_req, res) => {
  const data = await bookingService.bookingStats();

  return successResponse(res, {
    message: "Booking stats fetched",
    data
  });
});

const listPendingFinalizations = asyncHandler(async (req, res) => {
  const query = req.validated?.query || req.query || {};
  const data = await bookingService.listPendingFinalizations({
    limit: Number(query.limit || 20),
    includeProcessing: query.includeProcessing === undefined ? true : String(query.includeProcessing) !== "false",
    force: String(query.force || "false") === "true"
  });

  return successResponse(res, {
    message: "Pending booking finalizations fetched",
    data,
    meta: {
      count: data.length
    }
  });
});

const retryFinalization = asyncHandler(async (req, res) => {
  const data = await bookingService.retryBookingFinalization({
    bookingId: req.params.id,
    auth: req.auth || null,
    requestId: req.requestId,
    force: Boolean(req.validated?.body?.force)
  });

  return successResponse(res, {
    message: "Booking finalization retry executed",
    data
  });
});

const reconcileFinalizations = asyncHandler(async (req, res) => {
  const data = await bookingService.reconcilePendingFinalizations({
    limit: Number(req.validated?.body?.limit || 20),
    force: Boolean(req.validated?.body?.force),
    auth: req.auth || null,
    requestId: req.requestId,
    source: "admin_reconciliation"
  });

  return successResponse(res, {
    message: "Booking finalization reconciliation executed",
    data
  });
});

module.exports = {
  quote,
  create,
  getByReference,
  listRecent,
  cancel,
  editRequest,
  stats,
  listPendingFinalizations,
  retryFinalization,
  reconcileFinalizations
};
