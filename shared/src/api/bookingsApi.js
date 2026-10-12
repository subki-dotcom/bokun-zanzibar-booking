import axiosClient from "./axiosClient";
import {
  BOOKING_ACCESS_HEADER,
  bookingAccessHeaders,
  captureBookingAccessFromLocation,
  forgetBookingAccess,
  markVerificationFailed,
  rememberBookingAccess,
  takePendingVerification
} from "./bookingAccess";

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

// Exchanges the single-use link from a verification email for an access token, once.
export const redeemPendingBookingVerification = async (reference) => {
  captureBookingAccessFromLocation();
  const verification = takePendingVerification(reference);
  if (!verification) return;
  try {
    const response = await axiosClient.post("/bookings/access/redeem", { bookingReference: reference, verification });
    const data = response.data.data;
    rememberBookingAccess(data.bookingReference, data.accessToken, data.expiresAt);
  } catch {
    markVerificationFailed(reference);
  }
};

// Sends a request carrying the booking's stored token; a token the server refuses is discarded.
export const getWithBookingAccess = async (url, reference) => {
  await redeemPendingBookingVerification(reference);
  const headers = bookingAccessHeaders(reference);
  try {
    return await axiosClient.get(url, { headers });
  } catch (error) {
    if (headers[BOOKING_ACCESS_HEADER] && error?.status === 404) forgetBookingAccess(reference);
    throw error;
  }
};

export const fetchBookingByReference = async (reference) => {
  const response = await getWithBookingAccess(`/bookings/${encodeURIComponent(reference)}`, reference);
  return response.data.data;
};

// For links without a valid access token. The answer is the same whatever was entered; a
// single-use link goes only to the email stored on the booking.
export const requestBookingAccessLink = async ({ bookingReference, email }) => {
  const response = await axiosClient.post("/bookings/access/request", { bookingReference, email });
  return response.data.message;
};

export const cancelBooking = async (id, reason) => {
  const response = await axiosClient.post(`/bookings/${id}/cancel`, { reason });
  return response.data.data;
};

export const adminCancelBooking = async (id, reason) => {
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

export const fetchAdminBookings = async (params = {}) => {
  const query = new URLSearchParams();
  query.set("paginated", "true");

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "" && value !== "all") {
      query.set(key, String(value));
    }
  });

  const response = await axiosClient.get(`/bookings/recent?${query.toString()}`);
  return response.data.data;
};

export const fetchBookingStats = async () => {
  const response = await axiosClient.get("/bookings/stats");
  return response.data.data;
};
