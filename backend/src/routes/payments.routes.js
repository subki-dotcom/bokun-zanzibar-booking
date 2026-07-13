const express = require("express");
const paymentsController = require("../controllers/payments.controller");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/rbac");
const pesapalRoutes = require("./payments/pesapal.routes");
const dpoRoutes = require("./payments/dpo.routes");
const paypalRoutes = require("./payments/paypal.routes");
const validateRequest = require("../middleware/validateRequest");
const {
  listReconciliationSchema,
  bookingReferenceActionSchema,
  retryBokunFinalizationSchema,
  markReviewedSchema
} = require("../validators/payments/reconciliation.validation");

const router = express.Router();

router.use("/pesapal", pesapalRoutes);
router.use("/dpo", dpoRoutes);
router.use("/paypal", paypalRoutes);
router.get(
  "/reconciliation",
  authenticate,
  authorize("super_admin", "admin", "staff"),
  validateRequest(listReconciliationSchema),
  paymentsController.listReconciliation
);
router.post(
  "/reconciliation/:bookingReference/recheck-pesapal",
  authenticate,
  authorize("super_admin", "admin", "staff"),
  validateRequest(bookingReferenceActionSchema),
  paymentsController.recheckPesapalStatus
);
router.post(
  "/reconciliation/:bookingReference/sync-invoice",
  authenticate,
  authorize("super_admin", "admin", "staff"),
  validateRequest(bookingReferenceActionSchema),
  paymentsController.syncInvoice
);
router.post(
  "/reconciliation/:bookingReference/retry-bokun",
  authenticate,
  authorize("super_admin", "admin", "staff"),
  validateRequest(retryBokunFinalizationSchema),
  paymentsController.retryBokunFinalization
);
router.post(
  "/reconciliation/:bookingReference/mark-reviewed",
  authenticate,
  authorize("super_admin", "admin", "staff"),
  validateRequest(markReviewedSchema),
  paymentsController.markReviewed
);
router.get("/", authenticate, authorize("super_admin", "admin", "staff"), paymentsController.listPayments);

module.exports = router;
