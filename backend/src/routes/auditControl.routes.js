const express = require("express");
const auditControlController = require("../controllers/auditControl.controller");
const { authenticate } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/rbac");
const { PERMISSIONS } = require("../security/permissions");
const validateRequest = require("../middleware/validateRequest");
const {
  auditControlQuerySchema,
  financialChangesQuerySchema,
  summaryQuerySchema
} = require("../validators/auditControl.validation");

const router = express.Router();

router.use(authenticate, authorizePermission(PERMISSIONS.AUDIT_CONTROL_READ));

router.get("/summary", validateRequest(summaryQuerySchema), auditControlController.summary);
router.get("/audit-logs", validateRequest(auditControlQuerySchema), auditControlController.auditLogs);
router.get(
  "/financial-changes",
  validateRequest(financialChangesQuerySchema),
  auditControlController.financialChanges
);

module.exports = router;
