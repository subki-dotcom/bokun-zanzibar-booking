const express = require("express");
const performanceReviewController = require("../controllers/performanceReview.controller");
const { authenticate } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/rbac");
const { PERMISSIONS } = require("../security/permissions");
const validateRequest = require("../middleware/validateRequest");
const {
  performanceIndexCoverageSchema,
  performanceReviewSchema
} = require("../validators/performanceReview.validation");

const router = express.Router();

router.use(authenticate);
router.use(authorizePermission(PERMISSIONS.PERFORMANCE_REVIEW_READ));

router.get("/summary", validateRequest(performanceReviewSchema), performanceReviewController.summary);
router.get("/indexes", validateRequest(performanceIndexCoverageSchema), performanceReviewController.indexCoverage);
router.get("/inventory", validateRequest(performanceReviewSchema), performanceReviewController.indexInventory);

module.exports = router;
