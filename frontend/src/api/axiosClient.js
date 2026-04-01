import axios from "axios";

const axiosClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api",
  timeout: 30000
});

axiosClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("zanzibar_auth_token");

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

axiosClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const isTimeout = error.code === "ECONNABORTED";
    const isNetwork = !error.response;
    const normalizedError = {
      status: error.response?.status || 500,
      code: error.response?.data?.error?.code || "CLIENT_ERROR",
      message: isTimeout
        ? "Live Bokun response timed out. Please try again."
        : isNetwork
          ? "Network Error: backend is unreachable. Please confirm API server is running."
          : error.response?.data?.message || error.message || "Request failed",
      details: error.response?.data?.error?.details || null
    };

    return Promise.reject(normalizedError);
  }
);

export default axiosClient;
