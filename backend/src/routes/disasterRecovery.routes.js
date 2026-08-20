const express = require("express");
const disasterRecoveryController = require("../controllers/disasterRecovery.controller");
const { authenticate } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/rbac");
const { PERMISSIONS } = require("../security/permissions");
const validateRequest = require("../middleware/validateRequest");
const {
  backupPlanSchema,
  disasterRecoveryHistorySchema,
  disasterRecoverySummarySchema,
  restorePlanSchema
} = require("../validators/disasterRecovery.validation");

const router = express.Router();

router.use(authenticate);

router.get(
  "/summary",
  authorizePermission(PERMISSIONS.DISASTER_RECOVERY_READ),
  validateRequest(disasterRecoverySummarySchema),
  disasterRecoveryController.summary
);
router.get(
  "/history",
  authorizePermission(PERMISSIONS.DISASTER_RECOVERY_READ),
  validateRequest(disasterRecoveryHistorySchema),
  disasterRecoveryController.history
);
router.post(
  "/backup-plan",
  authorizePermission(PERMISSIONS.DISASTER_RECOVERY_WRITE),
  validateRequest(backupPlanSchema),
  disasterRecoveryController.backupPlan
);
router.post(
  "/restore-plan",
  authorizePermission(PERMISSIONS.DISASTER_RECOVERY_WRITE),
  validateRequest(restorePlanSchema),
  disasterRecoveryController.restorePlan
);

module.exports = router;
