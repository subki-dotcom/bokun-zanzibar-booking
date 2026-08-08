const { env } = require("../config/env");
const logger = require("../config/logger");
const refundsService = require("../services/refunds");

let refundTimer = null;

const runRefundReconciliationCycle = async (trigger = "interval") => {
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

    return result;
  } catch (error) {
    logger.error("Refund reconciliation cycle failed", {
      trigger,
      error: error.message
    });
    return null;
  }
};

const startRefundReconciliationPoller = () => {
  if (!env.REFUND_RECONCILIATION_ENABLED) {
    logger.info("Refund reconciliation poller disabled", {
      envFlag: "REFUND_RECONCILIATION_ENABLED=false"
    });
    return;
  }

  if (refundTimer) return;

  const intervalMs = Math.max(60, Number(env.REFUND_RECONCILIATION_INTERVAL_SECONDS || 300)) * 1000;

  logger.info("Refund reconciliation poller started", {
    intervalSeconds: intervalMs / 1000,
    batchSize: Number(env.REFUND_RECONCILIATION_BATCH_SIZE || 20)
  });

  refundTimer = setInterval(() => {
    runRefundReconciliationCycle("interval");
  }, intervalMs);

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
  logger.info("Refund reconciliation poller stopped");
};

module.exports = {
  runRefundReconciliationCycle,
  startRefundReconciliationPoller,
  stopRefundReconciliationPoller
};
