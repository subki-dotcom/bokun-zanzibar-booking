const express = require("express");
const invoicesController = require("../controllers/invoices.controller");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/rbac");

const router = express.Router();

router.get(
  "/booking/:bookingReference",
  invoicesController.getByBookingReference
);
router.get(
  "/:invoiceNumber",
  authenticate,
  authorize("super_admin", "admin", "staff", "agent"),
  invoicesController.getByInvoiceNumber
);

module.exports = router;
