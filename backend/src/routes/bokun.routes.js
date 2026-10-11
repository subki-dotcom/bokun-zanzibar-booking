const express = require("express");
const bokunController = require("../controllers/bokun.controller");
const validateRequest = require("../middleware/validateRequest");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/rbac");
const {
  importConfirmedBookingsSchema,
  resyncBokunBookingSchema
} = require("../validators/bokun.validation");

const router = express.Router();

router.post(
  "/admin/bookings/import-confirmed",
  authenticate,
  authorize("super_admin", "admin", "staff"),
  validateRequest(importConfirmedBookingsSchema),
  bokunController.importConfirmedBookings
);
router.post(
  "/admin/bookings/:reference/resync",
  authenticate,
  authorize("super_admin", "admin", "staff"),
  validateRequest(resyncBokunBookingSchema),
  bokunController.resyncBooking
);
router.get(
  "/admin/sync-status",
  authenticate,
  authorize("super_admin", "admin", "staff"),
  bokunController.syncStatus
);
router.get("/products", bokunController.products);
router.get("/countries", bokunController.countries);
router.get("/pickup-places", bokunController.pickupPlaces);
router.get("/products/:productId", bokunController.productDetails);
router.get("/products/:productId/booking-config", bokunController.productBookingConfig);
router.post("/products/:productId/live-quote", bokunController.productLiveQuote);
router.post("/availability", bokunController.availability);
router.post("/booking-questions", bokunController.bookingQuestions);
// Direct supplier writes and booking lookups bypass payment verification and expose customer data, so they are
// restricted to administrators. Customer checkouts go through the payment flow, never these endpoints.
const adminOnly = [authenticate, authorize("super_admin", "admin")];
router.post("/bookings", ...adminOnly, bokunController.createBooking);
router.get("/bookings/:reference", ...adminOnly, bokunController.lookupBooking);
router.post("/bookings/:bookingId/cancel", ...adminOnly, bokunController.cancelBooking);
router.post("/bookings/:bookingId/edit", ...adminOnly, bokunController.editBooking);

module.exports = router;
