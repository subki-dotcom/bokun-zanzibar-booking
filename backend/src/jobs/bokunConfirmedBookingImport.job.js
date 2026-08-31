const { env, isBokunConfigured } = require("../config/env");
const logger = require("../config/logger");
const bokunConfirmedBookingsService = require("../services/bokunConfirmedBookings");

let importTimer = null;
let consecutiveFailures = 0;
let nextAllowedRunAt = 0;
const state = {
  name: "bokun_confirmed_booking_import",
  enabled: Boolean(env.BOKUN_CONFIRMED_BOOKING_IMPORT_ENABLED),
  running: false,
  active: false,
  intervalSeconds: Math.max(60, Number(env.BOKUN_CONFIRMED_BOOKING_IMPORT_INTERVAL_SECONDS || 900)),
  batchSize: Number(env.BOKUN_CONFIRMED_BOOKING_IMPORT_BATCH_SIZE || 50),
  maxPages: Number(env.BOKUN_CONFIRMED_BOOKING_IMPORT_MAX_PAGES || 5),
  configured: Boolean(isBokunConfigured || env.BOKUN_MOCK_MODE),
  lastRunAt: "",
  lastSuccessAt: "",
  lastFailureAt: "",
  lastError: "",
  consecutiveFailures: 0,
  nextAllowedRunAt: "",
  lastSummary: null
};

const nowIso = () => new Date().toISOString();

const calculateBackoffMs = () => {
  const minutes = Math.min(30, Math.max(1, 2 ** Math.min(consecutiveFailures, 5)));
  return minutes * 60 * 1000;
};

const buildLookbackRange = () => {
  const lookbackDays = Math.max(1, Number(env.BOKUN_CONFIRMED_BOOKING_IMPORT_LOOKBACK_DAYS || 30));
  const to = new Date();
  const from = new Date(to.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  return {
    fromDate: from.toISOString(),
    toDate: to.toISOString()
  };
};

const isImportConfigured = () => Boolean(isBokunConfigured || env.BOKUN_MOCK_MODE);

const runConfirmedBookingImportCycle = async (trigger = "interval") => {
  const nowMs = Date.now();
  if (nextAllowedRunAt && nowMs < nextAllowedRunAt) {
    logger.debug("Bokun confirmed booking import skipped during backoff", {
      trigger,
      retryAt: new Date(nextAllowedRunAt).toISOString(),
      consecutiveFailures
    });
    return {
      skipped: true,
      reason: "backoff",
      retryAt: new Date(nextAllowedRunAt).toISOString()
    };
  }

  state.running = true;
  state.lastRunAt = nowIso();
  const range = buildLookbackRange();
  try {
    const result = await bokunConfirmedBookingsService.syncConfirmedBookings({
      source: "scheduled_confirmed_booking_import",
      requestId: `bokun_confirmed_import_${Date.now()}`,
      pageSize: Number(env.BOKUN_CONFIRMED_BOOKING_IMPORT_BATCH_SIZE || 50),
      maxPages: Number(env.BOKUN_CONFIRMED_BOOKING_IMPORT_MAX_PAGES || 5),
      dateRangeField: "lastModifiedDateRange",
      ...range
    });

    consecutiveFailures = 0;
    nextAllowedRunAt = 0;
    state.running = false;
    state.lastSuccessAt = nowIso();
    state.lastError = "";
    state.consecutiveFailures = 0;
    state.nextAllowedRunAt = "";
    state.lastSummary = result.summary || null;
    logger.info("Bokun confirmed booking import cycle finished", {
      trigger,
      syncLogId: result.syncLogId,
      summary: result.summary
    });
    return result;
  } catch (error) {
    consecutiveFailures += 1;
    nextAllowedRunAt = Date.now() + calculateBackoffMs();
    state.running = false;
    state.lastFailureAt = nowIso();
    state.lastError = error.message;
    state.consecutiveFailures = consecutiveFailures;
    state.nextAllowedRunAt = new Date(nextAllowedRunAt).toISOString();
    logger.error("Bokun confirmed booking import cycle failed", {
      trigger,
      error: error.message,
      consecutiveFailures,
      retryAt: new Date(nextAllowedRunAt).toISOString()
    });
    return null;
  }
};

const startBokunConfirmedBookingImportPoller = () => {
  state.enabled = Boolean(env.BOKUN_CONFIRMED_BOOKING_IMPORT_ENABLED);
  state.configured = isImportConfigured();
  if (!env.BOKUN_CONFIRMED_BOOKING_IMPORT_ENABLED) {
    state.active = false;
    logger.info("Bokun confirmed booking import poller disabled", {
      envFlag: "BOKUN_CONFIRMED_BOOKING_IMPORT_ENABLED=false"
    });
    return;
  }

  if (!state.configured) {
    state.active = false;
    state.lastError =
      "Bokun confirmed booking import is enabled, but BOKUN_ACCESS_KEY and BOKUN_SECRET_KEY are missing.";
    logger.warn("Bokun confirmed booking import poller blocked by missing credentials", {
      mockMode: Boolean(env.BOKUN_MOCK_MODE)
    });
    return;
  }

  if (importTimer) return;

  const intervalMs = Math.max(60, Number(env.BOKUN_CONFIRMED_BOOKING_IMPORT_INTERVAL_SECONDS || 900)) * 1000;
  state.intervalSeconds = intervalMs / 1000;
  state.batchSize = Number(env.BOKUN_CONFIRMED_BOOKING_IMPORT_BATCH_SIZE || 50);
  state.maxPages = Number(env.BOKUN_CONFIRMED_BOOKING_IMPORT_MAX_PAGES || 5);
  state.lastError = "";

  logger.info("Bokun confirmed booking import poller started", {
    intervalSeconds: intervalMs / 1000,
    batchSize: Number(env.BOKUN_CONFIRMED_BOOKING_IMPORT_BATCH_SIZE || 50),
    maxPages: Number(env.BOKUN_CONFIRMED_BOOKING_IMPORT_MAX_PAGES || 5)
  });

  importTimer = setInterval(() => {
    runConfirmedBookingImportCycle("interval");
  }, intervalMs);
  state.active = true;

  if (typeof importTimer.unref === "function") {
    importTimer.unref();
  }

  const bootTimer = setTimeout(() => {
    runConfirmedBookingImportCycle("startup");
  }, 20 * 1000);

  if (typeof bootTimer.unref === "function") {
    bootTimer.unref();
  }
};

const stopBokunConfirmedBookingImportPoller = () => {
  if (!importTimer) return;
  clearInterval(importTimer);
  importTimer = null;
  state.active = false;
  logger.info("Bokun confirmed booking import poller stopped");
};

const getBokunConfirmedBookingImportWorkerStatus = () => ({
  ...state,
  configured: isImportConfigured(),
  active: Boolean(importTimer),
  consecutiveFailures,
  nextAllowedRunAt: nextAllowedRunAt ? new Date(nextAllowedRunAt).toISOString() : "",
  status: !state.enabled
    ? "disabled"
    : !isImportConfigured()
      ? "blocked"
      : importTimer
        ? consecutiveFailures
          ? "degraded"
          : "running"
        : "stopped"
});

module.exports = {
  getBokunConfirmedBookingImportWorkerStatus,
  runConfirmedBookingImportCycle,
  startBokunConfirmedBookingImportPoller,
  stopBokunConfirmedBookingImportPoller,
  __testables: {
    buildLookbackRange,
    calculateBackoffMs
  }
};
