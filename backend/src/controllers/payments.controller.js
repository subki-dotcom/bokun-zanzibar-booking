const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");
const paymentsService = require("../services/payments");
const pesapalService = require("../services/payments/pesapal");
const bookingsService = require("../services/bookings");

const listPayments = asyncHandler(async (_req, res) => {
  const data = await paymentsService.listPayments();

  return successResponse(res, {
    message: "Payments fetched",
    data
  });
});

const listReconciliation = asyncHandler(async (req, res) => {
  const query = req.validated?.query || req.query || {};
  const data = await paymentsService.listPaymentReconciliation({
    limit: Number(query.limit || 100)
  });

  return successResponse(res, {
    message: "Payment reconciliation fetched",
    data,
    meta: {
      count: data.length
    }
  });
});

const recheckPesapalStatus = asyncHandler(async (req, res) => {
  const data = await pesapalService.recheckPaymentByBookingReference({
    bookingReference: req.validated.params.bookingReference,
    requestId: req.requestId,
    source: "admin_recheck"
  });

  return successResponse(res, {
    message: data.paymentVerified
      ? "Pesapal payment verified and local invoice synced"
      : "Pesapal payment status rechecked",
    data
  });
});

const syncInvoice = asyncHandler(async (req, res) => {
  const data = await bookingsService.syncInvoiceForBookingReference({
    bookingReference: req.validated.params.bookingReference,
    auth: req.auth || null,
    requestId: req.requestId,
    reason: "Admin synced invoice from payment reconciliation"
  });

  return successResponse(res, {
    message: "Invoice synced from verified payment records",
    data
  });
});

const retryBokunFinalization = asyncHandler(async (req, res) => {
  const data = await bookingsService.retryBookingFinalization({
    bookingId: req.validated.body.bookingId,
    auth: req.auth || null,
    requestId: req.requestId,
    force: Boolean(req.validated.body.force)
  });

  return successResponse(res, {
    message: "Bokun finalization retry executed",
    data
  });
});

const markReviewed = asyncHandler(async (req, res) => {
  const data = await paymentsService.markPaymentReviewed({
    bookingReference: req.validated.params.bookingReference,
    reviewedBy: req.auth?.id || req.auth?.email || "",
    reviewNote: req.validated.body?.reviewNote || ""
  });

  return successResponse(res, {
    message: "Payment reconciliation marked as reviewed",
    data
  });
});

module.exports = {
  listPayments,
  listReconciliation,
  recheckPesapalStatus,
  syncInvoice,
  retryBokunFinalization,
  markReviewed
};
