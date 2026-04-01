import axiosClient from "./axiosClient";

export const login = async (payload) => {
  const response = await axiosClient.post("/auth/login", payload);
  return response.data.data;
};

export const registerAdminSeed = async (payload) => {
  const response = await axiosClient.post("/auth/register-admin", payload);
  return response.data.data;
};

export const fetchCurrentProfile = async () => {
  const response = await axiosClient.get("/auth/me");
  return response.data.data;
};