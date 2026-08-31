#!/usr/bin/env node
/*
  Reconciliation CLI for pending refunds.
  Usage: node scripts/reconcile-refunds.js
*/
const path = require('path');

// Ensure environment is loaded
require(path.join(__dirname, '..', 'src', 'config', 'env'));
const connectDB = require(path.join(__dirname, '..', 'src', 'config', 'db'));
const refundsService = require(path.join(__dirname, '..', 'src', 'services', 'refunds'));

const run = async () => {
  try {
    await connectDB();
    const limit = Number(process.env.REFUND_RECONCILIATION_BATCH_SIZE || 20);
    const minAgeMs = (Number(process.env.REFUND_RECONCILIATION_MIN_AGE_SECONDS || 300) || 300) * 1000;
    const maxRetries = Number(process.env.REFUND_RECONCILIATION_MAX_RETRIES || 8);
    console.log('Starting refund reconciliation', { limit, minAgeMs, maxRetries });
    const result = await refundsService.reconcilePendingRefunds({ limit, minAgeMs, maxRetries, requestId: `cli-reconcile-${Date.now()}`, source: 'cli_refund_reconciliation' });
    console.log('Reconciliation result:', JSON.stringify(result.summary || {}, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Reconciliation failed:', err && err.message ? err.message : err);
    process.exit(2);
  }
};

run();
