const express = require("express");
const rateLimit = require("express-rate-limit");
const validateRequest = require("../../middleware/validateRequest");
const asyncHandler = require("../../utils/asyncHandler");
const { successResponse } = require("../../utils/apiResponse");
const { requestContext } = require("../services/audit");
const v = require("../validators");

const limiter = (windowMs, max, code) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many requests. Please wait and try again.", error: { code, details: null }, data: {}, meta: {} }
  });

// Requests per IP: locations and quotes per minute, bookings and lookups per 15 minutes.
const DEFAULT_LIMITS = Object.freeze({ locations: 120, quote: 60, bookings: 10, lookup: 60 });

// Public Transfer API for the website, mounted at /api/transfers. No account is needed: a booking is
// opened with its reference plus the access token returned when it was created.
const createTransferPublicRouter = ({ bookings, limits = DEFAULT_LIMITS }) => {
  const router = express.Router();
  const ok = (res, data, statusCode = 200) => successResponse(res, { data, statusCode });
  // Bookings are never cached by browsers or proxies.
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  router.get("/locations", limiter(60 * 1000, limits.locations, "TRANSFER_RATE_LIMITED"), asyncHandler(async (_req, res) => ok(res, await bookings.listPublicLocations())));

  router.post("/quote", limiter(60 * 1000, limits.quote, "TRANSFER_RATE_LIMITED"), validateRequest(v.publicQuoteSchema), asyncHandler(async (req, res) =>
    ok(res, await bookings.quote(req.validated.body))));

  router.post("/bookings", limiter(15 * 60 * 1000, limits.bookings, "TRANSFER_BOOKING_RATE_LIMITED"), validateRequest(v.publicBookingSchema), asyncHandler(async (req, res) => {
    const result = await bookings.createBooking({ input: req.validated.body, idempotencyKey: req.get("Idempotency-Key"), context: requestContext(req) });
    return ok(res, result, result.replayed ? 200 : 201);
  }));

  router.get("/bookings/:reference", limiter(15 * 60 * 1000, limits.lookup, "TRANSFER_RATE_LIMITED"), validateRequest(v.publicBookingLookupSchema), asyncHandler(async (req, res) =>
    ok(res, await bookings.getBooking({ reference: req.validated.params.reference, accessToken: req.get("X-Transfer-Access-Token") }))));

  return router;
};

module.exports = { DEFAULT_LIMITS, createTransferPublicRouter };
