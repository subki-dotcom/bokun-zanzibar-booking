const opsControlService = require("../services/opsControl");
const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");

const summary = asyncHandler(async (req, res) => {
  const data = await opsControlService.getSummary(req.validated?.query || {});
  return successResponse(res, {
    message: "Operations control summary fetched",
    data
  });
});

const alerts = asyncHandler(async (req, res) => {
  const data = await opsControlService.listSystemAlerts(req.validated?.query || {});
  return successResponse(res, {
    message: "System alerts fetched",
    data
  });
});

const acknowledgeAlert = asyncHandler(async (req, res) => {
  const data = await opsControlService.acknowledgeAlert({
    alertId: req.validated.params.id,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "System alert acknowledged",
    data
  });
});

const resolveAlert = asyncHandler(async (req, res) => {
  const data = await opsControlService.resolveAlert({
    alertId: req.validated.params.id,
    auth: req.auth,
    requestId: req.requestId,
    resolutionNote: req.validated.body.resolutionNote
  });
  return successResponse(res, {
    message: "System alert resolved",
    data
  });
});

const dismissAlert = asyncHandler(async (req, res) => {
  const data = await opsControlService.dismissAlert({
    alertId: req.validated.params.id,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "System alert dismissed",
    data
  });
});

const failedJobs = asyncHandler(async (req, res) => {
  const data = await opsControlService.listFailedJobs(req.validated?.query || {});
  return successResponse(res, {
    message: "Failed jobs fetched",
    data
  });
});

const retryFailedJob = asyncHandler(async (req, res) => {
  const data = await opsControlService.retryFailedJob({
    jobId: req.validated.params.id,
    auth: req.auth,
    requestId: req.requestId,
    force: Boolean(req.validated.body?.force)
  });
  return successResponse(res, {
    message: "Failed job retry triggered",
    data
  });
});

module.exports = {
  acknowledgeAlert,
  alerts,
  dismissAlert,
  failedJobs,
  resolveAlert,
  retryFailedJob,
  summary
};
