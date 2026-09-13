process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/unused-worker-test';
process.env.JWT_SECRET ||= 'worker-test-only';
const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../src/services/bokunConfirmedBookings');
const worker = require('../src/jobs/bokunConfirmedBookingImport.job');

test('worker discovers newly created bookings separately from modifications and prevents overlapping cycles', async () => {
  const original = service.syncConfirmedBookings;
  const calls = [];
  let release;
  service.syncConfirmedBookings = async (options) => {
    calls.push(options);
    if (calls.length === 1) await new Promise(resolve => { release = resolve; });
    return { summary: { imported: calls.length === 1 ? 1 : 0, unchanged: calls.length === 1 ? 0 : 1 } };
  };
  try {
    const cycle = worker.runConfirmedBookingImportCycle('test');
    assert.equal((await worker.runConfirmedBookingImportCycle('overlap')).reason, 'sync_already_running');
    release();
    await cycle;
    assert.deepEqual(calls.map(call => call.dateRangeField), ['creationDateRange', 'lastModifiedDateRange']);
    assert.equal(calls[0].fromDate, calls[1].fromDate);
    assert.equal(calls[0].toDate, calls[1].toDate);
    assert.equal(worker.getBokunConfirmedBookingImportWorkerStatus().lastCreationSummary.imported, 1);
  } finally { service.syncConfirmedBookings = original; }
});
