const asyncHandler = require("../../utils/asyncHandler");
const { successResponse } = require("../../utils/apiResponse");
const pesapalService = require("../../services/payments/pesapal");

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
  const data = await pesapalService.verifyAndReconcilePesapalPayment({
    orderTrackingId:
      req.validated.query.OrderTrackingId ||
      req.validated.query.orderTrackingId ||
      "",
    orderMerchantReference:
      req.validated.query.OrderMerchantReference ||
      req.validated.query.orderMerchantReference ||
      "",
    requestId: req.requestId,
    source: "callback"
  });

  return successResponse(res, {
    message: data.status === "paid" ? "Payment verified" : "Payment verification completed",
    data
  });
});

const status = asyncHandler(async (req, res) => {
  const data = await pesapalService.getCustomerPaymentStatus({
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
    message: data.message,
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

const ipn = asyncHandler(async (req, res) => {
  const payload = {
    ...(req.query || {}),
    ...(req.body || {})
  };

  const data = await pesapalService.verifyAndReconcilePesapalPayment({
    orderTrackingId:
      payload.OrderTrackingId ||
      payload.orderTrackingId ||
      "",
    orderMerchantReference:
      payload.OrderMerchantReference ||
      payload.orderMerchantReference ||
      "",
    requestId: req.requestId,
    source: "ipn"
  });

  return successResponse(res, {
    message: data.status === "paid" ? "Pesapal IPN verified" : "Pesapal IPN handled",
    data
  });
});

module.exports = {
  create,
  success,
  status,
  cancel,
  ipn
};
