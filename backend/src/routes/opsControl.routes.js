const express = require("express");
const opsControlController = require("../controllers/opsControl.controller");
const { authenticate } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/rbac");
const { PERMISSIONS } = require("../security/permissions");
const validateRequest = require("../middleware/validateRequest");
const {
  alertActionSchema,
  alertResolveSchema,
  failedJobRetrySchema,
  failedJobsQuerySchema,
  opsControlSummaryQuerySchema,
  systemAlertsQuerySchema
} = require("../validators/opsControl.validation");

const router = express.Router();

router.use(authenticate);

router.get(
  "/summary",
  authorizePermission(PERMISSIONS.OPS_CONTROL_READ),
  validateRequest(opsControlSummaryQuerySchema),
  opsControlController.summary
);
router.get(
  "/alerts",
  authorizePermission(PERMISSIONS.OPS_CONTROL_READ),
  validateRequest(systemAlertsQuerySchema),
  opsControlController.alerts
);
router.post(
  "/alerts/:id/acknowledge",
  authorizePermission(PERMISSIONS.OPS_CONTROL_WRITE),
  validateRequest(alertActionSchema),
  opsControlController.acknowledgeAlert
);
router.post(
  "/alerts/:id/resolve",
  authorizePermission(PERMISSIONS.OPS_CONTROL_WRITE),
  validateRequest(alertResolveSchema),
  opsControlController.resolveAlert
);
router.post(
  "/alerts/:id/dismiss",
  authorizePermission(PERMISSIONS.OPS_CONTROL_WRITE),
  validateRequest(alertActionSchema),
  opsControlController.dismissAlert
);
router.get(
  "/failed-jobs",
  authorizePermission(PERMISSIONS.OPS_CONTROL_READ),
  validateRequest(failedJobsQuerySchema),
  opsControlController.failedJobs
);
router.post(
  "/failed-jobs/:id/retry",
  authorizePermission(PERMISSIONS.OPS_CONTROL_WRITE),
  validateRequest(failedJobRetrySchema),
  opsControlController.retryFailedJob
);

module.exports = router;
