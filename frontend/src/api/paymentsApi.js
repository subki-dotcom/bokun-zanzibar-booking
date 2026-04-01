import axiosClient from "./axiosClient";

export const createPesapalPayment = async (payload) => {
  const response = await axiosClient.post("/payments/pesapal/create", payload);
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
