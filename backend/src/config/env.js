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
  BOOKING_FINALIZATION_RETRY_ENABLED: bool({ default: false }),
  BOOKING_FINALIZATION_RETRY_INTERVAL_SECONDS: num({ default: 180 }),
  BOOKING_FINALIZATION_RETRY_BATCH_SIZE: num({ default: 20 }),
  BOOKING_FINALIZATION_MAX_RETRIES: num({ default: 8 }),
  PESAPAL_BASE_URL: str({ default: "https://pay.pesapal.com/v3/api" }),
  PESAPAL_AUTH_PATH: str({ default: "/Auth/RequestToken" }),
  PESAPAL_SUBMIT_ORDER_PATH: str({ default: "/Transactions/SubmitOrderRequest" }),
  PESAPAL_STATUS_PATH: str({ default: "/Transactions/GetTransactionStatus" }),
  PESAPAL_REGISTER_IPN_PATH: str({ default: "/URLSetup/RegisterIPN" }),
  PESAPAL_CONSUMER_KEY: str({ default: "" }),
  PESAPAL_CONSUMER_SECRET: str({ default: "" }),
  PESAPAL_SUCCESS_URL: str({ default: "https://bokun-zanzibar-booking.vercel.app/payment-success" }),
  PESAPAL_CANCEL_URL: str({ default: "https://bokun-zanzibar-booking.vercel.app/payment-failure" }),
  PESAPAL_CALLBACK_URL: str({ default: "" }),
  PESAPAL_IPN_URL: str({ default: "" }),
  PESAPAL_IPN_ID: str({ default: "" }),
  PESAPAL_TIMEOUT_MS: num({ default: 20000 }),
  PESAPAL_MOCK_MODE: bool({ default: false }),
  PESAPAL_MOCK_CONFIRMS_PAYMENT: bool({ default: false }),
  PESAPAL_ALLOW_LOCAL_REDIRECTS: bool({ default: false }),
  PAYPAL_BASE_URL: str({ default: "https://api-m.sandbox.paypal.com" }),
  PAYPAL_CLIENT_ID: str({ default: "" }),
  PAYPAL_CLIENT_SECRET: str({ default: "" }),
  PAYPAL_SUCCESS_URL: str({ default: "https://bokun-zanzibar-booking.vercel.app/payment-success" }),
  PAYPAL_CANCEL_URL: str({ default: "https://bokun-zanzibar-booking.vercel.app/payment-failure" }),
  PAYPAL_TIMEOUT_MS: num({ default: 20000 }),
  PAYPAL_MOCK_MODE: bool({ default: false }),
  PAYPAL_MOCK_CONFIRMS_PAYMENT: bool({ default: false }),
  PAYPAL_ALLOW_LOCAL_REDIRECTS: bool({ default: false }),
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
  TAX_PERCENT: num({ default: 0 }),
  EMAIL_ENABLED: bool({ default: false }),
  EMAIL_PROVIDER: str({ default: "resend" }),
  RESEND_API_KEY: str({ default: "" }),
  EMAIL_FROM: str({ default: "" }),
  EMAIL_REPLY_TO: str({ default: "info@risertoursandsafaris.co.tz" }),
  GOOGLE_PLACES_API_KEY: str({ default: "" }),
  GOOGLE_PLACE_ID: str({ default: "" }),
  GOOGLE_REVIEW_URL: str({ default: "" })
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

const isPaypalConfigured =
  Boolean(env.PAYPAL_CLIENT_ID) &&
  Boolean(env.PAYPAL_CLIENT_SECRET);

const isEmailConfigured =
  Boolean(env.EMAIL_ENABLED) &&
  env.EMAIL_PROVIDER === "resend" &&
  Boolean(env.RESEND_API_KEY) &&
  Boolean(env.EMAIL_FROM);

module.exports = { env, isBokunConfigured, isDpoConfigured, isPesapalConfigured, isPaypalConfigured, isEmailConfigured };
