const { env } = require("../config/env");
const logger = require("../config/logger");
const webhooksService = require("../modules/webhooks/webhooks.service");

let pollTimer = null;

const runPollingCycle = async (trigger = "interval") => {
  try {
    const result = await webhooksService.pollBookingUpdates({
      source: "polling"
    });

    if (result?.skipped) {
      logger.debug("Bokun booking sync cycle skipped", {
        trigger,
        reason: result.reason || "unknown"
      });
      return result;
    }

    logger.info("Bokun booking sync cycle finished", {
      trigger,
      syncLogId: result.syncLogId,
      updated: result.updated,
      unchanged: result.unchanged,
      failed: result.failed,
      skipped: result.skipped
    });

    return result;
  } catch (error) {
    logger.error("Bokun booking sync cycle failed", {
      trigger,
      error: error.message
    });
    return null;
  }
};

const startBookingSyncPoller = () => {
  if (!env.BOKUN_BOOKING_SYNC_ENABLED) {
    logger.info("Bokun booking poller disabled", {
      envFlag: "BOKUN_BOOKING_SYNC_ENABLED=false"
    });
    return;
  }

  if (pollTimer) {
    return;
  }

  const intervalMs = Math.max(30, Number(env.BOKUN_BOOKING_SYNC_INTERVAL_SECONDS || 300)) * 1000;

  logger.info("Bokun booking poller started", {
    intervalSeconds: intervalMs / 1000,
    batchSize: Number(env.BOKUN_BOOKING_SYNC_BATCH_SIZE || 20)
  });

  pollTimer = setInterval(() => {
    runPollingCycle("interval");
  }, intervalMs);

  if (typeof pollTimer.unref === "function") {
    pollTimer.unref();
  }

  const bootTimer = setTimeout(() => {
    runPollingCycle("startup");
  }, 10 * 1000);

  if (typeof bootTimer.unref === "function") {
    bootTimer.unref();
  }
};

const stopBookingSyncPoller = () => {
  if (!pollTimer) {
    return;
  }

  clearInterval(pollTimer);
  pollTimer = null;
  logger.info("Bokun booking poller stopped");
};

module.exports = {
  startBookingSyncPoller,
  stopBookingSyncPoller
};
