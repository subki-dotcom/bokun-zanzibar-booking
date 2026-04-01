const express = require("express");
const bookingController = require("./bookings.controller");
const validateRequest = require("../../middleware/validateRequest");
const { authenticate } = require("../../middleware/auth");
const { authorize } = require("../../middleware/rbac");
const {
  quoteSchema,
  createBookingSchema,
  cancelBookingSchema,
  editBookingSchema
} = require("./bookings.validation");

const router = express.Router();

const optionalAuth = (req, res, next) => {
  if (!req.headers.authorization) {
    return next();
  }

  return authenticate(req, res, next);
};

router.post("/quote", optionalAuth, validateRequest(quoteSchema), bookingController.quote);
router.post("/create", optionalAuth, validateRequest(createBookingSchema), bookingController.create);
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