const { errorResponse } = require("../utils/apiResponse");

const notFound = (req, res) => {
  return errorResponse(res, {
    statusCode: 404,
    code: "NOT_FOUND",
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    meta: { requestId: req.requestId }
  });
};

module.exports = notFound;