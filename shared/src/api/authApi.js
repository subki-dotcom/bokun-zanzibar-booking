import axiosClient from "./axiosClient";

const AUTH_REQUEST_TIMEOUT_MS = 120000;

export const login = async (payload) => {
  const response = await axiosClient.post("/auth/login", payload, { timeout: AUTH_REQUEST_TIMEOUT_MS });
  return response.data.data;
};

export const requestPasswordReset = async (payload) => {
  const response = await axiosClient.post("/auth/forgot-password", payload, { timeout: AUTH_REQUEST_TIMEOUT_MS });
  return response.data;
};

export const resetPassword = async (payload) => {
  const response = await axiosClient.post("/auth/reset-password", payload, { timeout: AUTH_REQUEST_TIMEOUT_MS });
  return response.data;
};

export const registerAdminSeed = async (payload) => {
  const response = await axiosClient.post("/auth/register-admin", payload, { timeout: AUTH_REQUEST_TIMEOUT_MS });
  return response.data.data;
};

export const registerAgent = async (payload) => {
  const response = await axiosClient.post("/auth/register-agent", payload, { timeout: AUTH_REQUEST_TIMEOUT_MS });
  return response.data.data;
};

export const fetchCurrentProfile = async () => {
  const response = await axiosClient.get("/auth/me", { timeout: AUTH_REQUEST_TIMEOUT_MS });
  return response.data.data;
};

export const warmAuthBackend = async () => {
  try {
    await axiosClient.get("/health/live", { timeout: AUTH_REQUEST_TIMEOUT_MS });
  } catch (_error) {
    return null;
  }
  return true;
};
