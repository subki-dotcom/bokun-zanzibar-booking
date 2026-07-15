const express = require("express");
const controller = require("../controllers/bookingRequests.controller");
const validateRequest = require("../middleware/validateRequest");
const { bookingRequestWriteLimiter } = require("../middleware/rateLimiter");
const schemas = require("../validators/bookingRequests.validation");

const router = express.Router();
router.get("/booking-requests/:id", validateRequest(schemas.customerRequestQuerySchema), controller.getCustomer);
router.post("/booking-requests/:id/customer-response", bookingRequestWriteLimiter, validateRequest(schemas.customerRequestResponseSchema), controller.respond);
router.post("/booking-requests/:id/cancel", bookingRequestWriteLimiter, validateRequest(schemas.customerRequestCancelSchema), controller.cancel);

module.exports = router;
