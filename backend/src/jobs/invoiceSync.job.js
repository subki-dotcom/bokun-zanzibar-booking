const { env } = require("../config/env");
const logger = require("../config/logger");
const bookingsService = require("../services/bookings");

let invoiceSyncTimer = null;
const state = {
  name: "invoice_sync",
  enabled: Boolean(env.INVOICE_SYNC_ENABLED),
  running: false,
  active: false,
  intervalSeconds: Math.max(30, Number(env.INVOICE_SYNC_INTERVAL_SECONDS || 300)),
  batchSize: Number(env.INVOICE_SYNC_BATCH_SIZE || 100),
  lastRunAt: "",
  lastSuccessAt: "",
  lastFailureAt: "",
  lastError: "",
  consecutiveFailures: 0,
  lastSummary: null
};

const nowIso = () => new Date().toISOString();

const runInvoiceSyncCycle = async (trigger = "interval") => {
  if (state.running) return { skipped: true, reason: "sync_already_running" };
  state.running = true;
  state.lastRunAt = nowIso();
  try {
    const summary = await bookingsService.syncMissingInvoices({
      limit: Number(env.INVOICE_SYNC_BATCH_SIZE || 100),
      requestId: `invoice_sync_${Date.now()}`,
      source: "invoice_sync_job"
    });
    state.running = false;
    state.lastSuccessAt = nowIso();
    state.lastError = "";
    state.consecutiveFailures = 0;
    state.lastSummary = summary;
    logger.info("Invoice sync cycle finished", { trigger, summary });
    return summary;
  } catch (error) {
    state.running = false;
    state.lastFailureAt = nowIso();
    state.lastError = error.message;
    state.consecutiveFailures += 1;
    logger.error("Invoice sync cycle failed", { trigger, error: error.message });
    return null;
  }
};

const startInvoiceSyncPoller = () => {
  state.enabled = Boolean(env.INVOICE_SYNC_ENABLED);
  if (!state.enabled) {
    state.active = false;
    logger.info("Invoice sync poller disabled", { envFlag: "INVOICE_SYNC_ENABLED=false" });
    return;
  }
  if (invoiceSyncTimer) return;

  const intervalMs = Math.max(30, Number(env.INVOICE_SYNC_INTERVAL_SECONDS || 300)) * 1000;
  state.intervalSeconds = intervalMs / 1000;
  state.batchSize = Number(env.INVOICE_SYNC_BATCH_SIZE || 100);
  invoiceSyncTimer = setInterval(() => { runInvoiceSyncCycle("interval"); }, intervalMs);
  state.active = true;
  if (typeof invoiceSyncTimer.unref === "function") invoiceSyncTimer.unref();

  const bootTimer = setTimeout(() => { runInvoiceSyncCycle("startup"); }, 15 * 1000);
  if (typeof bootTimer.unref === "function") bootTimer.unref();
  logger.info("Invoice sync poller started", { intervalSeconds: state.intervalSeconds, batchSize: state.batchSize });
};

const stopInvoiceSyncPoller = () => {
  if (!invoiceSyncTimer) return;
  clearInterval(invoiceSyncTimer);
  invoiceSyncTimer = null;
  state.active = false;
  logger.info("Invoice sync poller stopped");
};

const getInvoiceSyncWorkerStatus = () => ({
  ...state,
  active: Boolean(invoiceSyncTimer),
  status: !state.enabled ? "disabled" : invoiceSyncTimer ? state.consecutiveFailures ? "degraded" : "running" : "stopped"
});

module.exports = {
  getInvoiceSyncWorkerStatus,
  runInvoiceSyncCycle,
  startInvoiceSyncPoller,
  stopInvoiceSyncPoller
};