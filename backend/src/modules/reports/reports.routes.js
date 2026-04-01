const express = require("express");
const reportsController = require("./reports.controller");
const { authenticate } = require("../../middleware/auth");
const { authorize } = require("../../middleware/rbac");

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

module.exports = router;