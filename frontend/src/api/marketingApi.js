import axiosClient from "./axiosClient";

// The contact page form: { name, email, phone, travelDate, message, website (left empty) }.
export const sendContactMessage = async (payload = {}) => {
  const response = await axiosClient.post("/marketing/contact", payload);
  return response.data.data;
};

export const captureMarketingLead = async (payload = {}) => {
  const response = await axiosClient.post("/marketing/leads", payload);
  return response.data.data;
};
