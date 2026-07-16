const asyncHandler = require("../../utils/asyncHandler");
const { successResponse } = require("../../utils/apiResponse");
const paypalService = require("../../services/payments/paypal");

const create = asyncHandler(async (req, res) => {
  const data = await paypalService.createPayment({
    payload: req.validated.body,
    auth: req.auth || null,
    requestId: req.requestId
  });

  return successResponse(res, {
    message: "PayPal payment initialized",
    data,
    statusCode: 201
  });
});

const success = asyncHandler(async (req, res) => {
  const data = await paypalService.handlePaymentSuccess({
    orderId: req.validated.query.token,
    requestId: req.requestId
  });

  return successResponse(res, {
    message: data.status === "paid" ? "Payment captured" : "Payment verification completed",
    data
  });
});

const cancel = asyncHandler(async (req, res) => {
  const data = await paypalService.handlePaymentCancel({
    orderId: req.validated.query.token || "",
    bookingId: req.validated.query.bookingId || "",
    requestId: req.requestId
  });

  return successResponse(res, {
    message: "Payment cancellation handled",
    data
  });
});

const webhook = asyncHandler(async (req, res) => {
  const data = await paypalService.handleWebhookEvent({
    event: req.validated.body,
    headers: req.headers,
    requestId: req.requestId
  });

  return successResponse(res, {
    message: data.ignored ? "PayPal webhook accepted" : "PayPal webhook processed",
    data
  });
});

module.exports = {
  create,
  success,
  cancel,
  webhook
};
