import axiosClient from "./axiosClient";

const emailQuery = (customerEmail) => `customerEmail=${encodeURIComponent(String(customerEmail || "").trim())}`;

export const submitBookingRequest = async (bookingId, payload) => {
  const response = await axiosClient.post(`/bookings/${bookingId}/requests`, payload);
  return response.data.data;
};

export const fetchCustomerBookingRequests = async (bookingId, customerEmail) => {
  const response = await axiosClient.get(`/bookings/${bookingId}/requests?${emailQuery(customerEmail)}`);
  return response.data.data;
};

export const fetchCancellationEstimate = async (bookingId, customerEmail) => {
  const response = await axiosClient.get(`/bookings/${bookingId}/cancellation-estimate?${emailQuery(customerEmail)}`);
  return response.data.data;
};

export const fetchCustomerBookingRequest = async (requestId, customerEmail) => {
  const response = await axiosClient.get(`/booking-requests/${requestId}?${emailQuery(customerEmail)}`);
  return response.data.data;
};

export const respondToBookingRequest = async (requestId, payload) => {
  const response = await axiosClient.post(`/booking-requests/${requestId}/customer-response`, payload);
  return response.data.data;
};

export const cancelCustomerBookingRequest = async (requestId, customerEmail) => {
  const response = await axiosClient.post(`/booking-requests/${requestId}/cancel`, { customerEmail });
  return response.data.data;
};

export const fetchAdminBookingRequests = async (filters = {}) => {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  });
  const response = await axiosClient.get(`/admin/booking-requests?${params.toString()}`);
  return response.data.data;
};

export const fetchAdminBookingRequest = async (requestId) => {
  const response = await axiosClient.get(`/admin/booking-requests/${requestId}`);
  return response.data.data;
};

const postAdminAction = async (requestId, action, payload = {}) => {
  const response = await axiosClient.post(`/admin/booking-requests/${requestId}/${action}`, payload);
  return response.data.data;
};

export const approveBookingRequest = (requestId, payload) => postAdminAction(requestId, "approve", payload);
export const rejectBookingRequest = (requestId, payload) => postAdminAction(requestId, "reject", payload);
export const requestBookingInformation = (requestId, payload) => postAdminAction(requestId, "request-information", payload);
export const recalculateBookingRequest = (requestId) => postAdminAction(requestId, "recalculate-price");
export const retryBookingRequestBokunSync = (requestId) => postAdminAction(requestId, "retry-bokun-sync");
export const retryBookingRequestEmail = (requestId) => postAdminAction(requestId, "send-email");

export const updateBookingRequestRefund = async (refundId, payload) => {
  const response = await axiosClient.post(`/admin/refunds/${refundId}/status`, payload);
  return response.data.data;
};

export const recordVerifiedAdjustmentPayment = async (adjustmentId, payload = {}) => {
  const response = await axiosClient.post(`/admin/payment-adjustments/${adjustmentId}/mark-paid`, payload);
  return response.data.data;
};
