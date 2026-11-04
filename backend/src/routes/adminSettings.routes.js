const express = require("express");
const adminSettingsController = require("../controllers/adminSettings.controller");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/rbac");
const { settingsTestEmailLimiter } = require("../middleware/rateLimiter");

const router = express.Router();

router.use(authenticate, authorize("super_admin", "admin"));

router.get("/", adminSettingsController.overview);
router.post("/test-email", settingsTestEmailLimiter, adminSettingsController.testEmail);

module.exports = router;
