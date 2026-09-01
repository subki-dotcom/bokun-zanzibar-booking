import axiosClient from "./axiosClient";

const buildQueryString = (params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : "";
};

export const fetchDashboardSummary = async () => {
  const response = await axiosClient.get("/reports/dashboard-summary");
  return response.data.data;
};

export const fetchDailyBookingsReport = async () => {
  const response = await axiosClient.get("/reports/daily-bookings");
  return response.data.data;
};

export const fetchMonthlySalesReport = async () => {
  const response = await axiosClient.get("/reports/monthly-sales");
  return response.data.data;
};

export const fetchPerformanceReport = async () => {
  const response = await axiosClient.get("/reports/performance");
  return response.data.data;
};

export const fetchConversionFunnel = async () => {
  const response = await axiosClient.get("/reports/conversion-funnel");
  return response.data.data;
};

export const fetchOperationalAlerts = async () => {
  const response = await axiosClient.get("/reports/operational-alerts");
  return response.data.data;
};

export const fetchGrowthPerformance = async () => {
  const response = await axiosClient.get("/reports/growth-performance");
  return response.data.data;
};

export const fetchOperationsOverview = async () => {
  const response = await axiosClient.get("/reports/operations-overview");
  return response.data.data;
};

export const fetchCommissionSummary = async () => {
  const response = await axiosClient.get("/commissions/summary");
  return response.data.data;
};

export const fetchOffers = async () => {
  const response = await axiosClient.get("/offers");
  return response.data.data;
};

export const fetchPendingFinalizations = async ({
  limit = 20,
  includeProcessing = true,
  force = false
} = {}) => {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("includeProcessing", includeProcessing ? "true" : "false");
  params.set("force", force ? "true" : "false");

  const response = await axiosClient.get(`/bookings/finalization/pending?${params.toString()}`);
  return response.data.data;
};

export const retryBookingFinalization = async (bookingId, { force = false } = {}) => {
  const response = await axiosClient.post(`/bookings/${bookingId}/finalization/retry`, { force });
  return response.data.data;
};

export const reconcileBookingFinalizations = async ({ limit = 20, force = false } = {}) => {
  const response = await axiosClient.post("/bookings/finalization/reconcile", { limit, force });
  return response.data.data;
};

export const fetchPaymentReconciliation = async ({ limit = 100 } = {}) => {
  const response = await axiosClient.get(`/payments/reconciliation?limit=${encodeURIComponent(limit)}`);
  return response.data.data;
};

export const recheckPesapalStatus = async (bookingReference) => {
  const response = await axiosClient.post(`/payments/reconciliation/${bookingReference}/recheck-pesapal`, {});
  return response.data.data;
};

export const syncPaymentInvoice = async (bookingReference) => {
  const response = await axiosClient.post(`/payments/reconciliation/${bookingReference}/sync-invoice`, {});
  return response.data.data;
};

export const retryBokunFromPaymentReconciliation = async (bookingReference, bookingId, { force = false } = {}) => {
  const response = await axiosClient.post(`/payments/reconciliation/${bookingReference}/retry-bokun`, {
    bookingId,
    force
  });
  return response.data.data;
};

export const syncBokunProductCatalog = async ({ timeout = 15000 } = {}) => {
  const response = await axiosClient.post(
    "/admin/booking-accounting/cost-templates/sync-bokun-products",
    {},
    { timeout }
  );
  return response.data.data;
};

export const fetchBokunSyncStatus = async () => {
  const response = await axiosClient.get("/bokun/admin/sync-status");
  return response.data.data;
};

export const importConfirmedBokunBookings = async (payload = {}) => {
  const response = await axiosClient.post("/bokun/admin/bookings/import-confirmed", payload);
  return response.data.data;
};

export const resyncBokunBooking = async (reference, payload = {}) => {
  const response = await axiosClient.post(`/bokun/admin/bookings/${encodeURIComponent(reference)}/resync`, payload);
  return response.data.data;
};

export const markPaymentReviewed = async (bookingReference, reviewNote = "") => {
  const response = await axiosClient.post(`/payments/reconciliation/${bookingReference}/mark-reviewed`, {
    reviewNote
  });
  return response.data.data;
};

export const fetchAdminAgents = async () => {
  const response = await axiosClient.get("/agents");
  return response.data.data;
};

export const updateAdminAgentStatus = async (agentId, payload) => {
  const response = await axiosClient.post(`/agents/${agentId}/update-status`, payload);
  return response.data.data;
};

export const updateAdminAgentCommission = async (agentId, commissionPercent) => {
  const response = await axiosClient.post(`/agents/${agentId}/update-commission`, {
    commissionPercent: Number(commissionPercent)
  });
  return response.data.data;
};

export const fetchExecutiveAnalytics = async (params = {}) => {
  const response = await axiosClient.get(`/admin/analytics/executive${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchSalesAnalytics = async (params = {}) => {
  const response = await axiosClient.get(`/admin/analytics/sales${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchProductAnalytics = async (params = {}) => {
  const response = await axiosClient.get(`/admin/analytics/products${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchChannelAnalytics = async (params = {}) => {
  const response = await axiosClient.get(`/admin/analytics/channels${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchTrendAnalytics = async (params = {}) => {
  const response = await axiosClient.get(`/admin/analytics/trends${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchDisasterRecoverySummary = async () => {
  const response = await axiosClient.get("/admin/disaster-recovery/summary");
  return response.data.data;
};

export const fetchDisasterRecoveryHistory = async (params = {}) => {
  const response = await axiosClient.get(`/admin/disaster-recovery/history${buildQueryString(params)}`);
  return response.data.data;
};

export const createDisasterRecoveryBackupPlan = async (payload = {}) => {
  const response = await axiosClient.post("/admin/disaster-recovery/backup-plan", payload);
  return response.data.data;
};

export const createDisasterRecoveryRestorePlan = async (payload = {}) => {
  const response = await axiosClient.post("/admin/disaster-recovery/restore-plan", payload);
  return response.data.data;
};

export const fetchSystemHealthSummary = async () => {
  const response = await axiosClient.get("/admin/system-health/summary");
  return response.data.data;
};

export const fetchPerformanceReviewSummary = async () => {
  const response = await axiosClient.get("/admin/performance-review/summary");
  return response.data.data;
};

export const fetchPerformanceIndexCoverage = async (params = {}) => {
  const response = await axiosClient.get(`/admin/performance-review/indexes${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchPerformanceIndexInventory = async () => {
  const response = await axiosClient.get("/admin/performance-review/inventory");
  return response.data.data;
};

export const fetchProductionReadinessSummary = async () => {
  const response = await axiosClient.get("/admin/production-readiness/summary");
  return response.data.data;
};

export const fetchCrmDashboard = async () => {
  const response = await axiosClient.get("/admin/crm/dashboard");
  return response.data.data;
};

export const fetchCrmAlerts = async (params = {}) => {
  const response = await axiosClient.get(`/admin/crm/alerts${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchCrmControls = async (params = {}) => {
  const response = await axiosClient.get(`/admin/crm/controls${buildQueryString(params)}`);
  return response.data.data;
};

export const runCrmImport = async (payload = {}) => {
  const response = await axiosClient.post("/admin/crm/imports", payload);
  return response.data.data;
};

export const fetchCrmAnalytics = async (params = {}) => {
  const response = await axiosClient.get(`/admin/crm/analytics${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchCrmReportCatalog = async () => {
  const response = await axiosClient.get("/admin/crm/reports/catalog");
  return response.data.data;
};

export const runCrmReport = async (reportType, params = {}) => {
  const response = await axiosClient.get(`/admin/crm/reports/${encodeURIComponent(reportType)}${buildQueryString(params)}`);
  return response.data.data;
};

export const exportCrmReport = async (reportType, params = {}) => {
  const response = await axiosClient.get(
    `/admin/crm/reports/${encodeURIComponent(reportType)}/export${buildQueryString(params)}`,
    { responseType: "blob" }
  );
  const disposition = response.headers?.["content-disposition"] || "";
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return {
    blob: response.data,
    filename: match?.[1] || `${reportType}.${String(params.format || "csv").toLowerCase()}`,
    contentType: response.headers?.["content-type"] || "text/csv"
  };
};

export const fetchCrmCustomers = async (params = {}) => {
  const response = await axiosClient.get(`/admin/crm/customers${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchCrmCustomerProfile = async (customerId) => {
  const response = await axiosClient.get(`/admin/crm/customers/${encodeURIComponent(customerId)}`);
  return response.data.data;
};

export const fetchCrmCustomerTimeline = async (customerId, params = {}) => {
  const response = await axiosClient.get(`/admin/crm/customers/${encodeURIComponent(customerId)}/timeline${buildQueryString(params)}`);
  return response.data.data;
};

export const logCrmCustomerCommunication = async (customerId, payload = {}) => {
  const response = await axiosClient.post(`/admin/crm/customers/${encodeURIComponent(customerId)}/communications`, payload);
  return response.data.data;
};

export const fetchCrmDuplicateCandidates = async (params = {}) => {
  const response = await axiosClient.get(`/admin/crm/duplicates${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchCrmLeads = async (params = {}) => {
  const response = await axiosClient.get(`/admin/crm/leads${buildQueryString(params)}`);
  return response.data.data;
};

export const createCrmLead = async (payload = {}) => {
  const response = await axiosClient.post("/admin/crm/leads", payload);
  return response.data.data;
};

export const updateCrmLead = async (leadId, payload = {}) => {
  const response = await axiosClient.patch(`/admin/crm/leads/${encodeURIComponent(leadId)}`, payload);
  return response.data.data;
};

export const convertCrmLeadToOpportunity = async (leadId, payload = {}) => {
  const response = await axiosClient.post(`/admin/crm/leads/${encodeURIComponent(leadId)}/convert-to-opportunity`, payload);
  return response.data.data;
};

export const fetchCrmOpportunities = async (params = {}) => {
  const response = await axiosClient.get(`/admin/crm/opportunities${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchCrmPipeline = async (params = {}) => {
  const response = await axiosClient.get(`/admin/crm/pipeline${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchCrmB2BPartners = async (params = {}) => {
  const response = await axiosClient.get(`/admin/crm/b2b-agents${buildQueryString(params)}`);
  return response.data.data;
};

export const createCrmB2BPartner = async (payload = {}) => {
  const response = await axiosClient.post("/admin/crm/b2b-agents", payload);
  return response.data.data;
};

export const updateCrmB2BPartner = async (partnerId, payload = {}) => {
  const response = await axiosClient.patch(`/admin/crm/b2b-agents/${encodeURIComponent(partnerId)}`, payload);
  return response.data.data;
};

export const createCrmOpportunity = async (payload = {}) => {
  const response = await axiosClient.post("/admin/crm/opportunities", payload);
  return response.data.data;
};

export const updateCrmOpportunity = async (opportunityId, payload = {}) => {
  const response = await axiosClient.patch(`/admin/crm/opportunities/${encodeURIComponent(opportunityId)}`, payload);
  return response.data.data;
};

export const fetchCrmQuotes = async (params = {}) => {
  const response = await axiosClient.get(`/admin/crm/quotes${buildQueryString(params)}`);
  return response.data.data;
};

export const createCrmQuote = async (payload = {}) => {
  const response = await axiosClient.post("/admin/crm/quotes", payload);
  return response.data.data;
};

export const updateCrmQuote = async (quoteId, payload = {}) => {
  const response = await axiosClient.patch(`/admin/crm/quotes/${encodeURIComponent(quoteId)}`, payload);
  return response.data.data;
};

export const approveCrmQuote = async (quoteId) => {
  const response = await axiosClient.post(`/admin/crm/quotes/${encodeURIComponent(quoteId)}/approve`, {});
  return response.data.data;
};

export const sendCrmQuote = async (quoteId) => {
  const response = await axiosClient.post(`/admin/crm/quotes/${encodeURIComponent(quoteId)}/send`, {});
  return response.data.data;
};

export const acceptCrmQuote = async (quoteId) => {
  const response = await axiosClient.post(`/admin/crm/quotes/${encodeURIComponent(quoteId)}/accept`, {});
  return response.data.data;
};

export const convertCrmQuoteToBooking = async (quoteId, payload = {}) => {
  const response = await axiosClient.post(`/admin/crm/quotes/${encodeURIComponent(quoteId)}/convert`, payload);
  return response.data.data;
};

export const fetchCrmFollowUps = async (params = {}) => {
  const response = await axiosClient.get(`/admin/crm/follow-ups${buildQueryString(params)}`);
  return response.data.data;
};

export const createCrmFollowUp = async (payload = {}) => {
  const response = await axiosClient.post("/admin/crm/follow-ups", payload);
  return response.data.data;
};

export const updateCrmFollowUp = async (followUpId, payload = {}) => {
  const response = await axiosClient.patch(`/admin/crm/follow-ups/${encodeURIComponent(followUpId)}`, payload);
  return response.data.data;
};

export const completeCrmFollowUp = async (followUpId, payload = {}) => {
  const response = await axiosClient.post(`/admin/crm/follow-ups/${encodeURIComponent(followUpId)}/complete`, payload);
  return response.data.data;
};

export const fetchCrmTasks = async (params = {}) => {
  const response = await axiosClient.get(`/admin/crm/tasks${buildQueryString(params)}`);
  return response.data.data;
};

export const createCrmTask = async (payload = {}) => {
  const response = await axiosClient.post("/admin/crm/tasks", payload);
  return response.data.data;
};

export const updateCrmTask = async (taskId, payload = {}) => {
  const response = await axiosClient.patch(`/admin/crm/tasks/${encodeURIComponent(taskId)}`, payload);
  return response.data.data;
};

export const completeCrmTask = async (taskId, payload = {}) => {
  const response = await axiosClient.post(`/admin/crm/tasks/${encodeURIComponent(taskId)}/complete`, payload);
  return response.data.data;
};

export const fetchBusinessAccountingFoundation = async (params = {}) => {
  const response = await axiosClient.get(`/admin/business-accounting/foundation${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchBookingAccountingDashboard = async (params = {}) => {
  const response = await axiosClient.get(`/admin/booking-accounting/dashboard${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchBookingAccountingInvoices = async (params = {}) => {
  const response = await axiosClient.get(`/admin/booking-accounting/invoices${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchBookingAccountingRefunds = async (params = {}) => {
  const response = await axiosClient.get(`/admin/booking-accounting/refunds${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchBookingAccountingExpenses = async (params = {}) => {
  const response = await axiosClient.get(`/admin/booking-accounting/expenses${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchBookingAccountingCostTemplates = async (params = {}) => {
  const response = await axiosClient.get(`/admin/booking-accounting/cost-templates${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchBookingAccountingCostTemplate = async (templateId) => {
  const response = await axiosClient.get(`/admin/booking-accounting/cost-templates/${encodeURIComponent(templateId)}`);
  return response.data.data;
};

export const createBookingAccountingCostTemplate = async (payload = {}) => {
  const response = await axiosClient.post("/admin/booking-accounting/cost-templates", payload);
  return response.data.data;
};

export const updateBookingAccountingCostTemplate = async (templateId, payload = {}) => {
  const response = await axiosClient.put(`/admin/booking-accounting/cost-templates/${encodeURIComponent(templateId)}`, payload);
  return response.data.data;
};

export const archiveBookingAccountingCostTemplate = async (templateId, payload = {}) => {
  const response = await axiosClient.post(`/admin/booking-accounting/cost-templates/${encodeURIComponent(templateId)}/archive`, payload);
  return response.data.data;
};

export const previewBookingAccountingCostTemplate = async (payload = {}) => {
  const response = await axiosClient.post("/admin/booking-accounting/cost-templates/preview", payload);
  return response.data.data;
};

export const fetchBookingAccountingProfitability = async (params = {}) => {
  const response = await axiosClient.get(`/admin/booking-accounting/profitability${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchBookingAccountingReconciliation = async (params = {}) => {
  const response = await axiosClient.get(`/admin/booking-accounting/reconciliation${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchBusinessIncome = async (params = {}) => {
  const response = await axiosClient.get(`/admin/business-income${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchBusinessExpenses = async (params = {}) => {
  const response = await axiosClient.get(`/admin/business-expenses${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchReportCenterCatalog = async () => {
  const response = await axiosClient.get("/admin/report-center/catalog");
  return response.data.data;
};

export const runReportCenterReport = async (reportType, params = {}) => {
  const response = await axiosClient.get(`/admin/report-center/reports/${encodeURIComponent(reportType)}${buildQueryString(params)}`);
  return response.data.data;
};

export const exportReportCenterReport = async (reportType, params = {}) => {
  const response = await axiosClient.get(
    `/admin/report-center/reports/${encodeURIComponent(reportType)}/export${buildQueryString(params)}`,
    { responseType: "blob" }
  );
  const disposition = response.headers?.["content-disposition"] || "";
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return {
    blob: response.data,
    filename: match?.[1] || `${reportType}.${String(params.format || "csv").toLowerCase()}`,
    contentType: response.headers?.["content-type"] || "application/octet-stream"
  };
};

export const fetchReportExportHistory = async (params = {}) => {
  const response = await axiosClient.get(`/admin/report-center/exports/history${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchAuditControlSummary = async (params = {}) => {
  const response = await axiosClient.get(`/admin/audit-control/summary${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchAuditLogs = async (params = {}) => {
  const response = await axiosClient.get(`/admin/audit-control/audit-logs${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchFinancialChanges = async (params = {}) => {
  const response = await axiosClient.get(`/admin/audit-control/financial-changes${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchDataQualitySummary = async (params = {}) => {
  const response = await axiosClient.get(`/admin/data-quality/summary${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchDataQualityIssues = async (params = {}) => {
  const response = await axiosClient.get(`/admin/data-quality/issues${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchOpsControlSummary = async (params = {}) => {
  const response = await axiosClient.get(`/admin/ops-control/summary${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchSystemAlerts = async (params = {}) => {
  const response = await axiosClient.get(`/admin/ops-control/alerts${buildQueryString(params)}`);
  return response.data.data;
};

export const acknowledgeSystemAlert = async (alertId) => {
  const response = await axiosClient.post(`/admin/ops-control/alerts/${encodeURIComponent(alertId)}/acknowledge`, {});
  return response.data.data;
};

export const resolveSystemAlert = async (alertId, resolutionNote = "") => {
  const response = await axiosClient.post(`/admin/ops-control/alerts/${encodeURIComponent(alertId)}/resolve`, {
    resolutionNote
  });
  return response.data.data;
};

export const dismissSystemAlert = async (alertId) => {
  const response = await axiosClient.post(`/admin/ops-control/alerts/${encodeURIComponent(alertId)}/dismiss`, {});
  return response.data.data;
};

export const fetchFailedJobs = async (params = {}) => {
  const response = await axiosClient.get(`/admin/ops-control/failed-jobs${buildQueryString(params)}`);
  return response.data.data;
};

export const retryFailedJob = async (jobId, payload = {}) => {
  const response = await axiosClient.post(`/admin/ops-control/failed-jobs/${encodeURIComponent(jobId)}/retry`, payload);
  return response.data.data;
};

export const fetchChartOfAccounts = async (params = {}) => {
  const response = await axiosClient.get(`/admin/accounting/chart-of-accounts${buildQueryString(params)}`);
  return response.data.data;
};

export const seedChartOfAccounts = async (payload = { dryRun: true }) => {
  const response = await axiosClient.post("/admin/accounting/chart-of-accounts/seed-defaults", payload);
  return response.data.data;
};

export const fetchGeneralLedgerJournals = async (params = {}) => {
  const response = await axiosClient.get(`/admin/accounting/journals${buildQueryString(params)}`);
  return response.data.data;
};

export const createGeneralLedgerJournal = async (payload = {}) => {
  const response = await axiosClient.post("/admin/accounting/journals", payload);
  return response.data.data;
};

export const approveGeneralLedgerJournal = async (journalId, payload = {}) => {
  const response = await axiosClient.post(`/admin/accounting/journals/${encodeURIComponent(journalId)}/approve`, payload);
  return response.data.data;
};

export const postGeneralLedgerJournal = async (journalId, payload = {}) => {
  const response = await axiosClient.post(`/admin/accounting/journals/${encodeURIComponent(journalId)}/post`, payload);
  return response.data.data;
};

export const reverseGeneralLedgerJournal = async (journalId, payload = {}) => {
  const response = await axiosClient.post(`/admin/accounting/journals/${encodeURIComponent(journalId)}/reverse`, payload);
  return response.data.data;
};

export const fetchGeneralLedger = async (params = {}) => {
  const response = await axiosClient.get(`/admin/accounting/general-ledger${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchTrialBalance = async (params = {}) => {
  const response = await axiosClient.get(`/admin/accounting/trial-balance${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchLedgerProfitLoss = async (params = {}) => {
  const response = await axiosClient.get(`/admin/accounting/profit-loss${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchLedgerBalanceSheet = async (params = {}) => {
  const response = await axiosClient.get(`/admin/accounting/balance-sheet${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchLedgerCashFlow = async (params = {}) => {
  const response = await axiosClient.get(`/admin/accounting/cash-flow${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchAccountingPeriods = async (params = {}) => {
  const response = await axiosClient.get(`/admin/accounting/periods${buildQueryString(params)}`);
  return response.data.data;
};

export const closeAccountingPeriod = async (periodId, payload = {}) => {
  const response = await axiosClient.post(`/admin/accounting/periods/${encodeURIComponent(periodId)}/close`, payload);
  return response.data.data;
};

export const reopenAccountingPeriod = async (periodId, payload = {}) => {
  const response = await axiosClient.post(`/admin/accounting/periods/${encodeURIComponent(periodId)}/reopen`, payload);
  return response.data.data;
};

export const fetchAccountingReconciliation = async (params = {}) => {
  const response = await axiosClient.get(`/admin/accounting/reconciliation${buildQueryString(params)}`);
  return response.data.data;
};

export const fetchAccountingHealth = async () => {
  const response = await axiosClient.get("/admin/accounting/health");
  return response.data.data;
};

export const seedAccountingMappings = async (payload = { dryRun: true }) => {
  const response = await axiosClient.post("/admin/accounting/mappings/seed-defaults", payload);
  return response.data.data;
};

export const runHistoricalLedgerMigration = async (payload = { dryRun: true }) => {
  const response = await axiosClient.post("/admin/accounting/historical-migration", payload);
  return response.data.data;
};

export const fetchFixedAssets = async () => {
  const response = await axiosClient.get("/admin/accounting/fixed-assets");
  return response.data.data;
};
