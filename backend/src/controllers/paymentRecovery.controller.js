const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");
const paymentRecovery = require("../services/payments/paymentRecovery");

const status = asyncHandler(async (req, res) => {
  const query = req.validated?.query || req.query;
  const data = await paymentRecovery.getPaymentStatus({
    reference: req.params.reference,
    key: query.key,
    recheck: ["1", "true"].includes(String(query.recheck || "")),
    requestId: req.requestId
  });
  res.set("Cache-Control", "no-store");
  return successResponse(res, { message: "Payment status", data });
});

const session = asyncHandler(async (req, res) => {
  const body = req.validated?.body || req.body;
  const data = await paymentRecovery.createPaymentSession({
    reference: req.params.reference,
    key: body.key,
    provider: body.provider || "",
    requestId: req.requestId,
    checkoutOrigin: req.get("origin") || ""
  });
  res.set("Cache-Control", "no-store");
  return successResponse(res, { message: "Payment session", data });
});

module.exports = { status, session };
