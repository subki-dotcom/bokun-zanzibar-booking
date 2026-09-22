const express = require("express");
const bookingAccountingController = require("../controllers/bookingAccounting.controller");
const { authenticate } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/rbac");
const validateRequest = require("../middleware/validateRequest");
const { PERMISSIONS } = require("../security/permissions");
const {
  archiveCostTemplateSchema,
  bookingExpenseParamsSchema,
  bookingExpenseCompletionSchema,
  bookingExpenseVoidSchema,
  bookingExpenseWriteSchema,
  bookingAccountingQuerySchema,
  bokunFinancialPreviewParamsSchema,
  costTemplateParamsSchema,
  costTemplatePreviewSchema,
  costTemplateWriteSchema
} = require("../validators/bookingAccounting.validation");

const router = express.Router();

router.use(authenticate, authorizePermission(PERMISSIONS.BOOKING_ACCOUNTING_READ));

router.get("/dashboard", validateRequest(bookingAccountingQuerySchema), bookingAccountingController.dashboard);
router.get("/booking-payment", validateRequest(require('../validators/analytics.validation').salesAnalyticsQuerySchema), bookingAccountingController.bookingPayment);
router.get("/invoices", validateRequest(bookingAccountingQuerySchema), bookingAccountingController.invoices);
router.get("/refunds", validateRequest(bookingAccountingQuerySchema), bookingAccountingController.refunds);
router.get("/expenses", validateRequest(bookingAccountingQuerySchema), bookingAccountingController.expenses);
router.get("/expenses/:expenseId", validateRequest(bookingExpenseParamsSchema), bookingAccountingController.bookingExpense);
router.post(
  "/expenses",
  authorizePermission(PERMISSIONS.BOOKING_ACCOUNTING_WRITE),
  validateRequest(bookingExpenseWriteSchema),
  bookingAccountingController.createBookingExpense
);
router.put(
  "/expenses/:expenseId",
  authorizePermission(PERMISSIONS.BOOKING_ACCOUNTING_WRITE),
  validateRequest(bookingExpenseWriteSchema),
  bookingAccountingController.updateBookingExpense
);
router.post(
  "/expenses/:expenseId/void",
  authorizePermission(PERMISSIONS.BOOKING_ACCOUNTING_WRITE),
  validateRequest(bookingExpenseVoidSchema),
  bookingAccountingController.voidBookingExpense
);
router.post(
  "/expenses/:expenseId/completion",
  authorizePermission(PERMISSIONS.BOOKING_ACCOUNTING_WRITE),
  validateRequest(bookingExpenseCompletionSchema),
  bookingAccountingController.updateBookingExpenseCompletion
);
router.get("/cost-templates", validateRequest(bookingAccountingQuerySchema), bookingAccountingController.costTemplates);
router.post(
  "/cost-templates/sync-bokun-products",
  authorizePermission(PERMISSIONS.BOOKING_ACCOUNTING_WRITE),
  bookingAccountingController.syncCostTemplateBokunProducts
);
router.post("/cost-templates/preview", validateRequest(costTemplatePreviewSchema), bookingAccountingController.previewCostTemplate);
router.get("/cost-templates/:templateId", validateRequest(costTemplateParamsSchema), bookingAccountingController.costTemplate);
router.post(
  "/cost-templates",
  authorizePermission(PERMISSIONS.BOOKING_ACCOUNTING_WRITE),
  validateRequest(costTemplateWriteSchema),
  bookingAccountingController.createCostTemplate
);
router.put(
  "/cost-templates/:templateId",
  authorizePermission(PERMISSIONS.BOOKING_ACCOUNTING_WRITE),
  validateRequest(costTemplateWriteSchema),
  bookingAccountingController.updateCostTemplate
);
router.post(
  "/cost-templates/:templateId/archive",
  authorizePermission(PERMISSIONS.BOOKING_ACCOUNTING_WRITE),
  validateRequest(archiveCostTemplateSchema),
  bookingAccountingController.archiveCostTemplate
);
router.get("/profitability", validateRequest(bookingAccountingQuerySchema), bookingAccountingController.profitability);
router.get("/reconciliation", validateRequest(bookingAccountingQuerySchema), bookingAccountingController.reconciliation);
router.get("/reconciliation-export", validateRequest(bookingAccountingQuerySchema), bookingAccountingController.exportReconciliation);
router.get("/reconciliation/:bookingId/bokun-financial-preview", validateRequest(bokunFinancialPreviewParamsSchema), bookingAccountingController.bokunFinancialPreview);
router.get("/reconciliation/:bookingId/bokun-financial-preview/refresh", validateRequest(bokunFinancialPreviewParamsSchema), bookingAccountingController.refreshBokunFinancialPreview);
router.get("/reconciliation/:bookingId", bookingAccountingController.reconciliationDetail);
router.post("/reconciliation/:bookingId/run", authorizePermission(PERMISSIONS.BOOKING_ACCOUNTING_WRITE), bookingAccountingController.runReconciliation);

module.exports = router;
