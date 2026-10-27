const express = require("express");
const invoicesController = require("../controllers/invoices.controller");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/rbac");
const { loadSession, noStore } = require("../middleware/myBookingSession");
const { requireBookingAccess } = require("../middleware/bookingAccess");
const { invoiceVerifyLimiter } = require("../middleware/rateLimiter");

const router = express.Router();
const staff = [authenticate, authorize("super_admin", "admin", "staff", "agent")];

// The guest's own invoice (payment key or My booking session), or staff.
router.get(
  "/booking/:bookingReference",
  noStore,
  loadSession,
  requireBookingAccess("bookingReference"),
  invoicesController.getByBookingReference
);
// "Scan to verify": public, no personal data.
router.get("/verify/:token", noStore, invoiceVerifyLimiter, invoicesController.verify);
// Staff: any invoice or credit note as the customer document, and its PDF.
router.get("/:invoiceNumber/document", noStore, staff, invoicesController.documentByNumber);
router.get("/:invoiceNumber/pdf", noStore, staff, invoicesController.pdfByNumber);
router.get("/:invoiceNumber", staff, invoicesController.getByInvoiceNumber);

module.exports = router;
