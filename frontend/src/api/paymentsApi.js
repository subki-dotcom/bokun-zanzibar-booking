import axiosClient from "./axiosClient";

export const fetchPaymentProviders = async () => {
  const response = await axiosClient.get("/payments/providers");
  return response.data.data || [];
};

// The payment state of a booking for the payment pages (any browser, with the payment link's key).
export const fetchBookingPaymentStatus = async (reference, { key = "", recheck = false } = {}) => {
  const response = await axiosClient.get(`/bookings/${encodeURIComponent(reference)}/payment-status`, {
    params: { key, ...(recheck ? { recheck: "1" } : {}) }
  });
  return response.data.data;
};

// A payment session for the same booking: the saved provider page while valid, otherwise a new one.
export const openBookingPaymentSession = async (reference, { key = "", provider = "" } = {}) => {
  const response = await axiosClient.post(`/bookings/${encodeURIComponent(reference)}/payment-session`, {
    key,
    ...(provider ? { provider } : {})
  });
  return response.data.data;
};

export const createPesapalPayment = async (payload) => {
  const response = await axiosClient.post("/payments/pesapal/create", payload);
  return response.data.data;
};

export const createDpoPayment = async (payload) => {
  const response = await axiosClient.post("/payments/dpo/create", payload);
  return response.data.data;
};

export const createPaypalPayment = async (payload) => {
  const response = await axiosClient.post("/payments/paypal/create", payload);
  return response.data.data;
};

export const verifyPesapalPayment = async ({ orderTrackingId = "", orderMerchantReference = "" } = {}) => {
  const response = await axiosClient.get("/payments/pesapal/success", {
    params: {
      ...(orderTrackingId ? { OrderTrackingId: orderTrackingId } : {}),
      ...(orderMerchantReference ? { OrderMerchantReference: orderMerchantReference } : {})
    }
  });
  return response.data.data;
};

export const fetchPesapalPaymentStatus = async ({ orderTrackingId = "", orderMerchantReference = "" } = {}) => {
  const response = await axiosClient.get("/payments/pesapal/status", {
    params: {
      ...(orderTrackingId ? { OrderTrackingId: orderTrackingId } : {}),
      ...(orderMerchantReference ? { OrderMerchantReference: orderMerchantReference } : {})
    }
  });
  return response.data.data;
};

export const verifyDpoPayment = async ({ transactionToken = "" } = {}) => {
  const response = await axiosClient.get("/payments/dpo/success", {
    params: {
      TransactionToken: transactionToken
    }
  });
  return response.data.data;
};

export const verifyPaypalPayment = async ({ orderId = "" } = {}) => {
  const response = await axiosClient.get("/payments/paypal/success", {
    params: {
      token: orderId
    }
  });
  return response.data.data;
};

export const cancelPesapalPayment = async ({
  orderTrackingId = "",
  orderMerchantReference = "",
  bookingId = ""
} = {}) => {
  const response = await axiosClient.get("/payments/pesapal/cancel", {
    params: {
      ...(orderTrackingId ? { OrderTrackingId: orderTrackingId } : {}),
      ...(orderMerchantReference ? { OrderMerchantReference: orderMerchantReference } : {}),
      ...(bookingId ? { bookingId } : {})
    }
  });
  return response.data.data;
};

export const cancelDpoPayment = async ({ transactionToken = "", bookingId = "" } = {}) => {
  const response = await axiosClient.get("/payments/dpo/cancel", {
    params: {
      ...(transactionToken ? { TransactionToken: transactionToken } : {}),
      ...(bookingId ? { bookingId } : {})
    }
  });
  return response.data.data;
};

export const cancelPaypalPayment = async ({ orderId = "", bookingId = "" } = {}) => {
  const response = await axiosClient.get("/payments/paypal/cancel", {
    params: {
      ...(orderId ? { token: orderId } : {}),
      ...(bookingId ? { bookingId } : {})
    }
  });
  return response.data.data;
};
