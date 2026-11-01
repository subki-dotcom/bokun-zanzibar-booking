// Frees space by deleting old Bókun sync run logs (the "synclogs" collection) only. Bookings, payments, invoices and
// audit logs are never touched. Without --apply it only counts what would be deleted.
// Usage (PowerShell):
//   $env:REPORT_MONGO_URI = "<Atlas connection string>"
//   node scripts/prune-sync-logs.js              # dry run: shows how many would go
//   node scripts/prune-sync-logs.js --apply      # deletes sync logs older than 7 days
//   node scripts/prune-sync-logs.js --days=14 --apply
const mongoose = require("mongoose");

const uri = process.env.REPORT_MONGO_URI || process.env.MONGO_URI;
if (!uri) {
  console.error("Set REPORT_MONGO_URI to the Atlas connection string first.");
  process.exit(1);
}
const apply = process.argv.includes("--apply");
const days = Math.max(1, Number((process.argv.find((arg) => arg.startsWith("--days=")) || "--days=7").split("=")[1]) || 7);
const BATCH = 5000;

(async () => {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  const logs = mongoose.connection.db.collection("synclogs");
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const filter = { createdAt: { $lt: cutoff } };
  const total = await logs.countDocuments({});
  const old = await logs.countDocuments(filter);
  console.log(`synclogs: ${total} in total, ${old} older than ${days} days (before ${cutoff.toISOString().slice(0, 10)}).`);
  if (!apply) {
    console.log("Dry run: nothing deleted. Add --apply to delete them.");
  } else {
    // In batches, so a full cluster is not asked for one huge operation.
    let deleted = 0;
    for (;;) {
      const ids = (await logs.find(filter, { projection: { _id: 1 } }).limit(BATCH).toArray()).map((doc) => doc._id);
      if (!ids.length) break;
      deleted += (await logs.deleteMany({ _id: { $in: ids } })).deletedCount;
      console.log(`  deleted ${deleted} / ${old}`);
    }
    console.log(`Done: ${deleted} old sync logs deleted. Atlas may take a few minutes to show the freed space.`);
  }
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error("Prune failed:", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
