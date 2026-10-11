const DEV_FALLBACK_API_BASE_URL = "http://127.0.0.1:5000/api";
const PROD_FALLBACK_API_BASE_URL = "https://bokun-zanzibar-booking.onrender.com/api";

const appendApiPath = (value = "") => {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  const normalized = trimmed.replace(/\/+$/, "");
  if (/\/api$/i.test(normalized)) {
    return normalized;
  }

  return `${normalized}/api`;
};

const resolveApiBaseUrl = () => {
  const fromEnv = appendApiPath(import.meta.env.VITE_API_BASE_URL || "");
  if (fromEnv) {
    return fromEnv;
  }

  if (import.meta.env.PROD) {
    return PROD_FALLBACK_API_BASE_URL;
  }

  return DEV_FALLBACK_API_BASE_URL;
};

export const API_BASE_URL = resolveApiBaseUrl();
