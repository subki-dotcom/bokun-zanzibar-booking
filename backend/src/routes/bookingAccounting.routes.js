const express = require("express");
const bookingAccountingController = require("../controllers/bookingAccounting.controller");
const { authenticate } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/rbac");
const validateRequest = require("../middleware/validateRequest");
const { PERMISSIONS } = require("../security/permissions");
const { bookingAccountingQuerySchema } = require("../validators/bookingAccounting.validation");

const router = express.Router();

router.use(authenticate, authorizePermission(PERMISSIONS.BOOKING_ACCOUNTING_READ));

router.get("/dashboard", validateRequest(bookingAccountingQuerySchema), bookingAccountingController.dashboard);
router.get("/invoices", validateRequest(bookingAccountingQuerySchema), bookingAccountingController.invoices);
router.get("/refunds", validateRequest(bookingAccountingQuerySchema), bookingAccountingController.refunds);
router.get("/expenses", validateRequest(bookingAccountingQuerySchema), bookingAccountingController.expenses);
router.get("/cost-templates", bookingAccountingController.costTemplates);
router.get("/profitability", validateRequest(bookingAccountingQuerySchema), bookingAccountingController.profitability);
router.get("/reconciliation", validateRequest(bookingAccountingQuerySchema), bookingAccountingController.reconciliation);

module.exports = router;
