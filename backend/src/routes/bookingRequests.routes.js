const express = require("express");
const controller = require("../controllers/bookingRequests.controller");
const validateRequest = require("../middleware/validateRequest");
const { bookingRequestWriteLimiter } = require("../middleware/rateLimiter");
const schemas = require("../validators/bookingRequests.validation");
const { loadSession, requireSession, requireCsrf } = require("../middleware/myBookingSession");
const { requireOwnBookingRequest } = require("../middleware/bookingAccess");

// Only the guest signed in to the booking the request belongs to.
const own = [loadSession, requireSession, requireOwnBookingRequest("id")];

const router = express.Router();
router.get("/booking-requests/:id", own, validateRequest(schemas.customerRequestQuerySchema), controller.getCustomer);
router.post("/booking-requests/:id/customer-response", own, requireCsrf, bookingRequestWriteLimiter, validateRequest(schemas.customerRequestResponseSchema), controller.respond);
router.post("/booking-requests/:id/cancel", own, requireCsrf, bookingRequestWriteLimiter, validateRequest(schemas.customerRequestCancelSchema), controller.cancel);

module.exports = router;
