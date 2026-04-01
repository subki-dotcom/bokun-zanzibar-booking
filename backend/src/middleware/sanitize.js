const mongoSanitize = require("express-mongo-sanitize");

const trimStrings = (obj) => {
  if (!obj || typeof obj !== "object") {
    return obj;
  }

  Object.keys(obj).forEach((key) => {
    const value = obj[key];

    if (typeof value === "string") {
      obj[key] = value.trim();
      return;
    }

    if (value && typeof value === "object") {
      trimStrings(value);
    }
  });

  return obj;
};

const sanitizePayload = (req, _res, next) => {
  trimStrings(req.body);
  trimStrings(req.query);
  next();
};

const sanitizeMongo = mongoSanitize();

module.exports = {
  sanitizePayload,
  sanitizeMongo
};