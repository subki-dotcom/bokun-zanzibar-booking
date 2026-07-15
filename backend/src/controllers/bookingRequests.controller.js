const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");
const service = require("../services/bookingRequests");

const submit = asyncHandler(async (req, res) => successResponse(res, { message: "Your request has been received and is awaiting review.", data: await service.submitRequest({ bookingId: req.validated.params.bookingId, customerEmail: req.validated.body.customerEmail, payload: req.validated.body, requestId: req.requestId }), statusCode: 201 }));
const listCustomer = asyncHandler(async (req, res) => successResponse(res, { message: "Booking requests fetched", data: await service.listCustomerRequests({ bookingId: req.validated.params.id, customerEmail: req.validated.query.customerEmail }) }));
const cancellationEstimate = asyncHandler(async (req, res) => successResponse(res, { message: "Cancellation estimate fetched", data: await service.getCancellationEstimate({ bookingId: req.validated.params.bookingId, customerEmail: req.validated.query.customerEmail }) }));
const getCustomer = asyncHandler(async (req, res) => successResponse(res, { message: "Booking request fetched", data: await service.getCustomerRequest({ requestId: req.validated.params.id, customerEmail: req.validated.query.customerEmail }) }));
const respond = asyncHandler(async (req, res) => successResponse(res, { message: "Your information was sent to our team.", data: await service.customerResponse({ requestId: req.validated.params.id, customerEmail: req.validated.body.customerEmail, notes: req.validated.body.notes, traceId: req.requestId }) }));
const cancel = asyncHandler(async (req, res) => successResponse(res, { message: "Booking request cancelled", data: await service.cancelCustomerRequest({ requestId: req.validated.params.id, customerEmail: req.validated.body.customerEmail, traceId: req.requestId }) }));

module.exports = { submit, listCustomer, cancellationEstimate, getCustomer, respond, cancel };
