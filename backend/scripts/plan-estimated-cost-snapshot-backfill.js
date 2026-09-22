require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const Booking = require("../src/models/Booking");
const ProductCostTemplate = require("../src/models/ProductCostTemplate");
const bookingAccountingService = require("../src/services/bookingAccounting");

const valueAfter = (flag, fallback = "") => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
};

const run = async () => {
  if (process.argv.includes("--apply")) {
    throw new Error("This planner is dry-run only. No booking snapshots are written automatically.");
  }

  await mongoose.connect(env.MONGO_URI, { autoIndex: false, autoCreate: false });
  const limit = Math.max(1, Math.min(50000, Number(valueAfter("--limit", "5000"))));
  const rows = [];
  const summary = {};
  const templateCandidatesByKey = new Map();
  const cursor = Booking.find({
    $or: [{ estimatedCostSnapshot: { $exists: false } }, { estimatedCostSnapshot: null }]
  })
    .sort({ _id: 1 })
    .limit(limit)
    .cursor({ batchSize: 100 });

  for await (const booking of cursor) {
    const templateKey = `${booking.bokunProductId || ""}::${booking.bokunOptionId || ""}`;
    if (!templateCandidatesByKey.has(templateKey)) {
      const candidates = await ProductCostTemplate.find({
        bokunProductId: booking.bokunProductId,
        bokunOptionId: booking.bokunOptionId
      })
        .select("_id status validFrom validTo updatedAt currency")
        .sort({ updatedAt: -1 })
        .lean();
      templateCandidatesByKey.set(templateKey, candidates.map((candidate) => ({
        templateId: String(candidate._id),
        status: candidate.status || "",
        validFrom: candidate.validFrom || null,
        validTo: candidate.validTo || null,
        updatedAt: candidate.updatedAt || null,
        currency: candidate.currency || ""
      })));
    }
    const snapshot = await bookingAccountingService.captureEstimatedCostSnapshot({
      booking: booking.toObject(),
      asOfDate: booking.createdAt || booking.issueDate || new Date()
    });
    const templateCandidates = templateCandidatesByKey.get(templateKey) || [];
    const action = snapshot
      ? "WOULD_CAPTURE"
      : templateCandidates.length
        ? "BLOCKED_TEMPLATE_NOT_EFFECTIVE"
        : "BLOCKED_MISSING_COST_TEMPLATE";
    summary[action] = (summary[action] || 0) + 1;
    rows.push({
      bookingId: String(booking._id),
      bookingReference: booking.bookingReference || "",
      bokunProductId: booking.bokunProductId || "",
      bokunOptionId: booking.bokunOptionId || "",
      action,
      reason: snapshot
        ? "MISSING_ESTIMATED_COST_SNAPSHOT"
        : templateCandidates.length
          ? "NO_TEMPLATE_EFFECTIVE_AT_BOOKING_DATE"
          : "NO_COST_TEMPLATE_FOR_BOOKING_OPTION",
      templateCandidates,
      snapshot
    });
  }

  const report = {
    readOnly: true,
    dryRun: true,
    strategy: "REVIEW_APPROVE_APPLY_VERIFY",
    generatedAt: new Date().toISOString(),
    scanned: rows.length,
    summary,
    writes: 0,
    rows
  };
  const output = valueAfter("--output", "");
  if (output) {
    const outputPath = path.resolve(process.cwd(), output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    report.output = outputPath;
  }
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
