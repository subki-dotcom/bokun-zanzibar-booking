require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const Booking = require("../src/models/Booking");
const financialReporting = require("../src/services/financialReporting");

const hasArg = (name) => process.argv.includes(name);
const argValue = (name, fallback = "") => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
};

const addIssue = (issues, code, details = {}) => issues.push({ code, ...details });

const classify = (facts) => {
  const issues = [];
  if (!facts.evidence.invoice) addIssue(issues, "MISSING_INVOICE", { reference: facts.booking.reference });
  if (!facts.evidence.guestPayment && facts.guestPayment.source !== "LOCAL_PAYMENT") {
    addIssue(issues, "MISSING_GUEST_PAYMENT_EVIDENCE", { reference: facts.booking.reference });
  }
  if (facts.booking.channel && facts.booking.channel !== "DIRECT_WEBSITE" && !facts.evidence.settlement) {
    addIssue(issues, "AWAITING_SETTLEMENT_EVIDENCE", { reference: facts.booking.reference });
  }
  if (facts.accounting.status === "MISSING") {
    addIssue(issues, "MISSING_ACCOUNTING_LINK", { reference: facts.booking.reference });
  }
  if (facts.trace.paymentIds.length !== new Set(facts.trace.paymentIds).size) {
    addIssue(issues, "DUPLICATE_PAYMENT_TRACE", { reference: facts.booking.reference });
  }
  if (facts.trace.refundIds.length !== new Set(facts.trace.refundIds).size) {
    addIssue(issues, "DUPLICATE_REFUND_TRACE", { reference: facts.booking.reference });
  }
  if (facts.trace.expenseIds.length !== new Set(facts.trace.expenseIds).size) {
    addIssue(issues, "DUPLICATE_EXPENSE_TRACE", { reference: facts.booking.reference });
  }
  return issues;
};

const run = async () => {
  if (hasArg("--apply")) {
    throw new Error("This command is read-only. It has no apply mode and never modifies financial records.");
  }
  await mongoose.connect(env.MONGO_URI, { autoIndex: false, autoCreate: false });
  const limit = Math.max(1, Math.min(50000, Number(argValue("--limit", "5000"))));
  const rows = [];
  const totals = {};
  let scanned = 0;
  const cursor = Booking.find({}).sort({ _id: 1 }).limit(limit).cursor({ batchSize: 100 });
  for await (const booking of cursor) {
    scanned += 1;
    const facts = await financialReporting.loadBookingFinancialFacts(booking.bookingReference);
    if (!facts) continue;
    const issues = classify(facts);
    issues.forEach((issue) => { totals[issue.code] = (totals[issue.code] || 0) + 1; });
    if (issues.length) rows.push({ bookingReference: facts.booking.reference, issues, trace: facts.trace, evidence: facts.evidence });
  }
  const report = {
    readOnly: true,
    dryRun: true,
    generatedAt: new Date().toISOString(),
    scanned,
    issueCount: rows.length,
    totals,
    rows
  };
  const output = argValue("--output", "");
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