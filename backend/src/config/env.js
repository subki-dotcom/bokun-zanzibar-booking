const { cleanEnv, str, port, num, bool } = require("envalid");

const env = cleanEnv(process.env, {
  NODE_ENV: str({ default: "development" }),
  PORT: port({ default: 5000 }),
  MONGO_URI: str(),
  JWT_SECRET: str(),
  JWT_EXPIRES_IN: str({ default: "7d" }),
  FRONTEND_URL: str({ default: "https://bokun-zanzibar-booking.vercel.app" }),
  RATE_LIMIT_WINDOW_MS: num({ default: 15 * 60 * 1000 }),
  RATE_LIMIT_MAX: num({ default: 1200 }),
  DEFAULT_CURRENCY: str({ default: "USD" }),
  BOKUN_BASE_URL: str({ default: "https://api.bokun.io" }),
  BOKUN_ACCESS_KEY: str({ default: "" }),
  BOKUN_SECRET_KEY: str({ default: "" }),
  BOKUN_API_KEY: str({ default: "" }),
  BOKUN_TIMEOUT_MS: num({ default: 30000 }),
  BOKUN_RETRY_COUNT: num({ default: 2 }),
  BOKUN_MOCK_MODE: bool({ default: false }),
  BOKUN_WEBHOOK_SECRET: str({ default: "" }),
  BOKUN_BOOKING_SYNC_ENABLED: bool({ default: false }),
  BOKUN_BOOKING_SYNC_INTERVAL_SECONDS: num({ default: 300 }),
  BOKUN_BOOKING_SYNC_BATCH_SIZE: num({ default: 20 }),
  PESAPAL_BASE_URL: str({ default: "https://pay.pesapal.com/v3/api" }),
  PESAPAL_AUTH_PATH: str({ default: "/Auth/RequestToken" }),
  PESAPAL_SUBMIT_ORDER_PATH: str({ default: "/Transactions/SubmitOrderRequest" }),
  PESAPAL_STATUS_PATH: str({ default: "/Transactions/GetTransactionStatus" }),
  PESAPAL_CONSUMER_KEY: str({ default: "" }),
  PESAPAL_CONSUMER_SECRET: str({ default: "" }),
  PESAPAL_SUCCESS_URL: str({ default: "https://bokun-zanzibar-booking.vercel.app/payment-success" }),
  PESAPAL_CANCEL_URL: str({ default: "https://bokun-zanzibar-booking.vercel.app/payment-failure" }),
  PESAPAL_CALLBACK_URL: str({ default: "" }),
  PESAPAL_IPN_ID: str({ default: "" }),
  PESAPAL_TIMEOUT_MS: num({ default: 20000 }),
  PESAPAL_MOCK_MODE: bool({ default: false }),
  PESAPAL_ALLOW_LOCAL_REDIRECTS: bool({ default: false }),
  DPO_BASE_URL: str({ default: "https://secure.3gdirectpay.com" }),
  DPO_API_PATH: str({ default: "/API/v6/" }),
  DPO_PAYMENT_PATH: str({ default: "/payv3.php" }),
  DPO_COMPANY_TOKEN: str({ default: "" }),
  DPO_SERVICE_TYPE: str({ default: "" }),
  DPO_SUCCESS_URL: str({ default: "https://bokun-zanzibar-booking.vercel.app/payment-success" }),
  DPO_CANCEL_URL: str({ default: "https://bokun-zanzibar-booking.vercel.app/payment-failure" }),
  DPO_CALLBACK_URL: str({ default: "" }),
  DPO_TIMEOUT_MS: num({ default: 20000 }),
  DPO_MOCK_MODE: bool({ default: false }),
  DPO_ALLOW_LOCAL_REDIRECTS: bool({ default: false }),
  GLOBAL_AGENT_COMMISSION_PERCENT: num({ default: 10 }),
  QUOTE_TTL_MINUTES: num({ default: 15 }),
  TAX_PERCENT: num({ default: 0 })
});

const isBokunConfigured =
  Boolean(env.BOKUN_ACCESS_KEY) &&
  Boolean(env.BOKUN_SECRET_KEY);

const isDpoConfigured =
  Boolean(env.DPO_COMPANY_TOKEN) &&
  Boolean(env.DPO_SERVICE_TYPE);

const isPesapalConfigured =
  Boolean(env.PESAPAL_CONSUMER_KEY) &&
  Boolean(env.PESAPAL_CONSUMER_SECRET);

module.exports = { env, isBokunConfigured, isDpoConfigured, isPesapalConfigured };
