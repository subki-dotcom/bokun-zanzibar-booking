process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/unused-worker-test";
process.env.JWT_SECRET ||= "worker-test-only";
const test = require("node:test");
const assert = require("node:assert/strict");
const bookingsService = require("../src/services/bookings");
const worker = require("../src/jobs/invoiceSync.job");

test("invoice sync worker backfills missing invoices and prevents overlapping cycles", async () => {
  const original = bookingsService.syncMissingInvoices;
  let release;
  bookingsService.syncMissingInvoices = async () => {
    await new Promise((resolve) => { release = resolve; });
    return { scanned: 1, synced: 1, failed: 0, failures: [] };
  };
  try {
    const cycle = worker.runInvoiceSyncCycle("test");
    assert.equal((await worker.runInvoiceSyncCycle("overlap")).reason, "sync_already_running");
    release();
    assert.equal((await cycle).synced, 1);
    assert.equal(worker.getInvoiceSyncWorkerStatus().lastSummary.synced, 1);
  } finally {
    bookingsService.syncMissingInvoices = original;
  }
});