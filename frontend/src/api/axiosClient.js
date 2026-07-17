import axios from "axios";
import { API_BASE_URL } from "../config/api";

const mapProviderErrorMessage = ({ code = "", message = "", details = null }) => {
  const normalizedCode = String(code || "").trim();
  const providerStatus = Number(details?.statusCode || 0);

  if (normalizedCode === "START_TIME_ID_REQUIRED") {
    return "The selected start time could not be confirmed. Please choose an available time and try again.";
  }

  if (normalizedCode === "BOKUN_REQUEST_FAILED" && providerStatus === 400) {
    const supplierMessage = String(details?.message || message || "").toLowerCase();
    if (/missing starttimeid|starttimeid/.test(supplierMessage)) {
      return "The selected start time is no longer available. Please choose another time and try again.";
    }

    if (/invalid or missing answers|invalidanswersexception/.test(supplierMessage)) {
      return "This tour needs additional booking information before payment. Please complete the required fields.";
    }

    return "The supplier could not validate these booking details. Please review your trip details and try again.";
  }

  if (normalizedCode === "PESAPAL_NOT_CONFIGURED") {
    return "Payment gateway is not configured yet. Please contact support.";
  }

  if (
    normalizedCode === "PESAPAL_IPN_ID_MISSING" ||
    normalizedCode === "PESAPAL_IPN_SETUP_MISSING" ||
    normalizedCode === "PESAPAL_IPN_URL_MISSING"
  ) {
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

  if (normalizedCode === "PAYPAL_NOT_CONFIGURED") {
    return "PayPal is not configured yet. Please contact support.";
  }

  if (normalizedCode === "PAYPAL_INVALID_REDIRECT_URLS") {
    return "PayPal callback URLs are invalid for live mode. Please contact support.";
  }

  if (normalizedCode === "PAYPAL_TOKEN_MISSING") {
    return "PayPal authentication failed. Please retry shortly.";
  }

  if (normalizedCode === "PAYPAL_API_REQUEST_FAILED") {
    if (providerStatus === 401) {
      return "PayPal credentials were rejected. Please contact support.";
    }

    if (providerStatus >= 500) {
      return "PayPal service is temporarily unavailable. Please try again shortly.";
    }

    return message || "Could not complete payment request with PayPal.";
  }

  if (normalizedCode === "PAYPAL_CREATE_ORDER_FAILED") {
    return "PayPal payment order could not be created. Please try again.";
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
    const supplierMessage = String(
      typeof responseDetails === "string" ? responseDetails : responseDetails?.message || ""
    );
    const isBokunTimeout =
      responseCode === "BOKUN_TIMEOUT" ||
      (responseCode === "BOKUN_REQUEST_FAILED" &&
        Number(responseDetails?.statusCode || 0) >= 500 &&
        /timeout|timed out|econnaborted/i.test(supplierMessage));
    const isBokunUpstreamUnavailable =
      responseCode === "BOKUN_UPSTREAM_UNREACHABLE" ||
      (responseCode === "BOKUN_REQUEST_FAILED" &&
        Number(responseDetails?.statusCode || 0) >= 500 &&
        /enotfound|econnreset|socket hang up|network/i.test(supplierMessage));

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
