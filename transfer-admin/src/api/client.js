import axios from "axios";
import { API_BASE_URL } from "../../../shared/src/config/api";

// The Transfer Admin session lives in sessionStorage: it ends when the tab is closed and is separate from the
// website, the Back Office and the agent portal (different origin and different key).
const TOKEN_KEY = "riser_transfer_admin_token";
export const UNAUTHORIZED_EVENT = "transfer-admin:unauthorized";

const storage = () => (typeof window !== "undefined" ? window.sessionStorage : null);

export const tokenStore = {
  get: () => storage()?.getItem(TOKEN_KEY) || "",
  set: (token) => storage()?.setItem(TOKEN_KEY, token),
  clear: () => storage()?.removeItem(TOKEN_KEY)
};

const client = axios.create({ baseURL: `${API_BASE_URL}/transfer-admin`, timeout: 30000 });

client.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const normalizeError = (error) => {
  const response = error?.response;
  return {
    status: response?.status || 0,
    code: response?.data?.error?.code || (response ? "REQUEST_FAILED" : "NETWORK_ERROR"),
    message: response?.data?.message || (response ? "The request failed." : "Cannot reach the server. Check your connection."),
    details: response?.data?.error?.details || null
  };
};

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const normalized = normalizeError(error);
    // An expired or revoked session sends the user back to the login page.
    if (normalized.status === 401 && normalized.code !== "TRANSFER_INVALID_CREDENTIALS" && typeof window !== "undefined") {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    return Promise.reject(normalized);
  }
);

export default client;
