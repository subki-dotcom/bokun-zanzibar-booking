const chartOfAccountsService = require("../services/generalLedger/chartOfAccounts");
const ledgerService = require("../services/generalLedger/ledger");
const asyncHandler = require("../utils/asyncHandler");
const { successResponse } = require("../utils/apiResponse");

const listChartOfAccounts = asyncHandler(async (req, res) => {
  const data = await chartOfAccountsService.listAccounts(req.validated?.query || req.query || {});
  return successResponse(res, {
    message: "Chart of accounts fetched",
    data
  });
});

const createChartAccount = asyncHandler(async (req, res) => {
  const data = await chartOfAccountsService.createAccount({
    input: req.validated?.body || req.body || {},
    auth: req.auth,
    requestId: req.requestId
  });

  return successResponse(res, {
    message: "Chart account created",
    data,
    statusCode: 201
  });
});

const updateChartAccount = asyncHandler(async (req, res) => {
  const data = await chartOfAccountsService.updateAccount({
    accountId: req.validated.params.id,
    input: req.validated?.body || req.body || {},
    auth: req.auth,
    requestId: req.requestId
  });

  return successResponse(res, {
    message: "Chart account updated",
    data
  });
});

const seedDefaultChartOfAccounts = asyncHandler(async (req, res) => {
  const body = req.validated?.body || {};
  const data = await chartOfAccountsService.seedDefaultChart({
    dryRun: body.dryRun !== false,
    reason: body.reason,
    auth: req.auth,
    requestId: req.requestId
  });

  return successResponse(res, {
    message: data.dryRun ? "Chart of accounts seed dry-run completed" : "Chart of accounts seed completed",
    data,
    statusCode: data.action === "created" ? 201 : 200
  });
});

const listJournals = asyncHandler(async (req, res) => {
  const data = await ledgerService.listJournals(req.validated?.query || req.query || {});
  return successResponse(res, {
    message: "Journal entries fetched",
    data
  });
});

const createJournal = asyncHandler(async (req, res) => {
  const data = await ledgerService.createManualJournal({
    input: req.validated?.body || req.body || {},
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: data.idempotent ? "Journal already exists" : "Journal entry created",
    data,
    statusCode: data.action === "created" ? 201 : 200
  });
});

const approveJournal = asyncHandler(async (req, res) => {
  const data = await ledgerService.approveJournal({
    journalId: req.validated.params.id,
    override: Boolean(req.validated.body?.override),
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "Journal entry approved",
    data
  });
});

const postJournal = asyncHandler(async (req, res) => {
  const data = await ledgerService.postJournal({
    journalId: req.validated.params.id,
    override: Boolean(req.validated.body?.override),
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: data.idempotent ? "Journal entry already posted" : "Journal entry posted",
    data
  });
});

const reverseJournal = asyncHandler(async (req, res) => {
  const data = await ledgerService.reverseJournal({
    journalId: req.validated.params.id,
    reason: req.validated.body?.reason,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: data.idempotent ? "Journal reversal already exists" : "Journal entry reversed",
    data,
    statusCode: data.action === "reversed" ? 201 : 200
  });
});

const listPeriods = asyncHandler(async (req, res) => {
  const data = await ledgerService.listPeriods(req.validated?.query || req.query || {});
  return successResponse(res, {
    message: "Accounting periods fetched",
    data
  });
});

const createPeriod = asyncHandler(async (req, res) => {
  const data = await ledgerService.createOrGetPeriod({
    year: req.validated.body.year,
    month: req.validated.body.month,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: data.action === "created" ? "Accounting period created" : "Accounting period already exists",
    data,
    statusCode: data.action === "created" ? 201 : 200
  });
});

const closePeriod = asyncHandler(async (req, res) => {
  const data = await ledgerService.closePeriod({
    periodId: req.validated.params.id,
    reason: req.validated.body.reason,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "Accounting period closed",
    data
  });
});

const reopenPeriod = asyncHandler(async (req, res) => {
  const data = await ledgerService.reopenPeriod({
    periodId: req.validated.params.id,
    reason: req.validated.body.reason,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "Accounting period reopened",
    data
  });
});

const generalLedger = asyncHandler(async (req, res) => {
  const data = await ledgerService.getGeneralLedger(req.validated?.query || req.query || {});
  return successResponse(res, {
    message: "General ledger fetched",
    data
  });
});

const trialBalance = asyncHandler(async (req, res) => {
  const data = await ledgerService.getTrialBalance(req.validated?.query || req.query || {});
  return successResponse(res, {
    message: "Trial balance fetched",
    data
  });
});

const profitLoss = asyncHandler(async (req, res) => {
  const data = await ledgerService.getProfitLoss(req.validated?.query || req.query || {});
  return successResponse(res, {
    message: "Ledger profit and loss fetched",
    data
  });
});

const balanceSheet = asyncHandler(async (req, res) => {
  const data = await ledgerService.getBalanceSheet(req.validated?.query || req.query || {});
  return successResponse(res, {
    message: "Balance sheet fetched",
    data
  });
});

const cashFlow = asyncHandler(async (req, res) => {
  const data = await ledgerService.getCashFlow(req.validated?.query || req.query || {});
  return successResponse(res, {
    message: "Cash flow foundation fetched",
    data
  });
});

const reconciliation = asyncHandler(async (req, res) => {
  const data = await ledgerService.getReconciliation(req.validated?.query || req.query || {});
  return successResponse(res, {
    message: "Accounting reconciliation fetched",
    data
  });
});

const accountingHealth = asyncHandler(async (_req, res) => {
  const data = await ledgerService.getAccountingHealth();
  return successResponse(res, {
    message: "Accounting health fetched",
    data
  });
});

const seedMappings = asyncHandler(async (req, res) => {
  const data = await ledgerService.seedDefaultMappings({
    dryRun: req.validated.body?.dryRun !== false,
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: data.dryRun ? "Accounting mapping seed dry-run completed" : "Accounting mappings seeded",
    data,
    statusCode: data.dryRun ? 200 : 201
  });
});

const historicalMigration = asyncHandler(async (req, res) => {
  const data = await ledgerService.runHistoricalMigration({
    ...(req.validated?.body || {}),
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: data.dryRun ? "Historical ledger migration dry-run completed" : "Historical ledger migration planned",
    data,
    statusCode: data.dryRun ? 200 : 201
  });
});

const listFixedAssets = asyncHandler(async (_req, res) => {
  const data = await ledgerService.getFixedAssets();
  return successResponse(res, {
    message: "Fixed assets fetched",
    data
  });
});

const createFixedAsset = asyncHandler(async (req, res) => {
  const data = await ledgerService.createFixedAsset({
    input: req.validated?.body || req.body || {},
    auth: req.auth,
    requestId: req.requestId
  });
  return successResponse(res, {
    message: "Fixed asset created",
    data,
    statusCode: 201
  });
});

const exportLedgerReport = asyncHandler(async (req, res) => {
  const data = await ledgerService.exportLedgerReport({
    reportType: req.validated.params.reportType,
    format: req.validated.query?.format,
    filters: req.validated.query || {}
  });
  res.setHeader("content-type", data.contentType);
  res.setHeader("content-disposition", `attachment; filename="${data.filename}"`);
  return res.status(200).send(data.content);
});

module.exports = {
  accountingHealth,
  approveJournal,
  balanceSheet,
  cashFlow,
  closePeriod,
  createChartAccount,
  createFixedAsset,
  createJournal,
  createPeriod,
  exportLedgerReport,
  generalLedger,
  historicalMigration,
  listFixedAssets,
  listJournals,
  listChartOfAccounts,
  listPeriods,
  postJournal,
  profitLoss,
  reconciliation,
  reopenPeriod,
  reverseJournal,
  seedDefaultChartOfAccounts,
  seedMappings,
  trialBalance,
  updateChartAccount
};
