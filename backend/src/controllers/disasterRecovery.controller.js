const disasterRecoveryService = require("../services/disasterRecovery");
const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");

const summary = asyncHandler(async (_req, res) => {
  const data = await disasterRecoveryService.getSummary();
  return successResponse(res, {
    message: "Disaster recovery summary fetched",
    data
  });
});

const history = asyncHandler(async (req, res) => {
  const data = await disasterRecoveryService.listHistory(req.validated?.query || {});
  return successResponse(res, {
    message: "Backup and restore history fetched",
    data
  });
});

const backupPlan = asyncHandler(async (req, res) => {
  const data = await disasterRecoveryService.createBackupPlan({
    ...req.validated.body,
    dryRun: true,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "Backup dry-run plan created",
    data,
    statusCode: 201
  });
});

const restorePlan = asyncHandler(async (req, res) => {
  const data = await disasterRecoveryService.createRestorePlan({
    ...req.validated.body,
    dryRun: true,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "Restore dry-run plan created",
    data,
    statusCode: 201
  });
});

module.exports = {
  backupPlan,
  history,
  restorePlan,
  summary
};
