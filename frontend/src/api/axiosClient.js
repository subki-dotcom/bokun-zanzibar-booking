import axios from "axios";
import { API_BASE_URL } from "../config/api";

const axiosClient = axios.create({
  baseURL: API_BASE_URL,
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
    const responseCode = error.response?.data?.error?.code || "CLIENT_ERROR";
    const responseMessage = error.response?.data?.message || "";
    const responseDetails = error.response?.data?.error?.details;
    const responseDetailsText =
      typeof responseDetails === "string"
        ? responseDetails
        : JSON.stringify(responseDetails || {});
    const isBokunTimeout =
      responseCode === "BOKUN_TIMEOUT" ||
      (responseCode === "BOKUN_REQUEST_FAILED" && /timeout|timed out|econnaborted/i.test(responseDetailsText));
    const isBokunUpstreamUnavailable =
      responseCode === "BOKUN_UPSTREAM_UNREACHABLE" ||
      (responseCode === "BOKUN_REQUEST_FAILED" && /enotfound|econnreset|socket hang up|network/i.test(responseDetailsText));

    const normalizedError = {
      status: error.response?.status || 500,
      code: responseCode,
      requestId: error.response?.data?.meta?.requestId || "",
      message: isBokunTimeout
        ? "Live availability from Bokun is taking longer than expected. Please try again."
        : isBokunUpstreamUnavailable
          ? "Live supplier service is temporarily unreachable. Please retry in a moment."
        : isTimeout
          ? "The server took too long to respond. Please try again."
        : isNetwork
          ? "Unable to reach the server. Please check your connection and try again."
          : error.response?.status >= 500
            ? "Server is temporarily unavailable. Please try again shortly."
            : responseMessage || error.message || "Request failed",
      details: responseDetails || null
    };

    return Promise.reject(normalizedError);
  }
);

export default axiosClient;
