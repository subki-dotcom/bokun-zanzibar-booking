process.env.MONGO_URI ||= 'mongodb://127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'isolated-test-secret';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRevenueRecognitionWorker } = require('../src/jobs/revenueRecognition.job');
const base = {
  REVENUE_RECOGNITION_AUTOMATIC_ENABLED: true,
  REVENUE_RECOGNITION_ACTIVATED_AT: '2026-09-21T10:00:00Z',
  REVENUE_RECOGNITION_ACTIVATION_SCOPE: 'NEW_COMPLETIONS',
};
const ready = { assess: async () => ({ ready: true }) };
test('worker cannot query history when disabled or boundary is unspecified', async () => {
  for (const config of [
    { ...base, REVENUE_RECOGNITION_AUTOMATIC_ENABLED: false },
    { ...base, REVENUE_RECOGNITION_ACTIVATED_AT: '' },
    { ...base, REVENUE_RECOGNITION_ACTIVATION_SCOPE: '' },
  ]) {
    const worker = createRevenueRecognitionWorker({
      config,
      CompletionModel: {
        find: () => {
          throw new Error('must not query');
        },
      },
      ReadinessService: ready,
    });
    assert.deepEqual(await worker.run(), { skipped: true });
  }
});
test('worker retries only new completed events and always calls the canonical gate', async () => {
  let query;
  const calls = [];
  const worker = createRevenueRecognitionWorker({
    config: base,
    CompletionModel: {
      find: (value) => {
        query = value;
        return { sort: () => ({ limit: () => ({ lean: async () => [{ _id: 'c1' }] }) }) };
      },
    },
    RevenueService: { post: async (value) => calls.push(value) },
    ReadinessService: ready,
  });
  assert.deepEqual(await worker.run(), { processed: 1, failed: 0 });
  assert.equal(query.status, 'COMPLETED');
  assert.equal(
    query.createdAt.$gt.toISOString(),
    base.REVENUE_RECOGNITION_ACTIVATED_AT.replace('Z', '.000Z')
  );
  assert.deepEqual(calls, [{ completionId: 'c1', origin: 'AUTOMATIC' }]);
});
test('worker fails closed when transaction or mapping readiness is unavailable', async () => {
  for (const readiness of [
    { transactionSupport: false, uniqueIndexes: true, accountMappings: true, activationBoundary: true },
    { transactionSupport: true, uniqueIndexes: true, accountMappings: false, activationBoundary: true },
  ]) {
    const worker = createRevenueRecognitionWorker({
      config: base,
      CompletionModel: { find: () => { throw new Error('must not query'); } },
      ReadinessService: { assess: async () => ({ ...readiness, ready: false }) },
    });
    assert.deepEqual(await worker.run(), { skipped: true, reason: 'READINESS_REQUIRED' });
  }
});
