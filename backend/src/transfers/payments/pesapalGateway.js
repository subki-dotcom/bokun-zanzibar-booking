const axios = require("axios");
const AppError = require("../../utils/AppError");
const { env } = require("../../config/env");
const {
  normalizePesapalStatus,
  isVerifiedPesapalPayment,
  isReversedPesapalStatus,
  isCancelledPesapalStatus,
  isFailedPesapalStatus,
  resolvePesapalResponseStatusCode,
  resolveOrderTrackingId,
  resolveMerchantReference,
  resolveRedirectUrl
} = require("../../integrations/pesapal/pesapal.utils");

// Pesapal client for the Transfer System. It uses the merchant keys of the Business Platform's Pesapal account but
// its own IPN registration and return page, and keeps no state shared with the tour payment code.

// What a GetTransactionStatus answer means for a transfer payment. Pesapal answers "INVALID" (status_code 0) while
// the customer has not finished paying, so only an explicit failure, cancellation or reversal is reported as such.
const STATES = Object.freeze({ PAID: "PAID", PENDING: "PENDING", FAILED: "FAILED", CANCELLED: "CANCELLED", REVERSED: "REVERSED" });
const transactionState = (response, status) => {
  if (isVerifiedPesapalPayment(response, status)) return STATES.PAID;
  const code = resolvePesapalResponseStatusCode(response);
  if (code === 3 || isReversedPesapalStatus(status)) return STATES.REVERSED;
  if (isCancelledPesapalStatus(status)) return STATES.CANCELLED;
  if (code === 2 || (isFailedPesapalStatus(status) && status !== "INVALID")) return STATES.FAILED;
  return STATES.PENDING;
};

const firstOrigin = (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean)[0] || "";

// The transfer IPN lives on the same backend as the tour IPN (PESAPAL_IPN_URL), at its own path, so the existing
// configuration is enough and Pesapal never notifies the tour handler about a transfer order.
const TRANSFER_IPN_PATH = "/api/transfers/payments/ipn";
const transferIpnUrl = (source) => {
  if (source.TRANSFER_PESAPAL_IPN_URL) return source.TRANSFER_PESAPAL_IPN_URL;
  try {
    return source.PESAPAL_IPN_URL ? `${new URL(source.PESAPAL_IPN_URL).origin}${TRANSFER_IPN_PATH}` : "";
  } catch (_error) {
    return "";
  }
};

const gatewaySettings = (source = env) => ({
  baseUrl: source.PESAPAL_BASE_URL,
  authPath: source.PESAPAL_AUTH_PATH,
  submitOrderPath: source.PESAPAL_SUBMIT_ORDER_PATH,
  statusPath: source.PESAPAL_STATUS_PATH,
  registerIpnPath: source.PESAPAL_REGISTER_IPN_PATH,
  consumerKey: source.PESAPAL_CONSUMER_KEY,
  consumerSecret: source.PESAPAL_CONSUMER_SECRET,
  timeoutMs: source.PESAPAL_TIMEOUT_MS,
  ipnId: source.PESAPAL_TRANSFER_IPN_ID,
  ipnUrl: transferIpnUrl(source),
  returnUrl: source.TRANSFER_PAYMENT_RETURN_URL || (firstOrigin(source.FRONTEND_URL) ? `${firstOrigin(source.FRONTEND_URL).replace(/\/+$/, "")}/transfers/payment/return` : "")
});

const createPesapalTransferGateway = ({ settings = () => gatewaySettings(), http = null } = {}) => {
  const token = { value: "", expiresAt: 0 };
  let registeredIpnId = "";

  const configured = () => {
    const current = settings();
    return Boolean(current.consumerKey && current.consumerSecret && current.returnUrl && (current.ipnId || current.ipnUrl));
  };

  const request = async ({ method, path, data, params, accessToken }) => {
    const current = settings();
    const client = http || axios.create({ baseURL: current.baseUrl, timeout: current.timeoutMs, headers: { "Content-Type": "application/json", Accept: "application/json" } });
    try {
      const response = await client.request({ method, url: path, data, params, headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
      return response.data || {};
    } catch (error) {
      throw new AppError("Pesapal could not be reached. Please try again in a moment.", 502, "TRANSFER_PESAPAL_UNAVAILABLE", { statusCode: error.response?.status || null, path });
    }
  };

  const accessToken = async () => {
    if (token.value && Date.now() + 60000 < token.expiresAt) return token.value;
    const current = settings();
    const response = await request({ method: "post", path: current.authPath, data: { consumer_key: current.consumerKey, consumer_secret: current.consumerSecret } });
    const value = String(response.token || "").trim();
    if (!value) throw new AppError("Pesapal did not accept the merchant keys.", 502, "TRANSFER_PESAPAL_AUTH_FAILED");
    const expiry = Date.parse(response.expiryDate || "");
    token.value = value;
    token.expiresAt = Number.isFinite(expiry) ? expiry : Date.now() + 4 * 60000;
    return value;
  };

  const notificationId = async (bearer) => {
    const current = settings();
    if (current.ipnId) return current.ipnId;
    if (registeredIpnId) return registeredIpnId;
    const response = await request({ method: "post", path: current.registerIpnPath, data: { url: current.ipnUrl, ipn_notification_type: "GET" }, accessToken: bearer });
    const id = String(response.ipn_id || "").trim();
    if (!id) throw new AppError("Pesapal did not register the transfer IPN URL.", 502, "TRANSFER_PESAPAL_IPN_FAILED");
    registeredIpnId = id;
    return id;
  };

  // Creates the Pesapal order and returns where to send the customer.
  const submitOrder = async ({ merchantReference, amount, currency, description, customer }) => {
    const bearer = await accessToken();
    const [firstName, ...rest] = String(customer.fullName || "").trim().split(/\s+/);
    const response = await request({
      method: "post",
      path: settings().submitOrderPath,
      accessToken: bearer,
      data: {
        id: merchantReference,
        currency,
        amount: Number(amount),
        description: String(description).slice(0, 100),
        callback_url: settings().returnUrl,
        cancellation_url: settings().returnUrl,
        redirect_mode: "TOP_WINDOW",
        notification_id: await notificationId(bearer),
        billing_address: { email_address: customer.email, phone_number: customer.phone || "", first_name: firstName || "", last_name: rest.join(" ") }
      }
    });
    const orderTrackingId = resolveOrderTrackingId(response);
    const redirectUrl = resolveRedirectUrl(response);
    if (!orderTrackingId || !redirectUrl) {
      throw new AppError("Pesapal did not open a payment page. Please try again.", 502, "TRANSFER_PESAPAL_ORDER_FAILED", { error: response.error || null });
    }
    return { orderTrackingId, redirectUrl };
  };

  // Pesapal's own record of the transaction; the only evidence a transfer payment is accepted on.
  const transactionStatus = async (orderTrackingId) => {
    const bearer = await accessToken();
    const response = await request({ method: "get", path: settings().statusPath, params: { orderTrackingId }, accessToken: bearer });
    const status = normalizePesapalStatus(response.payment_status_description || "");
    return {
      state: transactionState(response, status),
      status,
      statusCode: resolvePesapalResponseStatusCode(response),
      orderTrackingId: resolveOrderTrackingId(response) || orderTrackingId,
      merchantReference: resolveMerchantReference(response),
      amount: response.amount === undefined || response.amount === null ? "" : String(response.amount),
      currency: String(response.currency || "").trim().toUpperCase(),
      paymentMethod: String(response.payment_method || "").trim(),
      confirmationCode: String(response.confirmation_code || "").trim()
    };
  };

  return { configured, submitOrder, transactionStatus };
};

module.exports = { STATES, TRANSFER_IPN_PATH, transactionState, gatewaySettings, createPesapalTransferGateway };
