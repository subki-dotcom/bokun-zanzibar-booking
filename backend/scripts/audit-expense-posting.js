require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const BusinessExpense = require("../src/models/BusinessExpense");
const expenseAccounting = require("../src/services/expenseAccounting");

const hasArg = (name) => process.argv.includes(name);
const argValue = (name, fallback = "") => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
};

const run = async () => {
  const apply = hasArg("--apply");
  const mode = process.env.EXPENSE_POSTING_MODE || "PREVIEW_ONLY";
  if (apply && mode !== "CONTROLLED_HISTORICAL_BACKFILL") {
    throw new Error("Historical apply requires EXPENSE_POSTING_MODE=CONTROLLED_HISTORICAL_BACKFILL.");
  }
  await mongoose.connect(env.MONGO_URI, { autoIndex: false, autoCreate: false });
  const limit = Math.max(1, Math.min(50000, Number(argValue("--limit", "5000"))));
  const rows = [];
  const totals = {
    historicalExpensesDiscovered: 0,
    SAFE_TO_POST: 0,
    ALREADY_POSTED: 0,
    DRAFT_DO_NOT_POST: 0,
    POSTED_BY_BACKFILL: 0,
    BLOCKED: 0,
    NEEDS_MANUAL_REVIEW: 0,
    postingFailures: 0,
    duplicateExpensePostings: 0,
    unbalancedJournals: 0
  };
  const cursor = BusinessExpense.find({}).sort({ _id: 1 }).limit(limit).cursor({ batchSize: 100 });
  for await (const expense of cursor) {
    totals.historicalExpensesDiscovered += 1;
    const classification = await expenseAccounting.classifyHistoricalExpense({ expense });
    if (classification.classification === "SAFE_TO_POST") totals.SAFE_TO_POST += 1;
    if (classification.classification === "ALREADY_POSTED") totals.ALREADY_POSTED += 1;
    if (classification.classification === "DRAFT_DO_NOT_POST") totals.DRAFT_DO_NOT_POST += 1;
    if (classification.classification !== "SAFE_TO_POST" && classification.classification !== "ALREADY_POSTED") totals.BLOCKED += 1;
    if (["MISSING_MAPPING", "NEEDS_MANUAL_REVIEW", "FX_REVIEW"].includes(classification.classification) || classification.blockers?.length) totals.NEEDS_MANUAL_REVIEW += 1;

    const row = {
      expenseId: String(expense._id),
      expenseReference: expense.expenseReference,
      accountingScope: expense.accountingScope,
      status: expense.status,
      amount: expense.amount?.toString?.() || String(expense.amount || ""),
      classification: classification.classification,
      blockers: classification.blockers || [],
      postingKey: classification.postingKey
    };
    if (apply && classification.classification === "SAFE_TO_POST") {
      try {
        const result = await expenseAccounting.postExpense({ expense, mode });
        row.applyAction = result.action;
        if (["posted", "existing"].includes(result.action)) totals.POSTED_BY_BACKFILL += 1;
      } catch (error) {
        totals.postingFailures += 1;
        row.applyError = error.message;
      }
    }
    rows.push(row);
  }
  const report = {
    readOnly: !apply,
    dryRun: !apply,
    mode,
    generatedAt: new Date().toISOString(),
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