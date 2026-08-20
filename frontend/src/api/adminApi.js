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

export const fetchBusinessAccountingFoundation = async (params = {}) => {
  const response = await axiosClient.get(`/admin/business-accounting/foundation${buildQueryString(params)}`);
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
