require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const Booking = require("../src/models/Booking");
const financialReporting = require("../src/services/financialReporting");

const valueAfter = (flag, fallback = "") => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
};

const planAction = (facts) => {
  if (!facts.evidence.invoice) return { action: "BLOCKED", reason: "MISSING_INVOICE" };
  if (facts.accounting.status !== "MISSING") return { action: "UNCHANGED", reason: "ACCOUNTING_LINK_PRESENT" };
  if (facts.revenue.classification === "OTA" && !facts.evidence.settlement) {
    return { action: "REVIEW_REQUIRED", reason: "AWAITING_SETTLEMENT_EVIDENCE" };
  }
  return {
    action: "WOULD_CREATE_REVIEW_PLAN",
    reason: "MISSING_ACCOUNTING_LINK",
    sourceReference: facts.booking.reference,
    idempotencyKey: `BUSINESS_ACCOUNTING:BOOKING_ACCOUNTING:${facts.booking.reference}:BOOKING_NET_CONTRIBUTION`,
    approvalRequired: true,
    applyMode: "EXPLICIT_POSTING_ENDPOINT",
    sourceIds: facts.trace,
    evidence: facts.evidence
  };
};

const run = async () => {
  if (process.argv.includes("--apply")) {
    throw new Error("This planner is dry-run only. No accounting backfill is applied automatically.");
  }
  await mongoose.connect(env.MONGO_URI, { autoIndex: false, autoCreate: false });
  const limit = Math.max(1, Math.min(50000, Number(valueAfter("--limit", "5000"))));
  const rows = [];
  const summary = {};
  const cursor = Booking.find({}).sort({ _id: 1 }).limit(limit).cursor({ batchSize: 100 });
  for await (const booking of cursor) {
    const facts = await financialReporting.loadBookingFinancialFacts(booking.bookingReference);
    if (!facts) continue;
    const plan = planAction(facts);
    summary[plan.action] = (summary[plan.action] || 0) + 1;
    if (plan.action !== "UNCHANGED") rows.push({ bookingReference: facts.booking.reference, ...plan });
  }
  const report = {
    readOnly: true,
    dryRun: true,
    strategy: "CLASSIFY_REVIEW_APPROVE_APPLY_VERIFY",
    generatedAt: new Date().toISOString(),
    scanned: Object.values(summary).reduce((total, value) => total + value, 0),
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