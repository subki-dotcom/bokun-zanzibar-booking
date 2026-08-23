const express = require("express");
const accountingController = require("../controllers/accounting.controller");
const { authenticate } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/rbac");
const validateRequest = require("../middleware/validateRequest");
const { PERMISSIONS } = require("../security/permissions");
const {
  createChartAccountSchema,
  createFixedAssetSchema,
  createJournalSchema,
  createPeriodSchema,
  exportLedgerReportSchema,
  historicalMigrationSchema,
  listChartOfAccountsSchema,
  listJournalsSchema,
  listPeriodsSchema,
  ledgerReportQuerySchema,
  journalActionSchema,
  periodActionSchema,
  seedChartOfAccountsSchema,
  seedMappingsSchema,
  updateChartAccountSchema
} = require("../validators/accounting.validation");

const router = express.Router();

router.use(authenticate);

router.get(
  "/chart-of-accounts",
  authorizePermission(PERMISSIONS.GL_CHART_OF_ACCOUNTS_READ),
  validateRequest(listChartOfAccountsSchema),
  accountingController.listChartOfAccounts
);

router.get(
  "/journals",
  authorizePermission(PERMISSIONS.GL_JOURNAL_READ),
  validateRequest(listJournalsSchema),
  accountingController.listJournals
);

router.post(
  "/journals",
  authorizePermission(PERMISSIONS.GL_JOURNAL_CREATE),
  validateRequest(createJournalSchema),
  accountingController.createJournal
);

router.post(
  "/journals/:id/approve",
  authorizePermission(PERMISSIONS.GL_JOURNAL_APPROVE),
  validateRequest(journalActionSchema),
  accountingController.approveJournal
);

router.post(
  "/journals/:id/post",
  authorizePermission(PERMISSIONS.GL_JOURNAL_POST),
  validateRequest(journalActionSchema),
  accountingController.postJournal
);

router.post(
  "/journals/:id/reverse",
  authorizePermission(PERMISSIONS.GL_JOURNAL_REVERSE),
  validateRequest(journalActionSchema),
  accountingController.reverseJournal
);

router.get(
  "/general-ledger",
  authorizePermission(PERMISSIONS.GL_JOURNAL_READ),
  validateRequest(ledgerReportQuerySchema),
  accountingController.generalLedger
);

router.get(
  "/trial-balance",
  authorizePermission(PERMISSIONS.GL_REPORT_TRIAL_BALANCE_READ),
  validateRequest(ledgerReportQuerySchema),
  accountingController.trialBalance
);

router.get(
  "/profit-loss",
  authorizePermission(PERMISSIONS.GL_REPORT_PROFIT_LOSS_READ),
  validateRequest(ledgerReportQuerySchema),
  accountingController.profitLoss
);

router.get(
  "/balance-sheet",
  authorizePermission(PERMISSIONS.GL_REPORT_BALANCE_SHEET_READ),
  validateRequest(ledgerReportQuerySchema),
  accountingController.balanceSheet
);

router.get(
  "/cash-flow",
  authorizePermission(PERMISSIONS.GL_REPORT_CASH_FLOW_READ),
  validateRequest(ledgerReportQuerySchema),
  accountingController.cashFlow
);

router.get(
  "/periods",
  authorizePermission(PERMISSIONS.GL_JOURNAL_READ),
  validateRequest(listPeriodsSchema),
  accountingController.listPeriods
);

router.post(
  "/periods",
  authorizePermission(PERMISSIONS.GL_PERIOD_CLOSE),
  validateRequest(createPeriodSchema),
  accountingController.createPeriod
);

router.post(
  "/periods/:id/close",
  authorizePermission(PERMISSIONS.GL_PERIOD_CLOSE),
  validateRequest(periodActionSchema),
  accountingController.closePeriod
);

router.post(
  "/periods/:id/reopen",
  authorizePermission(PERMISSIONS.GL_PERIOD_CLOSE),
  validateRequest(periodActionSchema),
  accountingController.reopenPeriod
);

router.get(
  "/reconciliation",
  authorizePermission(PERMISSIONS.GL_JOURNAL_READ),
  validateRequest(ledgerReportQuerySchema),
  accountingController.reconciliation
);

router.get(
  "/health",
  authorizePermission(PERMISSIONS.GL_JOURNAL_READ),
  accountingController.accountingHealth
);

router.post(
  "/mappings/seed-defaults",
  authorizePermission(PERMISSIONS.GL_CHART_OF_ACCOUNTS_WRITE),
  validateRequest(seedMappingsSchema),
  accountingController.seedMappings
);

router.post(
  "/historical-migration",
  authorizePermission(PERMISSIONS.GL_JOURNAL_POST),
  validateRequest(historicalMigrationSchema),
  accountingController.historicalMigration
);

router.get(
  "/fixed-assets",
  authorizePermission(PERMISSIONS.GL_JOURNAL_READ),
  accountingController.listFixedAssets
);

router.post(
  "/fixed-assets",
  authorizePermission(PERMISSIONS.GL_JOURNAL_CREATE),
  validateRequest(createFixedAssetSchema),
  accountingController.createFixedAsset
);

router.get(
  "/exports/:reportType",
  authorizePermission(PERMISSIONS.GL_EXPORT),
  validateRequest(exportLedgerReportSchema),
  accountingController.exportLedgerReport
);

router.post(
  "/chart-of-accounts",
  authorizePermission(PERMISSIONS.GL_CHART_OF_ACCOUNTS_WRITE),
  validateRequest(createChartAccountSchema),
  accountingController.createChartAccount
);

router.patch(
  "/chart-of-accounts/:id",
  authorizePermission(PERMISSIONS.GL_CHART_OF_ACCOUNTS_WRITE),
  validateRequest(updateChartAccountSchema),
  accountingController.updateChartAccount
);

router.post(
  "/chart-of-accounts/seed-defaults",
  authorizePermission(PERMISSIONS.GL_CHART_OF_ACCOUNTS_WRITE),
  validateRequest(seedChartOfAccountsSchema),
  accountingController.seedDefaultChartOfAccounts
);

module.exports = router;
