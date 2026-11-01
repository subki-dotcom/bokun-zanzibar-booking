// Read-only: shows the newest "bokun_booking_cancelled_synchronized" audit entries (what changed, by which job), the
// current state of those bookings, and how many such entries were written in the last hour. No personal data.
// Usage (PowerShell):  $env:REPORT_MONGO_URI = "<Atlas connection string>"; node scripts/inspect-cancellation-audits.js
const mongoose = require("mongoose");

const uri = process.env.REPORT_MONGO_URI || process.env.MONGO_URI;
if (!uri) {
  console.error("Set REPORT_MONGO_URI to the Atlas connection string first.");
  process.exit(1);
}

const pick = (state = {}) => ({
  bookingStatus: state?.bookingStatus,
  cancellation: state?.cancellation
    ? { reason: state.cancellation.reason, cancelledAt: state.cancellation.cancelledAt, cancelledBy: state.cancellation.cancelledBy }
    : state?.cancellation,
  bokunStatus: state?.bokunStatus ? { raw: state.bokunStatus.raw, normalized: state.bokunStatus.normalized, sourceField: state.bokunStatus.sourceField } : state?.bokunStatus
});

(async () => {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  const db = mongoose.connection.db;
  const audits = db.collection("auditlogs");
  const action = "bokun_booking_cancelled_synchronized";
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  console.log(`${action} in the last hour: ${await audits.countDocuments({ action, createdAt: { $gte: hourAgo } })}`);
  const recentOther = await audits.aggregate([
    { $match: { createdAt: { $gte: hourAgo } } },
    { $group: { _id: "$action", count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray();
  console.log("All audit entries in the last hour:", recentOther.map((row) => `${row._id}=${row.count}`).join(", ") || "none");

  const latest = await audits.find({ action }).sort({ createdAt: -1 }).limit(4).toArray();
  for (const entry of latest) {
    const booking = await db.collection("bookings").findOne({ _id: new mongoose.Types.ObjectId(entry.entityId) },
      { projection: { bookingReference: 1, bookingStatus: 1, cancellation: 1, bokunStatus: 1, "bokunImport.lastSyncSource": 1, "syncState": 1 } }).catch(() => null);
    console.log(`\n--- ${entry.createdAt?.toISOString?.()} booking ${booking?.bookingReference || entry.entityId} source=${entry.metadata?.source}`);
    console.log("before:", JSON.stringify(pick(entry.before)));
    console.log("after: ", JSON.stringify(pick(entry.after)));
    console.log("now:   ", JSON.stringify(pick(booking)), "lastSyncSource:", booking?.bokunImport?.lastSyncSource, "syncState:", JSON.stringify(booking?.syncState || null));
  }

  // Which Bókun bookings the import maps to these references (one Bókun booking each, or two that fight?).
  const references = [...new Set((await Promise.all(latest.map((entry) =>
    db.collection("bookings").findOne({ _id: new mongoose.Types.ObjectId(entry.entityId) }, { projection: { bookingReference: 1 } }).catch(() => null)
  ))).map((booking) => booking?.bookingReference).filter(Boolean))];
  const runs = await db.collection("synclogs").find({ operation: "confirmed_booking_import", "details.results.bookingReference": { $in: references } })
    .sort({ createdAt: -1 }).limit(6).toArray();
  console.log(`\nLast import runs touching ${references.join(", ")}:`);
  for (const run of runs) {
    const rows = (run.details?.results || []).filter((row) => references.includes(row.bookingReference));
    for (const row of rows) {
      console.log(` ${run.createdAt?.toISOString?.()} ${row.bookingReference} action=${row.action} bokunBookingId=${row.bokunBookingId} bookingStatus=${row.bookingStatus || ""}`);
    }
  }
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error("Inspect failed:", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
