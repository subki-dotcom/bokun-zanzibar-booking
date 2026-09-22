require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const AccountingPosting = require("../src/models/AccountingPosting");
const financialReporting = require("../src/services/financialReporting");

const valueAfter = (flag, fallback = "") => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
};

const run = async () => {
  const sourcePath = valueAfter("--report", "");
  if (!sourcePath) throw new Error("A --report JSON file is required.");
  const reportPath = path.resolve(process.cwd(), sourcePath);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const rows = report.results || report.rows || [];
  await mongoose.connect(env.MONGO_URI, { autoIndex: false, autoCreate: false });

  const checks = [];
  for (const row of rows) {
    const reference = row.bookingReference || row.sourceReference;
    if (!reference) continue;
    const facts = await financialReporting.loadBookingFinancialFacts(reference);
    const key = row.idempotencyKey || `BUSINESS_ACCOUNTING:BOOKING_ACCOUNTING:${reference}:BOOKING_NET_CONTRIBUTION`;
    const postings = await AccountingPosting.find({ postingKey: key }).lean();
    const duplicateCount = postings.length;
    const posting = postings[0] || null;
    checks.push({
      bookingReference: reference,
      idempotencyKey: key,
      postingCount: duplicateCount,
      duplicate: duplicateCount > 1,
      sourceMatches: posting ? posting.sourceReference === reference : null,
      factsLoaded: Boolean(facts),
      accountingLinked: facts?.accounting?.status === "LINKED"
    });
  }

  const reportOut = {
    readOnly: true,
    verifiedAt: new Date().toISOString(),
    sourceReport: reportPath,
    checked: checks.length,
    duplicates: checks.filter((check) => check.duplicate).length,
    missingPostings: checks.filter((check) => check.postingCount === 0).length,
    sourceMismatches: checks.filter((check) => check.sourceMatches === false).length,
    unlinkedFacts: checks.filter((check) => !check.accountingLinked).length,
    checks
  };
  const output = valueAfter("--output", "");
  if (output) {
    const outputPath = path.resolve(process.cwd(), output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(reportOut, null, 2));
    reportOut.output = outputPath;
  }
  console.log(JSON.stringify(reportOut, null, 2));
};

run()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState) await mongoose.disconnect();
  });
