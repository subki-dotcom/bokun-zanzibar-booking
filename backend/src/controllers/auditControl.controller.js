const auditControlService = require("../services/auditControl");
const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");

const summary = asyncHandler(async (req, res) => {
  const data = await auditControlService.getSummary(req.validated?.query || {});
  return successResponse(res, {
    message: "Audit control summary fetched",
    data
  });
});

const auditLogs = asyncHandler(async (req, res) => {
  const data = await auditControlService.listAuditLogs(req.validated?.query || {});
  return successResponse(res, {
    message: "Audit logs fetched",
    data
  });
});

const financialChanges = asyncHandler(async (req, res) => {
  const data = await auditControlService.listFinancialChanges(req.validated?.query || {});
  return successResponse(res, {
    message: "Financial changes fetched",
    data
  });
});

module.exports = {
  auditLogs,
  financialChanges,
  summary
};
