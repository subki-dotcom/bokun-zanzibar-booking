const rateLimit = require("express-rate-limit");
const { env } = require("../config/env");

const parseForwardedIp = (headerValue = "") => {
  if (!headerValue || typeof headerValue !== "string") {
    return "";
  }

  const first = headerValue.split(",")[0] || "";
  return String(first).trim();
};

const resolveClientIp = (req = {}) => {
  const forwardedIp = parseForwardedIp(req.headers?.["x-forwarded-for"]);
  if (forwardedIp) {
    return forwardedIp;
  }

  return req.ip || req.socket?.remoteAddress || "unknown";
};

const globalRateLimiter = rateLimit({
  windowMs: Math.max(60 * 1000, Number(env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000)),
  max: Math.max(100, Number(env.RATE_LIMIT_MAX || 1200)),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => resolveClientIp(req),
  skip: (req) =>
    req.path === "/" ||
    req.path === "/health" ||
    req.path === "/api/health",
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
