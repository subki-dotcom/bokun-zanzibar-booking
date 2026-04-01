const asyncHandler = require("../../utils/asyncHandler");
const { successResponse } = require("../../utils/apiResponse");
const reportsService = require("./reports.service");

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

module.exports = {
  dashboardSummary,
  dailyBookings,
  monthlySales,
  performance
};