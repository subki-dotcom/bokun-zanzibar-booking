const rateLimit = require("express-rate-limit");

const isDevelopment = process.env.NODE_ENV !== "production";
const maxRequests = isDevelopment ? 5000 : 300;

const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests, please try again shortly",
    error: {
      code: "RATE_LIMIT_EXCEEDED",
      details: null
    },
    data: {},
    meta: {}
  }
});

module.exports = {
  globalRateLimiter
};
