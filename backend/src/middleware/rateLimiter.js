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

// Opening a payment session can create a provider order, so it is limited per address.
const paymentSessionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => resolveClientIp(req),
  message: {
    success: false,
    message: "Too many payment attempts. Please wait a few minutes and try again.",
    error: { code: "PAYMENT_SESSION_RATE_LIMITED", details: null },
    data: {},
    meta: {}
  }
});

// The contact form sends an email to the team, so it is limited per address.
const contactMessageLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => resolveClientIp(req),
  message: {
    success: false,
    message: "Too many messages. Please try again later or chat with us on WhatsApp.",
    error: { code: "CONTACT_RATE_LIMITED", details: null },
    data: {},
    meta: {}
  }
});

const limited = (code, message) => ({ success: false, message, error: { code, details: null }, data: {}, meta: {} });
const lookupMessage = "Too many attempts. Please wait a few minutes and try again, or ask us on WhatsApp.";
const lookupReference = (req) => String(req.body?.reference || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 40);

// "Find your booking": per address, and per booking reference whatever the address (stops spreading guesses).
const myBookingLookupIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `lookup-ip:${resolveClientIp(req)}`,
  message: limited("MY_BOOKING_LOOKUP_RATE_LIMITED", lookupMessage)
});

const myBookingLookupReferenceLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `lookup-ref:${lookupReference(req) || resolveClientIp(req)}`,
  message: limited("MY_BOOKING_LOOKUP_RATE_LIMITED", lookupMessage)
});

// Opening sign-in links and payment-key sign-ins.
const myBookingSignInLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `signin-ip:${resolveClientIp(req)}`,
  message: limited("MY_BOOKING_SIGNIN_RATE_LIMITED", "Too many attempts. Please wait a few minutes and try again.")
});

// The contact-details code: sending and checking.
const myBookingCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `code:${String(req.bookingSession?._id || resolveClientIp(req))}`,
  message: limited("MY_BOOKING_CODE_RATE_LIMITED", "Too many attempts. Please wait a few minutes and try again.")
});

// "Email me a copy" of an invoice: per session.
const myBookingInvoiceEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `invoice-email:${String(req.bookingSession?._id || resolveClientIp(req))}`,
  message: limited("INVOICE_EMAIL_RATE_LIMITED", "You can email the invoice 3 times an hour. Please download the PDF instead.")
});

// The public invoice check (scan to verify).
const invoiceVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `verify:${resolveClientIp(req)}`,
  message: limited("INVOICE_VERIFY_RATE_LIMITED", "Too many checks. Please try again in a few minutes.")
});

module.exports = {
  resolveClientIp,
  myBookingInvoiceEmailLimiter,
  invoiceVerifyLimiter,
  myBookingLookupIpLimiter,
  myBookingLookupReferenceLimiter,
  myBookingSignInLimiter,
  myBookingCodeLimiter,
  globalRateLimiter,
  bookingRequestWriteLimiter,
  paymentSessionLimiter,
  contactMessageLimiter
};
