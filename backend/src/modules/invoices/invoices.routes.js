const express = require("express");
const invoicesController = require("./invoices.controller");
const { authenticate } = require("../../middleware/auth");
const { authorize } = require("../../middleware/rbac");

const router = express.Router();

router.get(
  "/booking/:bookingReference",
  authenticate,
  authorize("super_admin", "admin", "staff", "agent"),
  invoicesController.getByBookingReference
);
router.get(
  "/:invoiceNumber",
  authenticate,
  authorize("super_admin", "admin", "staff", "agent"),
  invoicesController.getByInvoiceNumber
);

module.exports = router;