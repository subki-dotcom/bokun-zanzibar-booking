const { v4: uuidv4 } = require("uuid");

const requestId = (req, res, next) => {
  const existing = req.headers["x-request-id"];
  req.requestId = existing || uuidv4();
  res.setHeader("x-request-id", req.requestId);
  next();
};

module.exports = requestId;