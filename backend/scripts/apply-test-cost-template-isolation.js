require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const ProductCostTemplate = require("../src/models/ProductCostTemplate");

const EXPECTED_DATABASE = "bokun_zanzibar_booking";

const valueAfter = (flag, fallback = "") => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
};

const hasFlag = (flag) => process.argv.includes(flag);

const run = async () => {
  const reviewPath = valueAfter("--review", "");
  const approvalId = valueAfter("--approval-id", "");
  if (!reviewPath) throw new Error("--review is required.");
  if (!approvalId) throw new Error("--approval-id is required.");
  if (!hasFlag("--confirm")) throw new Error("--confirm is required. No records were changed.");

  const inputPath = path.resolve(process.cwd(), reviewPath);
  const review = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (review.readOnly !== true || review.dryRun !== true) throw new Error("Review file must be a read-only dry-run isolation plan.");
  if (review.databaseName !== EXPECTED_DATABASE) throw new Error(`Review database must be ${EXPECTED_DATABASE}.`);
  if (!Array.isArray(review.rows)) throw new Error("Review file rows are missing.");

  await mongoose.connect(env.MONGO_URI, { autoIndex: false, autoCreate: false });
  const databaseName = mongoose.connection.db.databaseName;
  if (databaseName !== EXPECTED_DATABASE) throw new Error(`Unexpected database name: ${databaseName}`);

  const results = [];
  for (const candidate of review.rows) {
    const updated = await ProductCostTemplate.findOneAndUpdate(
      { _id: candidate.templateId, status: "active" },
      { $set: { status: "inactive" } },
      { new: true, projection: { _id: 1, status: 1 } }
    ).lean();
    results.push({
      templateId: candidate.templateId,
      action: updated ? "DEACTIVATED" : "SKIPPED_NOT_ACTIVE_OR_MISSING",
      status: updated?.status || null
    });
  }

  const report = {
    readOnly: false,
    dryRun: false,
    applied: true,
    databaseName,
    approvalId,
    sourceReview: inputPath,
    processed: results.length,
    deactivated: results.filter((row) => row.action === "DEACTIVATED").length,
    skipped: results.filter((row) => row.action !== "DEACTIVATED").length,
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
