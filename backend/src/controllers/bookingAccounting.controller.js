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

const costTemplates = asyncHandler(async (req, res) => {
  const data = await bookingAccountingService.getCostTemplates(req.validated?.query || {});
  return successResponse(res, {
    message: "Booking accounting cost controls fetched",
    data
  });
});

const costTemplate = asyncHandler(async (req, res) => {
  const data = await bookingAccountingService.getCostTemplateById(req.validated.params.templateId);
  return successResponse(res, {
    message: "Booking accounting cost template fetched",
    data
  });
});

const syncCostTemplateBokunProducts = asyncHandler(async (req, res) => {
  const data = await bookingAccountingService.startCostTemplateBokunProductSync({
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "Bokun product sync started for cost templates",
    data,
    statusCode: 202
  });
});

const createCostTemplate = asyncHandler(async (req, res) => {
  const data = await bookingAccountingService.createCostTemplate({
    payload: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "Booking accounting cost template created",
    data,
    statusCode: 201
  });
});

const updateCostTemplate = asyncHandler(async (req, res) => {
  const data = await bookingAccountingService.updateCostTemplate({
    templateId: req.validated.params.templateId,
    payload: req.validated.body,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "Booking accounting cost template updated",
    data
  });
});

const archiveCostTemplate = asyncHandler(async (req, res) => {
  const data = await bookingAccountingService.archiveCostTemplate({
    templateId: req.validated.params.templateId,
    auth: req.auth,
    requestId: req.requestId,
    reason: req.validated.body?.reason || ""
  });
  return successResponse(res, {
    message: "Booking accounting cost template archived",
    data
  });
});

const previewCostTemplate = asyncHandler(async (req, res) => {
  const data = await bookingAccountingService.previewCostTemplate({
    payload: req.validated.body
  });
  return successResponse(res, {
    message: "Booking accounting cost template preview calculated",
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
  archiveCostTemplate,
  createCostTemplate,
  costTemplate,
  costTemplates,
  dashboard,
  expenses,
  invoices,
  previewCostTemplate,
  profitability,
  reconciliation,
  refunds,
  syncCostTemplateBokunProducts,
  updateCostTemplate
};
