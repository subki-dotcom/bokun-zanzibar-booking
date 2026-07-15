import axiosClient from "./axiosClient";

export const fetchPublicReviews = async () => {
  const response = await axiosClient.get("/reviews");
  return response.data.data || { reviews: [] };
};
