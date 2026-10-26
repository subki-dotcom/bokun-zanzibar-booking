import axiosClient from "./axiosClient";

// Guest requests go through "My booking" (api/myBookingApi.js); these are the staff actions.
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

export const processBookingRequestRefund = async (refundId, payload = {}) => {
  const response = await axiosClient.post(`/admin/refunds/${refundId}/process`, payload);
  return response.data.data;
};

export const verifyBookingRequestRefund = async (refundId) => {
  const response = await axiosClient.post(`/admin/refunds/${refundId}/verify`, {});
  return response.data.data;
};

export const recordVerifiedAdjustmentPayment = async (adjustmentId, payload = {}) => {
  const response = await axiosClient.post(`/admin/payment-adjustments/${adjustmentId}/mark-paid`, payload);
  return response.data.data;
};
