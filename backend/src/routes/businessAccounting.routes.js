const express = require("express");
const businessAccountingController = require("../controllers/businessAccounting.controller");
const { authenticate } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/rbac");
const { PERMISSIONS } = require("../security/permissions");
const validateRequest = require("../middleware/validateRequest");
const {
  accountsReceivableQuerySchema,
  accountsPayableQuerySchema,
  bookingFinancialFactsSchema,
  authoritativeFinancialSummarySchema,
  foundationQuerySchema,
  postBookingContributionSchema
} = require("../validators/businessAccounting.validation");
const receivablesController = require("../controllers/customerReceivables.controller");
const receivableSchemas = require("../validators/customerReceivables.validation");

const router = express.Router();

router.use(authenticate);

router.get(
  "/accounts-receivable",
  authorizePermission(PERMISSIONS.BUSINESS_ACCOUNTING_READ),
  validateRequest(accountsReceivableQuerySchema),
  businessAccountingController.accountsReceivable
);

router.get(
  "/accounts-payable",
  authorizePermission(PERMISSIONS.BUSINESS_ACCOUNTING_READ),
  validateRequest(accountsPayableQuerySchema),
  businessAccountingController.accountsPayable
);

router.get(
  "/foundation",
  authorizePermission(PERMISSIONS.BUSINESS_ACCOUNTING_READ),
  validateRequest(foundationQuerySchema),
  businessAccountingController.foundation
);

router.get(
  "/bookings/:bookingReference/financial-facts",
  authorizePermission(PERMISSIONS.BUSINESS_ACCOUNTING_READ),
  validateRequest(bookingFinancialFactsSchema),
  businessAccountingController.bookingFinancialFacts
);

router.get(
  "/authoritative-summary",
  authorizePermission(PERMISSIONS.BUSINESS_ACCOUNTING_READ),
  validateRequest(authoritativeFinancialSummarySchema),
  businessAccountingController.authoritativeFinancialSummary
);

router.post(
  "/postings/bookings/:bookingReference",
  authorizePermission(PERMISSIONS.BUSINESS_ACCOUNTING_WRITE),
  validateRequest(postBookingContributionSchema),
  businessAccountingController.postBookingContribution
);

// Customer receivable workflows: manual (cash/bank/mobile money) and partial payments, standalone invoices,
// delivery-based revenue and approved invoice adjustments.
router.post("/receivables/payments", authorizePermission(PERMISSIONS.PAYMENT_RECONCILIATION_WRITE), validateRequest(receivableSchemas.recordManualPaymentSchema), receivablesController.recordManualPayment);
router.post("/receivables/payments/:paymentId/void", authorizePermission(PERMISSIONS.PAYMENT_RECONCILIATION_WRITE), validateRequest(receivableSchemas.voidManualPaymentSchema), receivablesController.voidManualPayment);
router.post("/invoices", authorizePermission(PERMISSIONS.BUSINESS_ACCOUNTING_WRITE), validateRequest(receivableSchemas.createStandaloneInvoiceSchema), receivablesController.createStandaloneInvoice);
router.post("/invoices/:invoiceNumber/delivery", authorizePermission(PERMISSIONS.GL_APPROVE_JOURNAL), validateRequest(receivableSchemas.confirmDeliverySchema), receivablesController.confirmDelivery);
router.post("/invoices/:invoiceNumber/adjustments", authorizePermission(PERMISSIONS.GL_APPROVE_JOURNAL), validateRequest(receivableSchemas.invoiceAdjustmentSchema), receivablesController.applyInvoiceAdjustment);

module.exports = router;
