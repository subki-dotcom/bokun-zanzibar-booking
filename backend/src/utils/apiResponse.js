const successResponse = (res, {
  message = "Request successful",
  data = {},
  meta = {},
  statusCode = 200
} = {}) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    meta
  });
};

const errorResponse = (res, {
  message = "Request failed",
  code = "REQUEST_FAILED",
  details = null,
  statusCode = 400,
  meta = {}
} = {}) => {
  return res.status(statusCode).json({
    success: false,
    message,
    error: {
      code,
      details
    },
    data: {},
    meta
  });
};

module.exports = {
  successResponse,
  errorResponse
};