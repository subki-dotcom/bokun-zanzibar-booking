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

  if (err?.name === "ValidationError") {
    return errorResponse(res, {
      statusCode: 422,
      code: "DATABASE_VALIDATION_ERROR",
      message: "Some saved booking data needs review before this action can be completed.",
      details: Object.keys(err.errors || {}).reduce((fields, key) => {
        fields[key] = err.errors[key]?.kind || err.errors[key]?.name || "invalid";
        return fields;
      }, {}),
      meta: { requestId: req.requestId }
    });
  }

  if (err?.name === "CastError") {
    return errorResponse(res, {
      statusCode: 422,
      code: "DATABASE_CAST_ERROR",
      message: "Some saved booking data has an invalid reference and needs review.",
      details: { path: err.path || "", kind: err.kind || "" },
      meta: { requestId: req.requestId }
    });
  }

  if (err?.code === 11000) {
    return errorResponse(res, {
      statusCode: 409,
      code: "DUPLICATE_RECORD",
      message: "This action has already been recorded. Please refresh and check the latest status.",
      details: { fields: Object.keys(err.keyPattern || err.keyValue || {}) },
      meta: { requestId: req.requestId }
    });
  }

  logger.error("Unhandled request error", {
    requestId: req.requestId,
    correlationId: req.correlationId || req.requestId,
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
      meta: { requestId: req.requestId, correlationId: req.correlationId || req.requestId }
    });
  }

  return errorResponse(res, {
    statusCode: 500,
    code: "INTERNAL_SERVER_ERROR",
    message: "Something went wrong",
    meta: { requestId: req.requestId, correlationId: req.correlationId || req.requestId }
  });
};

module.exports = errorHandler;
