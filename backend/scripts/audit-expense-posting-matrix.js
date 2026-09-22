require("dotenv").config({ override: true });
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const BusinessExpense = require("../src/models/BusinessExpense");
const AccountingMapping = require("../src/models/AccountingMapping");
const ChartOfAccount = require("../src/models/ChartOfAccount");
const JournalEntry = require("../src/models/JournalEntry");
const JournalEntryLine = require("../src/models/JournalEntryLine");
const AccountingPosting = require("../src/models/AccountingPosting");
const expenseAccounting = require("../src/services/expenseAccounting");
const bookingAccounting = require("../src/services/bookingAccounting");

const targetReference = "BEXP-1789754639025-IEZKWS";
const targetBookingReference = "1448421203";
const mappingFor = async (mappingKey) => {
  if (!mappingKey) return null;
  const mapping = await AccountingMapping.findOne({ mappingKey }).lean();
  const account = mapping ? await ChartOfAccount.findOne({ code: mapping.accountCode }).lean() : null;
  return {
    mappingKey,
    accountCode: mapping?.accountCode || null,
    accountName: account?.name || null,
    mappingActive: mapping?.active === true,
    active: account?.active === true,
    verified: Boolean(mapping?.active === true && account?.active === true)
  };
};

const run = async () => {
  await mongoose.connect(env.MONGO_URI, { autoIndex: false, autoCreate: false });
  const database = mongoose.connection.db.databaseName;
  if (!database.toLowerCase().includes("bokun")) throw new Error(`Refusing audit against unexpected database: ${database}`);
  const expenses = await BusinessExpense.find({}).lean();
  const categories = [...new Set(expenses.map((row) => row.category).filter(Boolean))].sort();
  const categoryMatrix = [];
  for (const category of categories) {
    const representative = expenses.find((row) => row.category === category);
    const mappingKey = representative.accountingScope === "BOOKING_ACCOUNTING"
      ? "SUPPLIER_DIRECT_COST"
      : expenseAccounting.BUSINESS_CATEGORY_MAPPING[category] || null;
    const mapping = await mappingFor(mappingKey);
    categoryMatrix.push({ category, mappingKey, ...mapping, eligibleForAutomaticPosting: Boolean(mapping?.verified), blocker: mapping?.verified ? "" : "MAPPING_MISSING_OR_INACTIVE" });
  }
  const apMapping = await mappingFor("ACCOUNTS_PAYABLE");
  const apAccount = apMapping?.accountCode ? await ChartOfAccount.findOne({ code: apMapping.accountCode }).lean() : null;
  const target = expenses.filter((row) => row.expenseReference === targetReference);
  const targetRows = [];
  for (const expense of target) {
    const postingKey = `expense-recognition:${expense._id}:v1`;
    const journals = await JournalEntry.find({ "source.postingKey": postingKey }).lean();
    const journalDetails = [];
    for (const journal of journals) {
      const lines = await JournalEntryLine.find({ journalEntryId: journal._id }).lean();
      journalDetails.push({
        id: journal._id,
        status: journal.status,
        lineCount: journal.lineCount,
        storedLines: lines.length,
        debit: lines.reduce((sum, line) => sum + Number(line.baseCurrencyDebit || 0), 0),
        credit: lines.reduce((sum, line) => sum + Number(line.baseCurrencyCredit || 0), 0),
        lines: lines.map((line) => ({ accountCode: line.accountCode, accountName: line.accountName, debit: String(line.baseCurrencyDebit), credit: String(line.baseCurrencyCredit) }))
      });
    }
    targetRows.push({
      expenseId: expense._id,
      businessExpenseCount: 1,
      status: expense.status,
      accountingStatus: expense.accountingStatus,
      canonicalPostingKey: postingKey,
      canonicalJournalCount: journals.length,
      journals: journalDetails,
      accountingPostingCount: await AccountingPosting.countDocuments({ sourceRecordId: String(expense._id) })
    });
  }
  const profitability = await bookingAccounting.getProfitability({ bookingReference: targetBookingReference });
  const profitabilityItems = profitability.items || profitability.rows || [];
  const profitabilityMatch = profitabilityItems.find((row) => String(row.bookingReference) === targetBookingReference);
  const report = {
    readOnly: true,
    generatedAt: new Date().toISOString(),
    database,
    categoryMatrix,
    ap: {
      accountExists: Boolean(apAccount),
      accountActive: apAccount?.active === true,
      mappingActive: apMapping?.mappingActive === true,
      correctLiabilityAccount: apAccount?.code === "2010" && ["LIABILITY", "CURRENT_LIABILITY"].includes(apAccount?.type || "") || apAccount?.code === "2010" && apAccount?.subtype === "ACCOUNTS_PAYABLE",
      AP_MAPPING_VERIFIED: Boolean(apAccount?.code === "2010" && apAccount?.active === true && apMapping?.mappingActive === true)
    },
    targetRows,
    profitability: profitabilityMatch || null,
    duplicateExpenseRecognitionJournals: Math.max(0, targetRows.reduce((sum, row) => sum + Math.max(0, row.canonicalJournalCount - 1), 0)),
    unbalancedCompletedJournals: targetRows.flatMap((row) => row.journals).filter((journal) => journal.status === "POSTED" && Math.abs(journal.debit - journal.credit) > 0.005).length
  };
  const output = process.argv[process.argv.indexOf("--output") + 1];
  if (output) {
    const outputPath = path.resolve(process.cwd(), output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    report.output = outputPath;
  }
  console.log(JSON.stringify(report, null, 2));
};

run().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(async () => {
  if (mongoose.connection.readyState) await mongoose.disconnect();
});