import axiosClient from "./axiosClient";

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
