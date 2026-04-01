require("dotenv").config();

const app = require("./app");
const connectDB = require("./config/db");
const { env } = require("./config/env");
const logger = require("./config/logger");
const { startBookingSyncPoller, stopBookingSyncPoller } = require("./jobs/bookingSync.job");

const bootstrap = async () => {
  await connectDB();

  app.listen(env.PORT, () => {
    logger.info("Server started", {
      port: env.PORT,
      env: env.NODE_ENV
    });
    startBookingSyncPoller();
  });
};

process.on("SIGINT", () => {
  stopBookingSyncPoller();
});

process.on("SIGTERM", () => {
  stopBookingSyncPoller();
});

bootstrap();
