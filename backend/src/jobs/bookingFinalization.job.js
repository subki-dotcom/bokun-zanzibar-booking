const { env } = require("../config/env");
const logger = require("../config/logger");
const bookingsService = require("../services/bookings");

let finalizationTimer = null;
const state = {
  name: "booking_finalization",
  enabled: Boolean(env.BOOKING_FINALIZATION_RETRY_ENABLED),
  running: false,
  active: false,
  intervalSeconds: Math.max(30, Number(env.BOOKING_FINALIZATION_RETRY_INTERVAL_SECONDS || 30)),
  batchSize: Number(env.BOOKING_FINALIZATION_RETRY_BATCH_SIZE || 20),
  lastRunAt: "",
  lastSuccessAt: "",
  lastFailureAt: "",
  lastError: "",
  consecutiveFailures: 0,
  lastSummary: null
};

const nowIso = () => new Date().toISOString();

const runFinalizationCycle = async (trigger = "interval") => {
  state.running = true;
  state.lastRunAt = nowIso();
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

    state.running = false;
    state.lastSuccessAt = nowIso();
    state.lastError = "";
    state.consecutiveFailures = 0;
    state.lastSummary = result.summary || null;
    return result;
  } catch (error) {
    logger.error("Booking finalization reconciliation cycle failed", {
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

const startBookingFinalizationPoller = () => {
  state.enabled = Boolean(env.BOOKING_FINALIZATION_RETRY_ENABLED);
  if (!env.BOOKING_FINALIZATION_RETRY_ENABLED) {
    state.active = false;
    logger.info("Booking finalization poller disabled", {
      envFlag: "BOOKING_FINALIZATION_RETRY_ENABLED=false"
    });
    return;
  }

  if (finalizationTimer) {
    return;
  }

  const intervalMs =
    Math.max(30, Number(env.BOOKING_FINALIZATION_RETRY_INTERVAL_SECONDS || 30)) * 1000;
  state.intervalSeconds = intervalMs / 1000;
  state.batchSize = Number(env.BOOKING_FINALIZATION_RETRY_BATCH_SIZE || 20);

  logger.info("Booking finalization poller started", {
    intervalSeconds: intervalMs / 1000,
    batchSize: Number(env.BOOKING_FINALIZATION_RETRY_BATCH_SIZE || 20)
  });

  finalizationTimer = setInterval(() => {
    runFinalizationCycle("interval");
  }, intervalMs);
  state.active = true;

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
  state.active = false;
  logger.info("Booking finalization poller stopped");
};

const getBookingFinalizationWorkerStatus = () => ({
  ...state,
  active: Boolean(finalizationTimer),
  status: !state.enabled ? "disabled" : finalizationTimer ? state.consecutiveFailures ? "degraded" : "running" : "stopped"
});

module.exports = {
  getBookingFinalizationWorkerStatus,
  runFinalizationCycle,
  startBookingFinalizationPoller,
  stopBookingFinalizationPoller
};
