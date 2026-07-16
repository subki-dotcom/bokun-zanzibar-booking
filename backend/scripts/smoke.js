const requiredTestDefaults = {
  NODE_ENV: "test",
  PORT: "5000",
  FRONTEND_URL: "http://localhost:5173",
  DEFAULT_CURRENCY: "USD",
  JWT_SECRET: "smoke-test-secret",
  MONGO_URI: "mongodb://127.0.0.1:27017/bokun_smoke",
  BOKUN_MOCK_MODE: "true",
  BOKUN_ACCESS_KEY: "mock-access",
  BOKUN_SECRET_KEY: "mock-secret",
  BOKUN_API_KEY: "mock-api-key",
  PESAPAL_MOCK_MODE: "true",
  PESAPAL_CONSUMER_KEY: "mock-key",
  PESAPAL_CONSUMER_SECRET: "mock-secret",
  PESAPAL_IPN_ID: "mock-ipn",
  PESAPAL_ALLOW_LOCAL_REDIRECTS: "true"
};

Object.entries(requiredTestDefaults).forEach(([key, value]) => {
  if (!process.env[key]) {
    process.env[key] = value;
  }
});

require("../src/config/env");
require("../src/app");
require("../src/services/bookings");
require("../src/services/payments/pesapal");

console.log("Backend smoke OK");
