const asyncHandler = require("../../../utils/asyncHandler");
const { successResponse } = require("../../../utils/apiResponse");
const dpoService = require("./dpo.service");

const create = asyncHandler(async (req, res) => {
  const data = await dpoService.createPayment({
    payload: req.validated.body,
    auth: req.auth || null,
    requestId: req.requestId
  });

  return successResponse(res, {
    message: "DPO payment initialized",
    data,
    statusCode: 201
  });
});

const success = asyncHandler(async (req, res) => {
  const data = await dpoService.handlePaymentSuccess({
    transactionToken: req.validated.query.TransactionToken,
    requestId: req.requestId
  });

  return successResponse(res, {
    message: data.status === "paid" ? "Payment verified" : "Payment verification completed",
    data
  });
});

const cancel = asyncHandler(async (req, res) => {
  const data = await dpoService.handlePaymentCancel({
    transactionToken: req.validated.query.TransactionToken || "",
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
