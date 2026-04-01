const express = require("express");
const bokunController = require("./bokun.controller");

const router = express.Router();

router.get("/products", bokunController.products);
router.get("/products/:productId", bokunController.productDetails);
router.get("/products/:productId/booking-config", bokunController.productBookingConfig);
router.post("/products/:productId/live-quote", bokunController.productLiveQuote);
router.post("/availability", bokunController.availability);
router.post("/booking-questions", bokunController.bookingQuestions);
router.post("/bookings", bokunController.createBooking);
router.get("/bookings/:reference", bokunController.lookupBooking);
router.post("/bookings/:bookingId/cancel", bokunController.cancelBooking);
router.post("/bookings/:bookingId/edit", bokunController.editBooking);

module.exports = router;
