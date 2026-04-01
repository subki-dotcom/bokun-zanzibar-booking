import axiosClient from "./axiosClient";

export const fetchTours = async ({ page = 1, limit = 9 } = {}) => {
  const response = await axiosClient.get("/tours", {
    params: { page, limit }
  });

  return {
    items: response.data.data || [],
    pagination: response.data.meta || {}
  };
};

export const fetchTourCategories = async () => {
  const response = await axiosClient.get("/tours/categories");
  return response.data.data || [];
};

export const fetchTourBySlug = async (slug) => {
  const response = await axiosClient.get(`/tours/${slug}`);
  return response.data.data;
};

export const fetchTourOptions = async (id) => {
  const response = await axiosClient.get(`/tours/${id}/options`);
  return response.data.data;
};

export const checkTourOptionsAvailability = async (slug, payload) => {
  const response = await axiosClient.post(`/tours/${slug}/options-availability`, payload);
  return response.data.data;
};

export const syncTours = async () => {
  const response = await axiosClient.post("/tours/sync");
  return response.data.data;
};
