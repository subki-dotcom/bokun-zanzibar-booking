const { env } = require('../config/env');
const logger = require('../config/logger');
const ServiceCompletion = require('../models/ServiceCompletion');
const revenue = require('../services/revenueRecognition');
const { createRevenueReadinessService } = require('../services/revenueRecognition/readiness');

const createRevenueRecognitionWorker = ({
  config = env,
  CompletionModel = ServiceCompletion,
  RevenueService = revenue,
  ReadinessService = RevenueService.readiness || createRevenueReadinessService({ config }),
} = {}) => {
  let timer = null;
  let running = false;
  let cursor = null;
  const enabled = () =>
    config.REVENUE_RECOGNITION_AUTOMATIC_ENABLED === true &&
    Number.isFinite(Date.parse(config.REVENUE_RECOGNITION_ACTIVATED_AT)) &&
    config.REVENUE_RECOGNITION_ACTIVATION_SCOPE === 'NEW_COMPLETIONS';
  const run = async () => {
    if (!enabled() || running) return { skipped: true };
    if (!(await ReadinessService.assess()).ready) return { skipped: true, reason: 'READINESS_REQUIRED' };
    running = true;
    try {
      const boundary = new Date(config.REVENUE_RECOGNITION_ACTIVATED_AT);
      const query = {
        createdAt: { $gt: boundary },
        verifiedAt: { $gt: boundary },
        completedAt: { $gt: boundary },
        status: 'COMPLETED',
        ...(cursor ? { _id: { $gt: cursor } } : {}),
      };
      const rows = await CompletionModel.find(query).sort({ _id: 1 }).limit(25).lean();
      const counts = { processed: 0, failed: 0 };
      for (const row of rows) {
        try {
          await RevenueService.post({ completionId: row._id, origin: 'AUTOMATIC' });
          counts.processed += 1;
        } catch (error) {
          counts.failed += 1;
          logger.error('Revenue recognition retry blocked', {
            code: error.code || 'POSTING_FAILED',
          });
        }
      }
      cursor = rows.length === 25 ? rows[rows.length - 1]._id : null;
      return counts;
    } finally {
      running = false;
    }
  };
  const start = () => {
    if (!enabled() || timer) return;
    // No startup backfill. Each retry still enforces the exact activation boundary in the transaction.
    timer = setInterval(
      () =>
        run().catch((error) =>
          logger.error('Revenue worker failed', { code: error.code || 'WORKER_FAILED' })
        ),
      60000
    );
    timer.unref?.();
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  return { run, start, stop };
};
module.exports = { createRevenueRecognitionWorker, ...createRevenueRecognitionWorker() };
