const express = require("express");
const reportsController = require("../controllers/reports.controller");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/rbac");

const router = express.Router();

router.get(
  "/dashboard-summary",
  authenticate,
  authorize("super_admin", "admin", "staff"),
  reportsController.dashboardSummary
);
router.get("/daily-bookings", authenticate, authorize("super_admin", "admin", "staff"), reportsController.dailyBookings);
router.get("/monthly-sales", authenticate, authorize("super_admin", "admin", "staff"), reportsController.monthlySales);
router.get("/performance", authenticate, authorize("super_admin", "admin", "staff"), reportsController.performance);
router.get("/conversion-funnel", authenticate, authorize("super_admin", "admin", "staff"), reportsController.conversionFunnel);
router.get("/operational-alerts", authenticate, authorize("super_admin", "admin", "staff"), reportsController.operationalAlerts);
router.get("/growth-performance", authenticate, authorize("super_admin", "admin", "staff"), reportsController.growthPerformance);

module.exports = router;
