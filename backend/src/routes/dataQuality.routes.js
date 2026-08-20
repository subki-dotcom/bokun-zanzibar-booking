const express = require("express");
const dataQualityController = require("../controllers/dataQuality.controller");
const { authenticate } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/rbac");
const { PERMISSIONS } = require("../security/permissions");
const validateRequest = require("../middleware/validateRequest");
const {
  dataQualityIssueQuerySchema,
  dataQualitySummaryQuerySchema
} = require("../validators/dataQuality.validation");

const router = express.Router();

router.use(authenticate, authorizePermission(PERMISSIONS.DATA_QUALITY_READ));

router.get("/summary", validateRequest(dataQualitySummaryQuerySchema), dataQualityController.summary);
router.get("/issues", validateRequest(dataQualityIssueQuerySchema), dataQualityController.issues);

module.exports = router;
