const express = require("express");
const invoicesController = require("../controllers/invoices.controller");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/rbac");
const { loadSession } = require("../middleware/myBookingSession");
const { requireBookingAccess } = require("../middleware/bookingAccess");

const router = express.Router();

router.get(
  "/booking/:bookingReference",
  // Only the guest (payment key or My booking session for this booking) or staff; anyone else gets 404.
  loadSession,
  requireBookingAccess("bookingReference"),
  invoicesController.getByBookingReference
);
router.get(
  "/:invoiceNumber",
  authenticate,
  authorize("super_admin", "admin", "staff", "agent"),
  invoicesController.getByInvoiceNumber
);

module.exports = router;
