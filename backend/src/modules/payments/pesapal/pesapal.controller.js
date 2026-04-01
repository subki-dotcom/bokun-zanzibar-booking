const asyncHandler = require("../../../utils/asyncHandler");
const { successResponse } = require("../../../utils/apiResponse");
const pesapalService = require("./pesapal.service");

const create = asyncHandler(async (req, res) => {
  const data = await pesapalService.createPayment({
    payload: req.validated.body,
    auth: req.auth || null,
    requestId: req.requestId
  });

  return successResponse(res, {
    message: "Pesapal payment initialized",
    data,
    statusCode: 201
  });
});

const success = asyncHandler(async (req, res) => {
  const data = await pesapalService.handlePaymentSuccess({
    orderTrackingId:
      req.validated.query.OrderTrackingId ||
      req.validated.query.orderTrackingId ||
      "",
    orderMerchantReference:
      req.validated.query.OrderMerchantReference ||
      req.validated.query.orderMerchantReference ||
      "",
    requestId: req.requestId
  });

  return successResponse(res, {
    message: data.status === "paid" ? "Payment verified" : "Payment verification completed",
    data
  });
});

const cancel = asyncHandler(async (req, res) => {
  const data = await pesapalService.handlePaymentCancel({
    orderTrackingId:
      req.validated.query.OrderTrackingId ||
      req.validated.query.orderTrackingId ||
      "",
    orderMerchantReference:
      req.validated.query.OrderMerchantReference ||
      req.validated.query.orderMerchantReference ||
      "",
    bookingId: req.validated.query.bookingId || "",
    requestId: req.requestId
  });

  return successResponse(res, {
    message: "Payment cancellation handled",
    data
  });
});

module.exports = {
  create,
  success,
  cancel
};
