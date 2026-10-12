const express = require("express");
const bookingController = require("../controllers/bookings.controller");
const validateRequest = require("../middleware/validateRequest");
const { authenticate, optionalAuthenticate } = require("../middleware/auth");
const noStore = require("../middleware/noStore");
const { authorize } = require("../middleware/rbac");
const {
  bookingRequestWriteLimiter,
  bookingLookupLimiter,
  bookingAccessRequestLimiter,
  bookingAccessReferenceLimiter,
  bookingAccessRedeemLimiter
} = require("../middleware/rateLimiter");
const {
  quoteSchema,
  createBookingSchema,
  cancelBookingSchema,
  editBookingSchema,
  listPendingFinalizationsSchema,
  retryFinalizationSchema,
  reconcileFinalizationsSchema,
  bookingAccessRequestSchema,
  bookingAccessRedeemSchema
} = require("../validators/bookings.validation");
const bookingRequestsController = require("../controllers/bookingRequests.controller");
const bookingRequestSchemas = require("../validators/bookingRequests.validation");

const router = express.Router();

const optionalAuth = (req, res, next) => {
  if (!req.headers.authorization) {
    return next();
  }

  return authenticate(req, res, next);
};

router.post("/quote", optionalAuth, validateRequest(quoteSchema), bookingController.quote);
router.post("/create", optionalAuth, validateRequest(createBookingSchema), bookingController.create);
// Customer recovery: emails a single-use link to the address on the booking (same answer for any input).
router.post(
  "/access/request",
  noStore,
  bookingAccessRequestLimiter,
  bookingAccessReferenceLimiter,
  validateRequest(bookingAccessRequestSchema),
  bookingController.requestAccessLink
);
router.post(
  "/access/redeem",
  noStore,
  bookingAccessRedeemLimiter,
  validateRequest(bookingAccessRedeemSchema),
  bookingController.redeemAccessLink
);
router.post("/:bookingId/requests", bookingRequestWriteLimiter, validateRequest(bookingRequestSchemas.submitBookingRequestSchema), bookingRequestsController.submit);
router.get("/:bookingId/cancellation-estimate", validateRequest(bookingRequestSchemas.cancellationEstimateSchema), bookingRequestsController.cancellationEstimate);
router.get("/:id/requests", validateRequest(bookingRequestSchemas.customerRequestQuerySchema), bookingRequestsController.listCustomer);
router.get(
  "/recent",
  authenticate,
  authorize("super_admin", "admin", "staff", "agent"),
  bookingController.listRecent
);
router.get(
  "/stats",
  authenticate,
  authorize("super_admin", "admin", "staff"),
  bookingController.stats
);
router.get(
  "/finalization/pending",
  authenticate,
  authorize("super_admin", "admin", "staff"),
  validateRequest(listPendingFinalizationsSchema),
  bookingController.listPendingFinalizations
);
router.post(
  "/finalization/reconcile",
  authenticate,
  authorize("super_admin", "admin", "staff"),
  validateRequest(reconcileFinalizationsSchema),
  bookingController.reconcileFinalizations
);
router.post(
  "/:id/finalization/retry",
  authenticate,
  authorize("super_admin", "admin", "staff"),
  validateRequest(retryFinalizationSchema),
  bookingController.retryFinalization
);
// A reference alone never opens a booking: back office session, owning Agent, or customer access token.
router.get("/:reference", noStore, bookingLookupLimiter, optionalAuthenticate, bookingController.getByReference);
router.post(
  "/:id/cancel",
  authenticate,
  authorize("super_admin", "admin", "staff", "agent"),
  validateRequest(cancelBookingSchema),
  bookingController.cancel
);
router.post(
  "/:id/edit-request",
  authenticate,
  authorize("super_admin", "admin", "staff", "agent"),
  validateRequest(editBookingSchema),
  bookingController.editRequest
);

module.exports = router;
