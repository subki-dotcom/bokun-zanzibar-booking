const { v4: uuidv4 } = require("uuid");

const requestId = (req, res, next) => {
  const existing = req.headers["x-request-id"];
  req.requestId = existing || uuidv4();
  req.correlationId = req.requestId;
  res.setHeader("x-request-id", req.requestId);
  res.setHeader("x-correlation-id", req.correlationId);
  next();
};

module.exports = requestId;
