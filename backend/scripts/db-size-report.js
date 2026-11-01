// Read-only: lists every collection with its document count, data size, storage size and index size, biggest first,
// then what fills the two log collections (auditlogs by action, synclogs by operation).
// Usage (PowerShell):  $env:REPORT_MONGO_URI = "<Atlas connection string>"; node scripts/db-size-report.js
// It never writes or deletes anything. The connection string is read from the environment only.
const mongoose = require("mongoose");

const uri = process.env.REPORT_MONGO_URI || process.env.MONGO_URI;
if (!uri) {
  console.error("Set REPORT_MONGO_URI to the Atlas connection string first.");
  process.exit(1);
}

const mb = (bytes = 0) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "-");
const QUERY_MS = 120000;

const sizes = async (db) => {
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  console.log(`Reading the size of ${collections.length} collections...`);
  const rows = [];
  for (const { name } of collections) {
    try {
      const s = await db.command({ collStats: name });
      rows.push({ name, count: s.count || 0, size: s.size || 0, storage: s.storageSize || 0, indexes: s.totalIndexSize || 0 });
    } catch (error) {
      const count = await db.collection(name).estimatedDocumentCount().catch(() => 0);
      rows.push({ name, count, size: 0, storage: 0, indexes: 0, error: error.message });
    }
  }
  rows.sort((a, b) => b.size + b.indexes - (a.size + a.indexes));
  const total = rows.reduce((sum, r) => sum + r.size + r.indexes, 0);
  console.log(`\nDatabase: ${db.databaseName}   data + indexes: ${mb(total)}\n`);
  console.log("collection".padEnd(34), "documents".padStart(10), "data".padStart(10), "on disk".padStart(10), "indexes".padStart(10));
  for (const r of rows.slice(0, 15)) {
    console.log(r.name.padEnd(34), String(r.count).padStart(10), mb(r.size).padStart(10), mb(r.storage).padStart(10), mb(r.indexes).padStart(10), r.error ? `  (${r.error})` : "");
  }
};

// Kind, count, size, oldest and newest entry of one log collection.
const breakdown = async (db, collection, field) => {
  console.log(`\n${collection} by ${field} (this can take a minute)...`);
  const rows = await db.collection(collection).aggregate([
    { $group: { _id: `$${field}`, count: { $sum: 1 }, bytes: { $sum: { $bsonSize: "$$ROOT" } }, oldest: { $min: "$createdAt" }, newest: { $max: "$createdAt" } } },
    { $sort: { bytes: -1 } },
    { $limit: 15 }
  ], { allowDiskUse: true, maxTimeMS: QUERY_MS }).toArray();
  for (const row of rows) {
    console.log(" ", String(row._id).padEnd(46), String(row.count).padStart(8), mb(row.bytes).padStart(10), ` ${day(row.oldest)} -> ${day(row.newest)}`);
  }
};

(async () => {
  console.log("Connecting to the database...");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000, socketTimeoutMS: QUERY_MS + 30000 });
  const db = mongoose.connection.db;
  console.log("Connected.");
  await sizes(db).catch((error) => console.log(`Collection sizes failed: ${error.message}`));
  await breakdown(db, "auditlogs", "action").catch((error) => console.log(`  auditlogs breakdown failed: ${error.message}`));
  await breakdown(db, "synclogs", "operation").catch((error) => console.log(`  synclogs breakdown failed: ${error.message}`));
  console.log("\nDone.");
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error("Report failed:", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
