const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");
const service = require("../services/bookingRequests");

const list = asyncHandler(async (req, res) => successResponse(res, { message: "Booking requests fetched", data: await service.adminListRequests({ filters: req.validated.query || {} }) }));
const get = asyncHandler(async (req, res) => successResponse(res, { message: "Booking request details fetched", data: await service.adminGetRequest({ requestId: req.validated.params.id }) }));
const approve = asyncHandler(async (req, res) => successResponse(res, { message: "Booking request approval processed", data: await service.approveRequest({ requestId: req.validated.params.id, auth: req.auth, payload: req.validated.body, traceId: req.requestId }) }));
const reject = asyncHandler(async (req, res) => successResponse(res, { message: "Booking request rejected", data: await service.rejectRequest({ requestId: req.validated.params.id, auth: req.auth, customerFacingReason: req.validated.body.customerFacingReason, internalNote: req.validated.body.internalNote, traceId: req.requestId }) }));
const requestInformation = asyncHandler(async (req, res) => successResponse(res, { message: "Customer information requested", data: await service.requestMoreInformation({ requestId: req.validated.params.id, auth: req.auth, customerFacingReason: req.validated.body.customerFacingReason, internalNote: req.validated.body.internalNote, traceId: req.requestId }) }));
const recalculate = asyncHandler(async (req, res) => successResponse(res, { message: "Availability and pricing recalculated", data: await service.recalculateRequest({ requestId: req.validated.params.id, auth: req.auth, traceId: req.requestId }) }));
const retryBokun = asyncHandler(async (req, res) => successResponse(res, { message: "Bokun synchronization retried", data: await service.retryBokunSync({ requestId: req.validated.params.id, auth: req.auth, traceId: req.requestId }) }));
const retryEmail = asyncHandler(async (req, res) => successResponse(res, { message: "Email delivery retried", data: await service.retryRequestEmail({ requestId: req.validated.params.id, auth: req.auth, traceId: req.requestId }) }));
const markAdjustmentPaid = asyncHandler(async (req, res) => successResponse(res, { message: "Additional payment recorded", data: await service.markAdjustmentPaid({ adjustmentId: req.validated.params.id, auth: req.auth, paymentReference: req.validated.body.paymentReference, traceId: req.requestId }) }));
const updateRefund = asyncHandler(async (req, res) => successResponse(res, { message: "Refund status updated", data: await service.updateRefundStatus({ refundId: req.validated.params.id, auth: req.auth, ...req.validated.body, traceId: req.requestId }) }));

module.exports = { list, get, approve, reject, requestInformation, recalculate, retryBokun, retryEmail, markAdjustmentPaid, updateRefund };
