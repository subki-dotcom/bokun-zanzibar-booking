import axiosClient from "./axiosClient";

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
