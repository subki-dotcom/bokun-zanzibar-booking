const { env } = require("../config/env");
const logger = require("../config/logger");
const webhooksService = require("../services/webhooks");

let pollTimer = null;
const state = {
  name: "bokun_booking_sync",
  enabled: Boolean(env.BOKUN_BOOKING_SYNC_ENABLED),
  running: false,
  active: false,
  intervalSeconds: Math.max(30, Number(env.BOKUN_BOOKING_SYNC_INTERVAL_SECONDS || 300)),
  batchSize: Number(env.BOKUN_BOOKING_SYNC_BATCH_SIZE || 20),
  lastRunAt: "",
  lastSuccessAt: "",
  lastFailureAt: "",
  lastError: "",
  consecutiveFailures: 0,
  lastSummary: null
};

const nowIso = () => new Date().toISOString();

const runPollingCycle = async (trigger = "interval") => {
  state.running = true;
  state.lastRunAt = nowIso();
  try {
    const result = await webhooksService.pollBookingUpdates({
      source: "polling"
    });

    if (result?.skipped) {
      logger.debug("Bokun booking sync cycle skipped", {
        trigger,
        reason: result.reason || "unknown"
      });
      state.running = false;
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

    state.running = false;
    state.lastSuccessAt = nowIso();
    state.lastError = "";
    state.consecutiveFailures = 0;
    state.lastSummary = {
      syncLogId: result.syncLogId,
      updated: result.updated,
      unchanged: result.unchanged,
      failed: result.failed,
      skipped: result.skipped
    };
    return result;
  } catch (error) {
    logger.error("Bokun booking sync cycle failed", {
      trigger,
      error: error.message
    });
    state.running = false;
    state.lastFailureAt = nowIso();
    state.lastError = error.message;
    state.consecutiveFailures += 1;
    return null;
  }
};

const startBookingSyncPoller = () => {
  state.enabled = Boolean(env.BOKUN_BOOKING_SYNC_ENABLED);
  if (!env.BOKUN_BOOKING_SYNC_ENABLED) {
    state.active = false;
    logger.info("Bokun booking poller disabled", {
      envFlag: "BOKUN_BOOKING_SYNC_ENABLED=false"
    });
    return;
  }

  if (pollTimer) {
    return;
  }

  const intervalMs = Math.max(30, Number(env.BOKUN_BOOKING_SYNC_INTERVAL_SECONDS || 300)) * 1000;
  state.intervalSeconds = intervalMs / 1000;
  state.batchSize = Number(env.BOKUN_BOOKING_SYNC_BATCH_SIZE || 20);

  logger.info("Bokun booking poller started", {
    intervalSeconds: intervalMs / 1000,
    batchSize: Number(env.BOKUN_BOOKING_SYNC_BATCH_SIZE || 20)
  });

  pollTimer = setInterval(() => {
    runPollingCycle("interval");
  }, intervalMs);
  state.active = true;

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
  state.active = false;
  logger.info("Bokun booking poller stopped");
};

const getBookingSyncWorkerStatus = () => ({
  ...state,
  active: Boolean(pollTimer),
  status: !state.enabled ? "disabled" : pollTimer ? state.consecutiveFailures ? "degraded" : "running" : "stopped"
});

module.exports = {
  getBookingSyncWorkerStatus,
  runPollingCycle,
  startBookingSyncPoller,
  stopBookingSyncPoller
};
