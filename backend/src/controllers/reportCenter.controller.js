const reportCenterService = require("../reportCenter/reportQueryService");
const reportExportService = require("../reportCenter/exportService");
const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");

const catalog = asyncHandler(async (_req, res) => {
  const data = reportCenterService.listCatalog();
  return successResponse(res, {
    message: "Report Center catalog fetched",
    data
  });
});

const run = asyncHandler(async (req, res) => {
  const data = await reportCenterService.runReport({
    reportType: req.validated.params.reportType,
    filters: req.validated.query || {},
    auth: req.auth,
    requestId: req.requestId
  });

  return successResponse(res, {
    message: "Report generated",
    data
  });
});

const exportReport = asyncHandler(async (req, res) => {
  const { format, ...filters } = req.validated.query || {};
  const data = await reportExportService.exportReport({
    reportType: req.validated.params.reportType,
    format,
    filters,
    auth: req.auth,
    requestId: req.requestId
  });

  res.setHeader("Content-Type", data.contentType);
  res.setHeader("Content-Length", data.contentLength);
  res.setHeader("Content-Disposition", `${data.disposition}; filename="${data.filename}"`);
  res.setHeader("x-report-export-format", data.format);
  if (data.history?.id) res.setHeader("x-report-export-id", data.history.id);

  return res.status(200).send(data.content);
});

const exportHistory = asyncHandler(async (req, res) => {
  const data = await reportExportService.listExportHistory(req.validated.query || {});

  return successResponse(res, {
    message: "Report export history fetched",
    data
  });
});

module.exports = {
  catalog,
  exportHistory,
  exportReport,
  run
};
