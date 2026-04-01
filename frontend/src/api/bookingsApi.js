import axiosClient from "./axiosClient";

export const fetchAvailability = async (payload) => {
  const response = await axiosClient.post("/bokun/availability", payload);
  return response.data.data;
};

export const fetchBookingQuestions = async (payload) => {
  const response = await axiosClient.post("/bokun/booking-questions", payload);
  return response.data.data;
};

export const createQuote = async (payload) => {
  const response = await axiosClient.post("/bookings/quote", payload);
  return response.data.data;
};

export const createBooking = async (payload) => {
  const response = await axiosClient.post("/bookings/create", payload);
  return response.data.data;
};

export const fetchBookingByReference = async (reference) => {
  const response = await axiosClient.get(`/bookings/${reference}`);
  return response.data.data;
};

export const cancelBooking = async (id, reason) => {
  const response = await axiosClient.post(`/bookings/${id}/cancel`, { reason });
  return response.data.data;
};

export const requestBookingEdit = async (id, payload) => {
  const response = await axiosClient.post(`/bookings/${id}/edit-request`, payload);
  return response.data.data;
};

export const fetchRecentBookings = async () => {
  const response = await axiosClient.get("/bookings/recent");
  return response.data.data;
};

export const fetchBookingStats = async () => {
  const response = await axiosClient.get("/bookings/stats");
  return response.data.data;
};