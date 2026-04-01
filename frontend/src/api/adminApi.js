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