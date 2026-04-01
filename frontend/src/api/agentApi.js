import axiosClient from "./axiosClient";

export const fetchAgentDashboard = async () => {
  const response = await axiosClient.get("/agents/me/dashboard");
  return response.data.data;
};

export const fetchAgentStatement = async (month) => {
  const response = await axiosClient.get(`/agents/me/statements/${month}`);
  return response.data.data;
};

export const fetchAgentBookings = async () => {
  const response = await axiosClient.get("/bookings/recent");
  return response.data.data;
};