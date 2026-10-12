import axiosClient from "../../../shared/src/api/axiosClient";

// Tour Operations API (Phase 3A backend). Every call is authorised on the server by tour_operations.read,
// tour_requests.read or tour_requests.process; hiding screens in the Back Office is only a convenience.

// Only parameters the server accepts are sent: it rejects unknown ones.
const BOOKING_FILTERS = ["page", "limit", "origin", "bookingStatus", "paymentStatus", "supplierStatus", "travelDateFrom", "travelDateTo", "search"];
const REQUEST_FILTERS = ["page", "limit", "type", "customerStatus", "state", "category", "bookingReference"];

const queryString = (params = {}, allowed = []) => {
  const query = new URLSearchParams();
  for (const key of allowed) {
    const value = params[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") query.set(key, String(value).trim());
  }
  const text = query.toString();
  return text ? `?${text}` : "";
};

export const fetchTourBookings = async (params = {}) => {
  const response = await axiosClient.get(`/tour-operations/bookings${queryString(params, BOOKING_FILTERS)}`);
  return response.data.data;
};

// Exact-reference lookup through the list endpoint (there is no single-booking endpoint).
export const fetchTourBooking = async (bookingReference) => {
  const data = await fetchTourBookings({ search: bookingReference, limit: 1 });
  const booking = (data?.items || []).find((item) => item.bookingReference === String(bookingReference || "").toUpperCase());
  return booking || null;
};

export const fetchTourRequests = async (params = {}) => {
  const response = await axiosClient.get(`/tour-operations/requests${queryString(params, REQUEST_FILTERS)}`);
  return response.data.data;
};

export const fetchTourRequest = async (requestId) => {
  const response = await axiosClient.get(`/tour-operations/requests/${encodeURIComponent(requestId)}`);
  return response.data.data;
};

export const addTourRequestNote = async (requestId, text) => {
  const response = await axiosClient.post(`/tour-operations/requests/${encodeURIComponent(requestId)}/notes`, { text });
  return response.data.data;
};

export const transitionTourRequest = async (requestId, { toState, expectedVersion, reason = "" }) => {
  const response = await axiosClient.post(`/tour-operations/requests/${encodeURIComponent(requestId)}/transition`, {
    toState,
    expectedVersion,
    ...(reason ? { reason } : {})
  });
  return response.data.data;
};

export const setTourRequestCategory = async (requestId, { category, expectedVersion }) => {
  const response = await axiosClient.post(`/tour-operations/requests/${encodeURIComponent(requestId)}/category`, { category, expectedVersion });
  return response.data.data;
};
