const express = require("express");
const invoicesController = require("../controllers/invoices.controller");
const { authenticate, optionalAuthenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/rbac");
const noStore = require("../middleware/noStore");
const { bookingLookupLimiter } = require("../middleware/rateLimiter");

const router = express.Router();

// Customer invoice: back office session, owning Agent, or the booking's customer access token.
router.get(
  "/booking/:bookingReference",
  noStore,
  bookingLookupLimiter,
  optionalAuthenticate,
  invoicesController.getByBookingReference
);
// Agents only reach invoices for bookings they own; ownership is checked in the service.
router.get(
  "/:invoiceNumber",
  noStore,
  authenticate,
  authorize("super_admin", "admin", "staff", "agent"),
  invoicesController.getByInvoiceNumber
);

module.exports = router;
