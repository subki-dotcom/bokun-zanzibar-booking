const { env } = require("../config/env");
const logger = require("../config/logger");
const bookingsService = require("../modules/bookings/bookings.service");

let finalizationTimer = null;

const runFinalizationCycle = async (trigger = "interval") => {
  try {
    const result = await bookingsService.reconcilePendingFinalizations({
      limit: Number(env.BOOKING_FINALIZATION_RETRY_BATCH_SIZE || 20),
      force: false,
      requestId: `finalization_reconcile_${Date.now()}`,
      source: "system_reconciliation"
    });

    logger.info("Booking finalization reconciliation cycle finished", {
      trigger,
      summary: result.summary
    });

    return result;
  } catch (error) {
    logger.error("Booking finalization reconciliation cycle failed", {
      trigger,
      error: error.message
    });
    return null;
  }
};

const startBookingFinalizationPoller = () => {
  if (!env.BOOKING_FINALIZATION_RETRY_ENABLED) {
    logger.info("Booking finalization poller disabled", {
      envFlag: "BOOKING_FINALIZATION_RETRY_ENABLED=false"
    });
    return;
  }

  if (finalizationTimer) {
    return;
  }

  const intervalMs =
    Math.max(30, Number(env.BOOKING_FINALIZATION_RETRY_INTERVAL_SECONDS || 180)) * 1000;

  logger.info("Booking finalization poller started", {
    intervalSeconds: intervalMs / 1000,
    batchSize: Number(env.BOOKING_FINALIZATION_RETRY_BATCH_SIZE || 20)
  });

  finalizationTimer = setInterval(() => {
    runFinalizationCycle("interval");
  }, intervalMs);

  if (typeof finalizationTimer.unref === "function") {
    finalizationTimer.unref();
  }

  const bootTimer = setTimeout(() => {
    runFinalizationCycle("startup");
  }, 12 * 1000);

  if (typeof bootTimer.unref === "function") {
    bootTimer.unref();
  }
};

const stopBookingFinalizationPoller = () => {
  if (!finalizationTimer) {
    return;
  }

  clearInterval(finalizationTimer);
  finalizationTimer = null;
  logger.info("Booking finalization poller stopped");
};

module.exports = {
  runFinalizationCycle,
  startBookingFinalizationPoller,
  stopBookingFinalizationPoller
};
