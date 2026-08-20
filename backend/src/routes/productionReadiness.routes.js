const express = require("express");
const productionReadinessController = require("../controllers/productionReadiness.controller");
const { authenticate } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/rbac");
const { PERMISSIONS } = require("../security/permissions");
const validateRequest = require("../middleware/validateRequest");
const { productionReadinessSchema } = require("../validators/productionReadiness.validation");

const router = express.Router();

router.use(authenticate, authorizePermission(PERMISSIONS.PRODUCTION_READINESS_READ));

router.get("/summary", validateRequest(productionReadinessSchema), productionReadinessController.summary);

module.exports = router;
