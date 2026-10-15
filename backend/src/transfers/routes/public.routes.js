const express = require("express");
const rateLimit = require("express-rate-limit");
const validateRequest = require("../../middleware/validateRequest");
const asyncHandler = require("../../utils/asyncHandler");
const { successResponse } = require("../../utils/apiResponse");
const { requestContext } = require("../services/audit");
const { publicBookingView } = require("../services/bookings");
const v = require("../validators");

const limiter = (windowMs, max, code) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many requests. Please wait and try again.", error: { code, details: null }, data: {}, meta: {} }
  });

// Requests per IP: locations and quotes per minute; bookings, lookups, payment starts and returns per 15 minutes.
const DEFAULT_LIMITS = Object.freeze({ locations: 120, quote: 60, bookings: 10, lookup: 60, payments: 20 });

// Public Transfer API for the website, mounted at /api/transfers. No account is needed: a booking is
// opened with its reference plus the access token returned when it was created.
const createTransferPublicRouter = ({ bookings, payments, popularRoutes, limits = DEFAULT_LIMITS }) => {
  const router = express.Router();
  const ok = (res, data, statusCode = 200) => successResponse(res, { data, statusCode });
  // Bookings are never cached by browsers or proxies.
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  router.get("/locations", limiter(60 * 1000, limits.locations, "TRANSFER_RATE_LIMITED"), asyncHandler(async (_req, res) => ok(res, await bookings.listPublicLocations())));

  // The popular routes shown under the booking widget, each with its price from the pricing engine.
  router.get("/popular-routes", limiter(60 * 1000, limits.locations, "TRANSFER_RATE_LIMITED"), asyncHandler(async (_req, res) =>
    ok(res, popularRoutes ? await popularRoutes.listPublic() : [])));

  router.get("/options", limiter(60 * 1000, limits.locations, "TRANSFER_RATE_LIMITED"), asyncHandler(async (_req, res) => ok(res, await bookings.publicOptions())));

  router.post("/quote", limiter(60 * 1000, limits.quote, "TRANSFER_RATE_LIMITED"), validateRequest(v.publicQuoteSchema), asyncHandler(async (req, res) =>
    ok(res, await bookings.quote(req.validated.body))));

  router.post("/bookings", limiter(15 * 60 * 1000, limits.bookings, "TRANSFER_BOOKING_RATE_LIMITED"), validateRequest(v.publicBookingSchema), asyncHandler(async (req, res) => {
    const result = await bookings.createBooking({ input: req.validated.body, idempotencyKey: req.get("Idempotency-Key"), context: requestContext(req) });
    return ok(res, result, result.replayed ? 200 : 201);
  }));

  router.get("/bookings/:reference", limiter(15 * 60 * 1000, limits.lookup, "TRANSFER_RATE_LIMITED"), validateRequest(v.publicBookingLookupSchema), asyncHandler(async (req, res) => {
    const booking = await bookings.loadForCustomer({ reference: req.validated.params.reference, accessToken: req.get("X-Transfer-Access-Token") });
    return ok(res, { ...publicBookingView(booking), canPay: Boolean(payments?.canPay(booking)) });
  }));

  // Payment (Pesapal). Starting needs the booking's access token; the return page and the IPN carry Pesapal's ids
  // only, and both make the server ask Pesapal for the transaction before anything is recorded.
  const paymentLimit = limiter(15 * 60 * 1000, limits.payments, "TRANSFER_PAYMENT_RATE_LIMITED");
  router.post("/bookings/:reference/payments", paymentLimit, validateRequest(v.publicPaymentStartSchema), asyncHandler(async (req, res) =>
    ok(res, await payments.startPayment({ reference: req.validated.params.reference, accessToken: req.get("X-Transfer-Access-Token"), context: requestContext(req) }), 201)));

  router.get("/payments/return", paymentLimit, validateRequest(v.paymentReturnSchema), asyncHandler(async (req, res) => {
    const query = req.validated.query;
    return ok(res, await payments.verify({ orderTrackingId: query.OrderTrackingId, merchantReference: query.OrderMerchantReference, source: "RETURN", context: requestContext(req) }));
  }));

  // Pesapal's IPN, answered in the shape Pesapal expects: status 200 when handled, 500 so that Pesapal retries.
  const ipn = async (req, res) => {
    const input = { ...(req.query || {}), ...(req.body && typeof req.body === "object" ? req.body : {}) };
    const orderTrackingId = String(input.OrderTrackingId || input.orderTrackingId || "").slice(0, 100);
    const merchantReference = String(input.OrderMerchantReference || input.orderMerchantReference || "").slice(0, 100);
    const reply = (status) => res.status(200).json({ orderNotificationType: String(input.OrderNotificationType || "IPNCHANGE").slice(0, 40), orderTrackingId, orderMerchantReference: merchantReference, status });
    try {
      await payments.verify({ orderTrackingId, merchantReference, source: "IPN", context: requestContext(req) });
      return reply(200);
    } catch (error) {
      // An order we never created is not retried; anything else (Pesapal or database unavailable) is.
      return reply(error.statusCode === 404 ? 200 : 500);
    }
  };
  router.get("/payments/ipn", ipn);
  router.post("/payments/ipn", ipn);

  return router;
};

module.exports = { DEFAULT_LIMITS, createTransferPublicRouter };
