require("dotenv").config();

const app = require("./app");
const connectDB = require("./config/db");
const { env, isBokunConfigured, isPesapalConfigured, isDpoConfigured } = require("./config/env");
const logger = require("./config/logger");
const { startBookingSyncPoller, stopBookingSyncPoller } = require("./jobs/bookingSync.job");
const {
  startBookingFinalizationPoller,
  stopBookingFinalizationPoller
} = require("./jobs/bookingFinalization.job");

const bootstrap = async () => {
  await connectDB();

  app.listen(env.PORT, () => {
    logger.info("Server started", {
      port: env.PORT,
      env: env.NODE_ENV,
      frontendUrl: env.FRONTEND_URL,
      integrations: {
        bokun: env.BOKUN_MOCK_MODE ? "mock_mode" : isBokunConfigured ? "configured" : "missing_credentials",
        pesapal: env.PESAPAL_MOCK_MODE ? "mock_mode" : isPesapalConfigured ? "configured" : "not_configured",
        dpo: env.DPO_MOCK_MODE ? "mock_mode" : isDpoConfigured ? "configured" : "not_configured"
      }
    });
    startBookingSyncPoller();
    startBookingFinalizationPoller();
  });
};

process.on("SIGINT", () => {
  stopBookingSyncPoller();
  stopBookingFinalizationPoller();
});

process.on("SIGTERM", () => {
  stopBookingSyncPoller();
  stopBookingFinalizationPoller();
});

bootstrap();
