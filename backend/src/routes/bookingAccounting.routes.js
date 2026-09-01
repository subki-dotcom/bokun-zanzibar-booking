const express = require("express");
const bookingAccountingController = require("../controllers/bookingAccounting.controller");
const { authenticate } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/rbac");
const validateRequest = require("../middleware/validateRequest");
const { PERMISSIONS } = require("../security/permissions");
const {
  archiveCostTemplateSchema,
  bookingAccountingQuerySchema,
  costTemplateParamsSchema,
  costTemplatePreviewSchema,
  costTemplateWriteSchema
} = require("../validators/bookingAccounting.validation");

const router = express.Router();

router.use(authenticate, authorizePermission(PERMISSIONS.BOOKING_ACCOUNTING_READ));

router.get("/dashboard", validateRequest(bookingAccountingQuerySchema), bookingAccountingController.dashboard);
router.get("/invoices", validateRequest(bookingAccountingQuerySchema), bookingAccountingController.invoices);
router.get("/refunds", validateRequest(bookingAccountingQuerySchema), bookingAccountingController.refunds);
router.get("/expenses", validateRequest(bookingAccountingQuerySchema), bookingAccountingController.expenses);
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

module.exports = router;
