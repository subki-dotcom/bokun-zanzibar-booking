const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");
const receivables = require("../services/customerReceivables");

const recordManualPayment = asyncHandler(async (req, res) => {
  const data = await receivables.recordManualPayment({ input: req.validated.body, auth: req.auth, requestId: req.requestId });
  return successResponse(res, { message: data.replay ? "Payment already recorded" : "Payment recorded", data, statusCode: data.replay ? 200 : 201 });
});

const voidManualPayment = asyncHandler(async (req, res) => successResponse(res, {
  message: "Payment voided",
  data: await receivables.voidManualPayment({ paymentId: req.validated.params.paymentId, reason: req.validated.body.reason, auth: req.auth, requestId: req.requestId })
}));

const createStandaloneInvoice = asyncHandler(async (req, res) => {
  const data = await receivables.createStandaloneInvoice({ input: req.validated.body, auth: req.auth, requestId: req.requestId });
  return successResponse(res, { message: data.replay ? "Invoice already issued" : "Invoice issued", data, statusCode: data.replay ? 200 : 201 });
});

const confirmDelivery = asyncHandler(async (req, res) => successResponse(res, {
  message: "Delivery confirmation processed",
  data: await receivables.confirmStandaloneDelivery({ invoiceNumber: req.validated.params.invoiceNumber, input: req.validated.body, auth: req.auth, requestId: req.requestId })
}));

const applyInvoiceAdjustment = asyncHandler(async (req, res) => successResponse(res, {
  message: "Invoice adjustment processed",
  data: await receivables.applyInvoiceAdjustment({ invoiceNumber: req.validated.params.invoiceNumber, input: req.validated.body, auth: req.auth, requestId: req.requestId })
}));

module.exports = { applyInvoiceAdjustment, confirmDelivery, createStandaloneInvoice, recordManualPayment, voidManualPayment };
