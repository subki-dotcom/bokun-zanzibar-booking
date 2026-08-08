const { env } = require("../config/env");
const logger = require("../config/logger");
const bokunConfirmedBookingsService = require("../services/bokunConfirmedBookings");

let importTimer = null;
let consecutiveFailures = 0;
let nextAllowedRunAt = 0;

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
    logger.info("Bokun confirmed booking import cycle finished", {
      trigger,
      syncLogId: result.syncLogId,
      summary: result.summary
    });
    return result;
  } catch (error) {
    consecutiveFailures += 1;
    nextAllowedRunAt = Date.now() + calculateBackoffMs();
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
  if (!env.BOKUN_CONFIRMED_BOOKING_IMPORT_ENABLED) {
    logger.info("Bokun confirmed booking import poller disabled", {
      envFlag: "BOKUN_CONFIRMED_BOOKING_IMPORT_ENABLED=false"
    });
    return;
  }

  if (importTimer) return;

  const intervalMs = Math.max(60, Number(env.BOKUN_CONFIRMED_BOOKING_IMPORT_INTERVAL_SECONDS || 900)) * 1000;

  logger.info("Bokun confirmed booking import poller started", {
    intervalSeconds: intervalMs / 1000,
    batchSize: Number(env.BOKUN_CONFIRMED_BOOKING_IMPORT_BATCH_SIZE || 50),
    maxPages: Number(env.BOKUN_CONFIRMED_BOOKING_IMPORT_MAX_PAGES || 5)
  });

  importTimer = setInterval(() => {
    runConfirmedBookingImportCycle("interval");
  }, intervalMs);

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
  logger.info("Bokun confirmed booking import poller stopped");
};

module.exports = {
  runConfirmedBookingImportCycle,
  startBokunConfirmedBookingImportPoller,
  stopBokunConfirmedBookingImportPoller,
  __testables: {
    buildLookbackRange,
    calculateBackoffMs
  }
};
