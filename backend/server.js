require("dotenv").config();

const app = require("./src/app");
const connectDB = require("./src/config/db");
const { env, isBokunConfigured, isPesapalConfigured, isDpoConfigured, isPaypalConfigured } = require("./src/config/env");
const logger = require("./src/config/logger");
const { startBookingSyncPoller, stopBookingSyncPoller } = require("./src/jobs/bookingSync.job");
const {
  startBookingFinalizationPoller,
  stopBookingFinalizationPoller
} = require("./src/jobs/bookingFinalization.job");
const {
  startRefundReconciliationPoller,
  stopRefundReconciliationPoller
} = require("./src/jobs/refundReconciliation.job");
const {
  startBokunConfirmedBookingImportPoller,
  stopBokunConfirmedBookingImportPoller
} = require("./src/jobs/bokunConfirmedBookingImport.job");

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
        dpo: env.DPO_MOCK_MODE ? "mock_mode" : isDpoConfigured ? "configured" : "not_configured",
        paypal: env.PAYPAL_MOCK_MODE ? "mock_mode" : isPaypalConfigured ? "configured" : "not_configured"
      }
    });
    startBookingSyncPoller();
    startBokunConfirmedBookingImportPoller();
    startBookingFinalizationPoller();
    startRefundReconciliationPoller();
  });
};

process.on("SIGINT", () => {
  stopBookingSyncPoller();
  stopBokunConfirmedBookingImportPoller();
  stopBookingFinalizationPoller();
  stopRefundReconciliationPoller();
});

process.on("SIGTERM", () => {
  stopBookingSyncPoller();
  stopBokunConfirmedBookingImportPoller();
  stopBookingFinalizationPoller();
  stopRefundReconciliationPoller();
});

bootstrap();
