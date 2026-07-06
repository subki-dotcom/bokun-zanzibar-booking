import axiosClient from "./axiosClient";

export const fetchBokunCountries = async () => {
  const response = await axiosClient.get("/bokun/countries");
  return response.data.data;
};

export const fetchBokunProductDetails = async (productId, params = {}) => {
  const response = await axiosClient.get(`/bokun/products/${productId}`, {
    params
  });

  return response.data.data;
};

export const fetchProductBookingConfig = async (productId, params = {}) => {
  const response = await axiosClient.get(`/bokun/products/${productId}/booking-config`, {
    params
  });

  return response.data.data;
};

export const fetchProductLiveQuote = async (productId, payload) => {
  const response = await axiosClient.post(`/bokun/products/${productId}/live-quote`, payload);
  return response.data.data;
};
