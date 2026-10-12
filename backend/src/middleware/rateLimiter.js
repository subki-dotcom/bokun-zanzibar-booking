const rateLimit = require("express-rate-limit");
const { env } = require("../config/env");

// req.ip honours the app's "trust proxy" setting: only addresses appended by trusted proxies are
// used. The leftmost X-Forwarded-For entry is whatever the client sent, so it is never a key.
const resolveClientIp = (req = {}) => req.ip || req.socket?.remoteAddress || "unknown";

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

const bookingRequestWriteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => resolveClientIp(req),
  message: {
    success: false,
    message: "Too many booking change requests. Please wait and try again later.",
    error: { code: "BOOKING_REQUEST_RATE_LIMITED", details: null },
    data: {},
    meta: {}
  }
});

const limitedMessage = (message, code) => ({
  success: false,
  message,
  error: { code, details: null },
  data: {},
  meta: {}
});

// Only failed lookups count, so customers opening their own booking repeatedly are never limited
// while reference or token guessing is.
const bookingLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => resolveClientIp(req),
  message: limitedMessage("Too many booking lookups. Please wait and try again later.", "BOOKING_LOOKUP_RATE_LIMITED")
});

// Link requests always answer the same way, so every request counts, not only failures.
const bookingAccessRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => resolveClientIp(req),
  message: limitedMessage("Too many verification requests. Please wait and try again later.", "BOOKING_ACCESS_RATE_LIMITED")
});

// Keyed by the booking itself, so spreading requests across addresses cannot flood one customer.
const bookingAccessReferenceLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `booking-access:${String(req.body?.bookingReference || "").trim().toUpperCase().slice(0, 64)}`,
  message: limitedMessage("Too many verification attempts. Please wait and try again later.", "BOOKING_ACCESS_RATE_LIMITED")
});

const bookingAccessRedeemLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => resolveClientIp(req),
  message: limitedMessage("Too many verification attempts. Please wait and try again later.", "BOOKING_ACCESS_RATE_LIMITED")
});

module.exports = {
  globalRateLimiter,
  bookingRequestWriteLimiter,
  bookingLookupLimiter,
  bookingAccessRequestLimiter,
  bookingAccessReferenceLimiter,
  bookingAccessRedeemLimiter,
  resolveClientIp
};
