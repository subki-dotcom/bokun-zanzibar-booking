const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");
const settlements = require("../services/settlements");

const list = asyncHandler(async (req, res) => successResponse(res, { message: "Settlements fetched", data: await settlements.list(req.validated?.query || req.query || {}) }));
const detail = asyncHandler(async (req, res) => successResponse(res, { message: "Settlement detail fetched", data: await settlements.detail(req.params.settlementId) }));
const create = asyncHandler(async (req, res) => successResponse(res, { message: "Settlement evidence recorded", data: await settlements.create({ input: req.validated.body, auth: req.auth, requestId: req.requestId }) }));
const allocate = asyncHandler(async (req, res) => successResponse(res, { message: "Settlement allocated", data: await settlements.allocate({ settlementId: req.params.settlementId, ...req.validated.body, auth: req.auth, requestId: req.requestId }) }));
const reconcile = asyncHandler(async (req, res) => successResponse(res, { message: "Settlement evaluated", data: await settlements.reconcile({ settlementId: req.params.settlementId, auth: req.auth, requestId: req.requestId }) }));
const reverseAllocation = asyncHandler(async (req, res) => successResponse(res, { message: "Settlement allocation reversed", data: await settlements.reverseAllocation({ allocationId: req.params.allocationId, reason: req.validated.body.reason, auth: req.auth, requestId: req.requestId }) }));
const importPreview = asyncHandler(async (req, res) => successResponse(res, { message: "Settlement import preview created", data: await settlements.previewImport({ csv: req.validated.body.csv }) }));
const importCommit = asyncHandler(async (req, res) => successResponse(res, { message: "Settlement import committed", data: await settlements.commitImport({ token: req.validated.body.token, auth: req.auth, requestId: req.requestId }) }));
module.exports = { list, detail, create, allocate, reconcile, reverseAllocation, importPreview, importCommit };