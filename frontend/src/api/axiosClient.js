import axios from "axios";
import { API_BASE_URL } from "../config/api";

const mapProviderErrorMessage = ({ code = "", message = "", details = null }) => {
  const normalizedCode = String(code || "").trim();
  const providerStatus = Number(details?.statusCode || 0);

  if (normalizedCode === "PESAPAL_NOT_CONFIGURED") {
    return "Payment gateway is not configured yet. Please contact support.";
  }

  if (normalizedCode === "PESAPAL_IPN_ID_MISSING") {
    return "Payment callback setup is incomplete. Please contact support.";
  }

  if (normalizedCode === "PESAPAL_INVALID_REDIRECT_URLS") {
    return "Payment callback URLs are invalid for live mode. Please contact support.";
  }

  if (normalizedCode === "PESAPAL_EDGE_BLOCKED") {
    return "Pesapal blocked this payment request. Please retry shortly or contact support.";
  }

  if (normalizedCode === "PESAPAL_TOKEN_MISSING") {
    return "Payment authentication failed. Please retry shortly.";
  }

  if (normalizedCode === "PESAPAL_API_REQUEST_FAILED") {
    if (providerStatus === 401) {
      return "Pesapal credentials were rejected (401). Please contact support.";
    }

    if (providerStatus === 403) {
      return "Pesapal blocked this server request (403). Please contact support.";
    }

    if (providerStatus >= 500) {
      return "Pesapal service is temporarily unavailable. Please try again shortly.";
    }

    return message || "Could not complete payment request with Pesapal.";
  }

  if (normalizedCode === "PESAPAL_CREATE_ORDER_FAILED") {
    return "Payment order could not be created. Please try again.";
  }

  return "";
};

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
    const providerMessage = mapProviderErrorMessage({
      code: responseCode,
      message: responseMessage,
      details: responseDetails
    });
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
          : providerMessage
            ? providerMessage
            : responseMessage
              ? responseMessage
              : error.response?.status >= 500
                ? "Server is temporarily unavailable. Please try again shortly."
                : error.message || "Request failed",
      details: responseDetails || null
    };

    return Promise.reject(normalizedError);
  }
);

export default axiosClient;
