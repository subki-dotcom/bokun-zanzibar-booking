const businessAccountingService = require("../services/businessAccounting");
const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");

const foundation = asyncHandler(async (req, res) => {
  const data = await businessAccountingService.getFoundationSummary(req.validated?.query || req.query || {});
  return successResponse(res, {
    message: "Business accounting foundation fetched",
    data
  });
});

const postBookingContribution = asyncHandler(async (req, res) => {
  const data = await businessAccountingService.postBookingContribution({
    bookingReference: req.validated.params.bookingReference,
    dryRun: Boolean(req.validated.body?.dryRun),
    reason: req.validated.body?.reason,
    auth: req.auth,
    requestId: req.requestId
  });

  return successResponse(res, {
    message: data.dryRun ? "Booking contribution posting dry-run completed" : "Booking contribution posting synchronized",
    data,
    statusCode: data.action === "created" ? 201 : 200
  });
});

module.exports = {
  foundation,
  postBookingContribution
};
