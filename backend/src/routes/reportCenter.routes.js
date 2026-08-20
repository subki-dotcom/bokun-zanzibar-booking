const express = require("express");
const reportCenterController = require("../controllers/reportCenter.controller");
const { authenticate } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/rbac");
const { PERMISSIONS } = require("../security/permissions");
const validateRequest = require("../middleware/validateRequest");
const {
  exportHistoryQuerySchema,
  exportReportQuerySchema,
  reportCatalogQuerySchema,
  runReportQuerySchema
} = require("../validators/reportCenter.validation");

const router = express.Router();

router.use(authenticate);

router.get(
  "/catalog",
  authorizePermission(PERMISSIONS.REPORT_CENTER_READ),
  validateRequest(reportCatalogQuerySchema),
  reportCenterController.catalog
);
router.get(
  "/exports/history",
  authorizePermission(PERMISSIONS.REPORT_CENTER_READ),
  validateRequest(exportHistoryQuerySchema),
  reportCenterController.exportHistory
);
router.get(
  "/reports/:reportType/export",
  authorizePermission(PERMISSIONS.REPORT_CENTER_EXPORT),
  validateRequest(exportReportQuerySchema),
  reportCenterController.exportReport
);
router.get(
  "/reports/:reportType",
  authorizePermission(PERMISSIONS.REPORT_CENTER_READ),
  validateRequest(runReportQuerySchema),
  reportCenterController.run
);

module.exports = router;
