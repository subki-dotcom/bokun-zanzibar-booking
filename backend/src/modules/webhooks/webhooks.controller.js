const asyncHandler = require("../../utils/asyncHandler");
const { successResponse } = require("../../utils/apiResponse");
const webhooksService = require("./webhooks.service");

const bokunWebhook = asyncHandler(async (req, res) => {
  const data = await webhooksService.handleBokunWebhook({
    payload: req.body,
    headers: req.headers,
    requestId: req.requestId
  });

  return successResponse(res, {
    message: "Webhook processed",
    data
  });
});

const pollBookingSync = asyncHandler(async (req, res) => {
  const data = await webhooksService.pollBookingUpdates({
    requestId: req.requestId,
    source: "manual",
    limit: req.validated.body.limit
  });

  return successResponse(res, {
    message: data?.skipped ? "Booking sync poll skipped" : "Booking sync poll completed",
    data
  });
});

module.exports = {
  bokunWebhook,
  pollBookingSync
};
