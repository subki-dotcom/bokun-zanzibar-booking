const bookingAccountingService = require("../services/bookingAccounting");
const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");

const dashboard = asyncHandler(async (req, res) => {
  const data = await bookingAccountingService.getDashboard(req.validated?.query || {});
  return successResponse(res, {
    message: "Booking accounting dashboard fetched",
    data
  });
});

const invoices = asyncHandler(async (req, res) => {
  const data = await bookingAccountingService.listInvoices(req.validated?.query || {});
  return successResponse(res, {
    message: "Booking accounting invoices fetched",
    data
  });
});

const refunds = asyncHandler(async (req, res) => {
  const data = await bookingAccountingService.listRefunds(req.validated?.query || {});
  return successResponse(res, {
    message: "Booking accounting refunds fetched",
    data
  });
});

const expenses = asyncHandler(async (req, res) => {
  const data = await bookingAccountingService.listExpenses(req.validated?.query || {});
  return successResponse(res, {
    message: "Booking accounting expenses fetched",
    data
  });
});

const costTemplates = asyncHandler(async (_req, res) => {
  const data = await bookingAccountingService.getCostTemplates();
  return successResponse(res, {
    message: "Booking accounting cost controls fetched",
    data
  });
});

const profitability = asyncHandler(async (req, res) => {
  const data = await bookingAccountingService.getProfitability(req.validated?.query || {});
  return successResponse(res, {
    message: "Booking accounting profitability fetched",
    data
  });
});

const reconciliation = asyncHandler(async (req, res) => {
  const data = await bookingAccountingService.getReconciliation(req.validated?.query || {});
  return successResponse(res, {
    message: "Booking accounting reconciliation fetched",
    data
  });
});

module.exports = {
  costTemplates,
  dashboard,
  expenses,
  invoices,
  profitability,
  reconciliation,
  refunds
};
