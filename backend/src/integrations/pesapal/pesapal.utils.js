const crypto = require("crypto");

const normalizePesapalStatus = (value = "") =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");

const isPaidPesapalStatus = (value = "") => {
  const status = normalizePesapalStatus(value);
  const paidStatuses = new Set([
    "COMPLETED",
    "PAID",
    "SUCCESS",
    "SUCCESSFUL",
    "APPROVED"
  ]);

  return paidStatuses.has(status);
};

const toMoneyAmount = (value = 0) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Number(numeric.toFixed(2));
};

const normalizeCurrency = (value = "USD") => {
  const token = String(value || "USD").trim().toUpperCase();
  return token || "USD";
};

const buildPesapalOrderReference = (bookingReference = "") => {
  const token = String(bookingReference || "").trim();
  if (token) {
    return token.slice(0, 120);
  }

  const nonce = crypto.randomBytes(6).toString("hex");
  return `BK-${Date.now()}-${nonce}`.slice(0, 120);
};

const resolveOrderTrackingId = (payload = {}) =>
  String(
    payload?.order_tracking_id ||
      payload?.orderTrackingId ||
      payload?.OrderTrackingId ||
      payload?.tracking_id ||
      ""
  ).trim();

const resolveMerchantReference = (payload = {}) =>
  String(
    payload?.merchant_reference ||
      payload?.merchantReference ||
      payload?.OrderMerchantReference ||
      payload?.orderMerchantReference ||
      payload?.id ||
      ""
  ).trim();

const resolveRedirectUrl = (payload = {}) =>
  String(
    payload?.redirect_url ||
      payload?.redirectUrl ||
      payload?.payment_url ||
      payload?.paymentUrl ||
      ""
  ).trim();

const isPrivateIpv4Host = (host = "") => {
  const token = String(host || "").trim();
  if (!token) {
    return false;
  }

  const octets = token.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  if (octets[0] === 10) return true;
  if (octets[0] === 127) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  if (octets[0] === 169 && octets[1] === 254) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;

  return false;
};

const isLocalOrPrivateRedirectUrl = (value = "") => {
  try {
    const parsed = new URL(String(value || "").trim());
    const host = String(parsed.hostname || "").toLowerCase();

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return true;
    }

    if (!host) {
      return true;
    }

    if (
      host === "localhost" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local")
    ) {
      return true;
    }

    if (isPrivateIpv4Host(host)) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
};

module.exports = {
  normalizePesapalStatus,
  isPaidPesapalStatus,
  toMoneyAmount,
  normalizeCurrency,
  buildPesapalOrderReference,
  resolveOrderTrackingId,
  resolveMerchantReference,
  resolveRedirectUrl,
  isLocalOrPrivateRedirectUrl
};
