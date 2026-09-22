require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const businessAccountingService = require("../src/services/businessAccounting");

const valueAfter = (flag, fallback = "") => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
};

const hasFlag = (flag) => process.argv.includes(flag);

const run = async () => {
  const reviewPath = valueAfter("--review", "");
  if (!reviewPath) throw new Error("A --review JSON file is required.");

  const inputPath = path.resolve(process.cwd(), reviewPath);
  const review = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (review.readOnly !== true || review.dryRun !== true) {
    throw new Error("The review file must be a read-only dry-run backfill plan.");
  }

  const applying = hasFlag("--apply");
  const approvalId = valueAfter("--approval-id", "");
  if (applying && !approvalId) {
    throw new Error("--approval-id is required with --apply.");
  }
  if (applying && !hasFlag("--confirm")) {
    throw new Error("--confirm is required with --apply. No records were changed.");
  }

  await mongoose.connect(env.MONGO_URI, { autoIndex: false, autoCreate: false });
  const limit = Math.max(1, Math.min(50000, Number(valueAfter("--limit", String(review.rows?.length || 0)))));
  const candidates = (review.rows || [])
    .filter((row) => row.action === "WOULD_CREATE_REVIEW_PLAN")
    .slice(0, limit);
  const results = [];

  for (const candidate of candidates) {
    const result = await businessAccountingService.postBookingContribution({
      bookingReference: candidate.bookingReference || candidate.sourceReference,
      dryRun: !applying,
      approvalId,
      idempotencyKey: candidate.idempotencyKey,
      auth: { id: `review:${approvalId || "dry-run"}`, role: "admin" },
      reason: `Reviewed business accounting backfill ${approvalId || "dry-run"}`
    });
    results.push({
      bookingReference: candidate.bookingReference || candidate.sourceReference,
      idempotencyKey: candidate.idempotencyKey,
      action: result.action,
      dryRun: Boolean(result.dryRun),
      approvalId: applying ? approvalId : null
    });
  }

  const report = {
    readOnly: !applying,
    dryRun: !applying,
    applied: applying,
    approvalRequired: true,
    approvalId: applying ? approvalId : null,
    sourceReview: inputPath,
    processed: results.length,
    writes: applying ? results.filter((row) => ["created", "updated"].includes(row.action)).length : 0,
    results
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
