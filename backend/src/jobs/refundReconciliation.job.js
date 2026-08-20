const { env } = require("../config/env");
const logger = require("../config/logger");
const refundsService = require("../services/refunds");

let refundTimer = null;
const configuredSeconds = () => {
  const seconds = Number(env.REFUND_RECONCILIATION_INTERVAL_SECONDS || 0);
  const minutes = Number(env.REFUND_RECONCILIATION_INTERVAL_MINUTES || 10);
  return Math.max(60, seconds > 0 ? seconds : minutes * 60);
};
const state = {
  name: "refund_reconciliation",
  enabled: Boolean(env.REFUND_RECONCILIATION_ENABLED),
  running: false,
  active: false,
  intervalSeconds: configuredSeconds(),
  batchSize: Number(env.REFUND_RECONCILIATION_BATCH_SIZE || 20),
  lastRunAt: "",
  lastSuccessAt: "",
  lastFailureAt: "",
  lastError: "",
  consecutiveFailures: 0,
  lastSummary: null
};

const nowIso = () => new Date().toISOString();

const runRefundReconciliationCycle = async (trigger = "interval") => {
  state.running = true;
  state.lastRunAt = nowIso();
  try {
    const result = await refundsService.reconcilePendingRefunds({
      limit: Number(env.REFUND_RECONCILIATION_BATCH_SIZE || 20),
      minAgeMs: Math.max(60, Number(env.REFUND_RECONCILIATION_MIN_AGE_SECONDS || 300)) * 1000,
      maxRetries: Number(env.REFUND_RECONCILIATION_MAX_RETRIES || 8),
      requestId: `refund_reconcile_${Date.now()}`,
      source: "refund_reconciliation_job"
    });

    logger.info("Refund reconciliation cycle finished", {
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
    logger.error("Refund reconciliation cycle failed", {
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

const startRefundReconciliationPoller = () => {
  state.enabled = Boolean(env.REFUND_RECONCILIATION_ENABLED);
  if (!env.REFUND_RECONCILIATION_ENABLED) {
    state.active = false;
    logger.info("Refund reconciliation poller disabled", {
      envFlag: "REFUND_RECONCILIATION_ENABLED=false"
    });
    return;
  }

  if (refundTimer) return;

  const configuredSeconds = Number(env.REFUND_RECONCILIATION_INTERVAL_SECONDS || 0);
  const configuredMinutes = Number(env.REFUND_RECONCILIATION_INTERVAL_MINUTES || 10);
  const intervalSeconds = configuredSeconds > 0 ? configuredSeconds : configuredMinutes * 60;
  const intervalMs = Math.max(60, intervalSeconds) * 1000;
  state.intervalSeconds = intervalMs / 1000;
  state.batchSize = Number(env.REFUND_RECONCILIATION_BATCH_SIZE || 20);

  logger.info("Refund reconciliation poller started", {
    intervalSeconds: intervalMs / 1000,
    batchSize: Number(env.REFUND_RECONCILIATION_BATCH_SIZE || 20)
  });

  refundTimer = setInterval(() => {
    runRefundReconciliationCycle("interval");
  }, intervalMs);
  state.active = true;

  if (typeof refundTimer.unref === "function") {
    refundTimer.unref();
  }

  const bootTimer = setTimeout(() => {
    runRefundReconciliationCycle("startup");
  }, 15 * 1000);

  if (typeof bootTimer.unref === "function") {
    bootTimer.unref();
  }
};

const stopRefundReconciliationPoller = () => {
  if (!refundTimer) return;
  clearInterval(refundTimer);
  refundTimer = null;
  state.active = false;
  logger.info("Refund reconciliation poller stopped");
};

const getRefundReconciliationWorkerStatus = () => ({
  ...state,
  active: Boolean(refundTimer),
  status: !state.enabled ? "disabled" : refundTimer ? state.consecutiveFailures ? "degraded" : "running" : "stopped"
});

module.exports = {
  getRefundReconciliationWorkerStatus,
  runRefundReconciliationCycle,
  startRefundReconciliationPoller,
  stopRefundReconciliationPoller
};
