import axiosClient from "./axiosClient";

export const fetchAgentDashboard = async () => {
  const response = await axiosClient.get("/agent/dashboard");
  return response.data.data;
};

export const fetchAgentStatement = async (month) => {
  const response = await axiosClient.get(`/agents/me/statements/${month}`);
  return response.data.data;
};

export const fetchAgentBookings = async () => {
  const response = await axiosClient.get("/agent/bookings");
  return response.data.data;
};

export const fetchAgentBookingDetails = async (id) => {
  const response = await axiosClient.get(`/agent/bookings/${id}`);
  return response.data.data;
};

export const fetchAgentBookingVoucher = async (id) => {
  const response = await axiosClient.get(`/agent/bookings/${id}/voucher`);
  return response.data.data;
};

export const resendAgentBookingVoucher = async (id) => {
  const response = await axiosClient.post(`/agent/bookings/${id}/resend-confirmation`);
  return response.data.data;
};

export const requestAgentBookingCancellation = async (id, reason) => {
  const response = await axiosClient.post(`/bookings/${id}/cancel`, {
    reason: reason || "Agent requested cancellation"
  });
  return response.data.data;
};

export const fetchAgentCommissions = async () => {
  const response = await axiosClient.get("/agent/commissions");
  return response.data.data;
};

export const fetchAgentPayoutRequests = async () => {
  const response = await axiosClient.get("/agent/payout-requests");
  return response.data.data;
};

export const requestAgentPayout = async (payload = {}) => {
  const response = await axiosClient.post("/agent/payout-requests", payload);
  return response.data.data;
};

export const fetchAgentNotifications = async () => {
  const response = await axiosClient.get("/agent/notifications");
  return response.data.data;
};

export const fetchAgentActivity = async () => {
  const response = await axiosClient.get("/agent/activity");
  return response.data.data;
};

export const fetchAgentReports = async () => {
  const response = await axiosClient.get("/agent/reports");
  return response.data.data;
};

export const acceptAgentTerms = async (version = "2026-07") => {
  const response = await axiosClient.post("/agent/terms/accept", { version });
  return response.data.data;
};

export const fetchAgentProfile = async () => {
  const response = await axiosClient.get("/agent/profile");
  return response.data.data;
};

export const updateAgentProfile = async (payload) => {
  const response = await axiosClient.post("/agent/profile/update", payload);
  return response.data.data;
};

export const fetchAgentPayoutMethod = async () => {
  const response = await axiosClient.get("/agent/payout-method");
  return response.data.data;
};

export const updateAgentPayoutMethod = async (payload) => {
  const response = await axiosClient.post("/agent/payout-method/update", payload);
  return response.data.data;
};

export const fetchAgentSettings = async () => {
  const response = await axiosClient.get("/agent/settings");
  return response.data.data;
};

export const updateAgentSettings = async (payload) => {
  const response = await axiosClient.post("/agent/settings/update", payload);
  return response.data.data;
};
