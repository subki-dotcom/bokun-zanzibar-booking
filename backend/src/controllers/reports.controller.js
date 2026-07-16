const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");
const reportsService = require("../services/reports");

const dashboardSummary = asyncHandler(async (_req, res) => {
  const data = await reportsService.getDashboardSummary();

  return successResponse(res, {
    message: "Dashboard summary fetched",
    data
  });
});

const dailyBookings = asyncHandler(async (_req, res) => {
  const data = await reportsService.dailyBookings();

  return successResponse(res, {
    message: "Daily bookings report",
    data
  });
});

const monthlySales = asyncHandler(async (_req, res) => {
  const data = await reportsService.monthlySales();

  return successResponse(res, {
    message: "Monthly sales report",
    data
  });
});

const performance = asyncHandler(async (_req, res) => {
  const data = await reportsService.performanceReports();

  return successResponse(res, {
    message: "Performance reports",
    data
  });
});

const conversionFunnel = asyncHandler(async (_req, res) => {
  const data = await reportsService.conversionFunnel();
  return successResponse(res, { message: "Conversion funnel report", data });
});

const operationalAlerts = asyncHandler(async (_req, res) => {
  const data = await reportsService.getOperationalAlerts();
  return successResponse(res, { message: "Operational alerts fetched", data });
});

const growthPerformance = asyncHandler(async (_req, res) => {
  const data = await reportsService.getGrowthPerformance();
  return successResponse(res, { message: "Growth performance fetched", data });
});

const operationsOverview = asyncHandler(async (_req, res) => {
  const data = await reportsService.getOperationsOverview();
  return successResponse(res, { message: "Operations overview fetched", data });
});

module.exports = {
  dashboardSummary,
  dailyBookings,
  monthlySales,
  performance,
  conversionFunnel,
  operationalAlerts,
  growthPerformance,
  operationsOverview
};
