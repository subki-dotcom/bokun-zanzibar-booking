require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const Booking = require("../src/models/Booking");

const valueAfter = (flag, fallback = "") => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
};

const run = async () => {
  const reviewPath = valueAfter("--review");
  const outputPath = valueAfter("--output");
  if (!reviewPath) throw new Error("--review is required");
  if (!outputPath) throw new Error("--output is required");

  const review = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), reviewPath), "utf8"));
  if (!review.readOnly || !review.dryRun || review.strategy !== "REVIEW_APPROVE_APPLY_VERIFY") {
    throw new Error("Review report is not a valid read-only snapshot planner report");
  }
  const rows = Array.isArray(review.rows) ? review.rows : [];
  if (rows.some((row) => !["WOULD_CAPTURE", "BLOCKED_TEMPLATE_NOT_EFFECTIVE", "BLOCKED_MISSING_COST_TEMPLATE"].includes(row.action))) {
    throw new Error("Review report contains an unknown snapshot action");
  }
  if ((review.summary?.BLOCKED_MISSING_COST_TEMPLATE || 0) > 0) {
    throw new Error("Review report contains bookings with no cost template; no snapshots were written");
  }

  const eligibleRows = rows.filter((row) => row.action === "WOULD_CAPTURE");

  await mongoose.connect(env.MONGO_URI, { autoIndex: false, autoCreate: false });
  if (mongoose.connection.db.databaseName !== "bokun_zanzibar_booking") {
    throw new Error(`Unexpected database name: ${mongoose.connection.db.databaseName}`);
  }

  const bookingsCollection = mongoose.connection.db.collection("bookings");
  const applied = [];
  for (const row of eligibleRows) {
    const result = await bookingsCollection.updateOne(
      {
        _id: row.bookingId,
        $or: [{ estimatedCostSnapshot: { $exists: false } }, { estimatedCostSnapshot: null }]
      },
      { $set: { estimatedCostSnapshot: row.snapshot } }
    );
    if (result.matchedCount !== 1 || result.modifiedCount !== 1) {
      throw new Error(`Snapshot guard failed for booking ${row.bookingReference || row.bookingId}`);
    }
    applied.push({ bookingId: row.bookingId, bookingReference: row.bookingReference || "" });
  }

  const report = {
    readOnly: false,
    applied: true,
    generatedAt: new Date().toISOString(),
    databaseName: mongoose.connection.db.databaseName,
    reviewedRows: rows.length,
    appliedRows: applied.length,
    applied
  };
  const resolvedOutput = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
};

run()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState) await mongoose.disconnect();
  });
