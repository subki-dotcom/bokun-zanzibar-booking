const express = require("express");
const systemHealthController = require("../controllers/systemHealth.controller");
const { authenticate } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/rbac");
const { PERMISSIONS } = require("../security/permissions");
const validateRequest = require("../middleware/validateRequest");
const { systemHealthSchema } = require("../validators/systemHealth.validation");

const router = express.Router();

router.use(authenticate);

router.get(
  "/summary",
  authorizePermission(PERMISSIONS.SYSTEM_HEALTH_READ),
  validateRequest(systemHealthSchema),
  systemHealthController.summary
);

router.get(
  "/checks",
  authorizePermission(PERMISSIONS.SYSTEM_HEALTH_READ),
  validateRequest(systemHealthSchema),
  systemHealthController.checks
);

module.exports = router;
