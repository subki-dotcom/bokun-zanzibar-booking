const express = require("express");
const analyticsController = require("../controllers/analytics.controller");
const { authenticate } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/rbac");
const { PERMISSIONS } = require("../security/permissions");
const validateRequest = require("../middleware/validateRequest");
const {
  channelAnalyticsQuerySchema,
  executiveAnalyticsQuerySchema,
  productAnalyticsQuerySchema,
  salesAnalyticsQuerySchema,
  trendAnalyticsQuerySchema
} = require("../validators/analytics.validation");

const router = express.Router();

router.use(authenticate, authorizePermission(PERMISSIONS.BUSINESS_INTELLIGENCE_READ));

router.get("/executive", validateRequest(executiveAnalyticsQuerySchema), analyticsController.executive);
router.get("/sales", validateRequest(salesAnalyticsQuerySchema), analyticsController.sales);
router.get("/products", validateRequest(productAnalyticsQuerySchema), analyticsController.products);
router.get("/products/:productId", validateRequest(productAnalyticsQuerySchema), analyticsController.products);
router.get("/channels", validateRequest(channelAnalyticsQuerySchema), analyticsController.channels);
router.get("/channels/:channel", validateRequest(channelAnalyticsQuerySchema), analyticsController.channels);
router.get("/trends", validateRequest(trendAnalyticsQuerySchema), analyticsController.trends);

module.exports = router;
