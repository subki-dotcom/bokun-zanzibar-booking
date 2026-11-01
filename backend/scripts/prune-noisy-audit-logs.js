// Frees space by deleting repeated, information-free audit entries written by the background jobs:
//  1. booking_finalization_reconciliation_run by the system where the run found and did nothing (every 30 seconds);
//  2. bokun_booking_cancelled_synchronized / booking_synced_from_bokun_polling repeats: for each booking and identical
//     change, the first and the last entry are kept, the copies in between are deleted.
// Every other audit entry (payments, bookings, invoices, people's actions) is never touched.
// Without --apply it only counts what would be deleted.
// Usage (PowerShell):
//   $env:REPORT_MONGO_URI = "<Atlas connection string>"
//   node scripts/prune-noisy-audit-logs.js           # dry run
//   node scripts/prune-noisy-audit-logs.js --apply   # delete
const mongoose = require("mongoose");

const uri = process.env.REPORT_MONGO_URI || process.env.MONGO_URI;
if (!uri) {
  console.error("Set REPORT_MONGO_URI to the Atlas connection string first.");
  process.exit(1);
}
const apply = process.argv.includes("--apply");
const BATCH = 5000;

const ZERO = { $in: [0, null] };
const EMPTY_RUN = {
  action: "booking_finalization_reconciliation_run",
  actorId: null,
  "metadata.force": { $ne: true },
  "metadata.summary.processed": ZERO,
  "metadata.summary.eligible": ZERO,
  "metadata.summary.confirmed": ZERO,
  "metadata.summary.failed": ZERO,
  "metadata.summary.manualReview": ZERO,
  "metadata.summary.duplicatesPrevented": ZERO
};

// What makes two entries "the same change" (the run's own timestamps left out).
const REPEAT_KEYS = {
  bokun_booking_cancelled_synchronized: {
    entityId: "$entityId",
    beforeStatus: "$before.bookingStatus",
    afterStatus: "$after.bookingStatus",
    beforeCancellation: "$before.cancellation",
    afterCancellation: "$after.cancellation",
    beforeRaw: "$before.bokunStatus.raw",
    afterRaw: "$after.bokunStatus.raw",
    afterNormalized: "$after.bokunStatus.normalized"
  },
  booking_synced_from_bokun_polling: { entityId: "$entityId", before: "$before", after: "$after" }
};

const deleteIds = async (logs, ids, label) => {
  let deleted = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    deleted += (await logs.deleteMany({ _id: { $in: ids.slice(i, i + BATCH) } })).deletedCount;
    console.log(`  ${label}: deleted ${deleted} / ${ids.length}`);
  }
  return deleted;
};

(async () => {
  console.log("Connecting to the database...");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000, socketTimeoutMS: 300000 });
  const logs = mongoose.connection.db.collection("auditlogs");
  console.log(`auditlogs: ${await logs.estimatedDocumentCount()} entries in total.\n`);

  // 1. Empty reconciliation runs.
  const emptyRuns = await logs.countDocuments(EMPTY_RUN);
  const allRuns = await logs.countDocuments({ action: "booking_finalization_reconciliation_run" });
  console.log(`Reconciliation runs: ${allRuns}, of which empty (found and did nothing): ${emptyRuns}`);
  if (apply && emptyRuns) {
    for (;;) {
      const ids = (await logs.find(EMPTY_RUN, { projection: { _id: 1 } }).limit(BATCH).toArray()).map((doc) => doc._id);
      if (!ids.length) break;
      await deleteIds(logs, ids, "empty runs");
    }
  }

  // 2. Repeated identical sync entries: keep the first and the last of each group.
  for (const [action, key] of Object.entries(REPEAT_KEYS)) {
    const groups = await logs.aggregate([
      { $match: { action } },
      { $sort: { createdAt: 1 } },
      { $group: { _id: key, ids: { $push: "$_id" } } },
      { $match: { "ids.2": { $exists: true } } },
      { $project: { middle: { $slice: ["$ids", 1, { $subtract: [{ $size: "$ids" }, 2] }] } } }
    ], { allowDiskUse: true }).toArray();
    const ids = groups.flatMap((group) => group.middle);
    const total = await logs.countDocuments({ action });
    console.log(`\n${action}: ${total} entries, ${ids.length} repeated copies (first and last of each change kept)`);
    if (apply && ids.length) await deleteIds(logs, ids, action);
  }

  console.log(apply ? "\nDone. Atlas may take a few minutes to show the freed space." : "\nDry run: nothing deleted. Add --apply to delete them.");
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error("Prune failed:", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
