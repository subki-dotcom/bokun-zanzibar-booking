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
