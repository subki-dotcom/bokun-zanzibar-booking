const express = require("express");
const bookingController = require("../controllers/bookings.controller");
const validateRequest = require("../middleware/validateRequest");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/rbac");
const { bookingRequestWriteLimiter, paymentSessionLimiter } = require("../middleware/rateLimiter");
const paymentRecoveryController = require("../controllers/paymentRecovery.controller");
const { paymentStatusSchema, paymentSessionSchema } = require("../validators/paymentRecovery.validation");
const {
  quoteSchema,
  createBookingSchema,
  cancelBookingSchema,
  editBookingSchema,
  listPendingFinalizationsSchema,
  retryFinalizationSchema,
  reconcileFinalizationsSchema
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
// Customer payment pages (any browser, with the payment link's key).
router.get("/:reference/payment-status", validateRequest(paymentStatusSchema), paymentRecoveryController.status);
router.post("/:reference/payment-session", paymentSessionLimiter, validateRequest(paymentSessionSchema), paymentRecoveryController.session);
router.get("/:reference", bookingController.getByReference);
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
