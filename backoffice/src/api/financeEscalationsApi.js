import axiosClient from "../../../shared/src/api/axiosClient";

// Finance escalation queue (read-only). Authorised on the server by booking_accounting.read.
const FILTERS = ["page", "limit", "scope", "type", "category", "bookingReference", "requestReference"];

const queryString = (params = {}) => {
  const query = new URLSearchParams();
  for (const key of FILTERS) {
    const value = params[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") query.set(key, String(value).trim());
  }
  const text = query.toString();
  return text ? `?${text}` : "";
};

export const fetchFinanceEscalations = async (params = {}) => {
  const response = await axiosClient.get(`/admin/finance/escalations${queryString(params)}`);
  return response.data.data;
};

export const fetchFinanceEscalation = async (requestId) => {
  const response = await axiosClient.get(`/admin/finance/escalations/${encodeURIComponent(requestId)}`);
  return response.data.data;
};
