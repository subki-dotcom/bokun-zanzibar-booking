import axiosClient from "./axiosClient";

export const captureMarketingLead = async (payload = {}) => {
  const response = await axiosClient.post("/marketing/leads", payload);
  return response.data.data;
};
