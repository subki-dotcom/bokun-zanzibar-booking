const { ZodError } = require("zod");
const { errorResponse } = require("../utils/apiResponse");
const AppError = require("../utils/AppError");
const logger = require("../config/logger");

const errorHandler = (err, req, res, _next) => {
  const statusCode = err.statusCode || 500;

  if (err instanceof ZodError) {
    return errorResponse(res, {
      statusCode: 422,
      code: "VALIDATION_ERROR",
      message: "Validation failed",
      details: err.flatten()
    });
  }

  logger.error("Unhandled request error", {
    requestId: req.requestId,
    path: req.originalUrl,
    method: req.method,
    message: err.message,
    stack: process.env.NODE_ENV === "production" ? undefined : err.stack
  });

  if (err instanceof AppError || err.isOperational) {
    return errorResponse(res, {
      statusCode,
      code: err.code || "REQUEST_ERROR",
      message: err.message,
      details: err.details || null,
      meta: { requestId: req.requestId }
    });
  }

  return errorResponse(res, {
    statusCode: 500,
    code: "INTERNAL_SERVER_ERROR",
    message: "Something went wrong",
    meta: { requestId: req.requestId }
  });
};

module.exports = errorHandler;