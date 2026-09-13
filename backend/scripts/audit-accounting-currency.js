require("dotenv").config();
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const JournalEntry = require("../src/models/JournalEntry");
const JournalEntryLine = require("../src/models/JournalEntryLine");
const AccountingPosting = require("../src/models/AccountingPosting");

const classify = (row) => {
  const issues = [];
  if (!row.currency) issues.push("MISSING_TRANSACTION_CURRENCY");
  if (!row.baseCurrency) issues.push("MISSING_BASE_CURRENCY");
  if (row.currency && row.baseCurrency && row.currency !== row.baseCurrency && !row.exchangeRate) issues.push("MISSING_FX_RATE");
  if (row.currency && row.baseCurrency && row.currency !== row.baseCurrency && !row.exchangeRateDate) issues.push("MISSING_FX_RATE_DATE");
  if (row.currency && row.baseCurrency && row.currency !== row.baseCurrency && !row.exchangeRateSource) issues.push("MISSING_FX_RATE_SOURCE");
  return issues;
};

async function main() {
  if (process.argv.includes("--apply")) throw new Error("This audit is read-only. Posted accounting records are never rewritten by this command.");
  await mongoose.connect(env.MONGO_URI, { autoIndex: false, autoCreate: false });
  const limitArg = process.argv.indexOf("--limit");
  const limit = Math.max(1, Math.min(5000, Number(limitArg >= 0 ? process.argv[limitArg + 1] : 1000)));
  const sources = [["JOURNAL", JournalEntry], ["JOURNAL_LINE", JournalEntryLine], ["ACCOUNTING_POSTING", AccountingPosting]];
  const totals = {}; const rows = []; const scannedByType = {};
  for (const [type, Model] of sources) {
    const records = await Model.find({}).sort({ _id: 1 }).limit(limit).lean();
    scannedByType[type] = records.length;
    for (const record of records) {
      const issues = classify(record);
      for (const issue of issues) totals[issue] = (totals[issue] || 0) + 1;
      if (issues.length) rows.push({ type, id: String(record._id), reference: record.entryNumber || record.postingKey || "", status: record.status || record.journalStatus || "", transactionCurrency: record.currency || null, baseCurrency: record.baseCurrency || null, exchangeRate: record.exchangeRate?.toString?.() || null, exchangeRateDate: record.exchangeRateDate || null, exchangeRateSource: record.exchangeRateSource || null, issues });
    }
  }
  console.log(JSON.stringify({ readOnly: true, generatedAt: new Date().toISOString(), configuredBaseCurrency: env.ACCOUNTING_BASE_CURRENCY, scannedByType, mismatchCount: rows.length, totals, rows }, null, 2));
  await mongoose.disconnect();
}
main().catch(async(error)=>{ console.error(error.message); await mongoose.disconnect(); process.exitCode=1; });
