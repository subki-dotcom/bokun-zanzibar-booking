const BusinessExpense = require("../../models/BusinessExpense");
const AccountingMapping = require("../../models/AccountingMapping");
const ChartOfAccount = require("../../models/ChartOfAccount");
const JournalEntry = require("../../models/JournalEntry");
const JournalEntryLine = require("../../models/JournalEntryLine");
const ledger = require("../generalLedger/ledger");
const { ACCOUNTING_SCOPE, EXPENSE_CATEGORY, EXPENSE_POSTING_MODE } = require("../../accounting/constants");
const { configuredBaseCurrency } = require("../../accounting/currencyPolicy");

const EXPENSE_POSTING_STATE = Object.freeze({
  NOT_READY: "NOT_READY",
  READY_TO_POST: "READY_TO_POST",
  POSTING: "POSTING",
  POSTED: "POSTED",
  POSTING_BLOCKED: "POSTING_BLOCKED",
  NEEDS_REVIEW: "NEEDS_REVIEW",
  REVERSED: "REVERSED",
  FAILED_RETRYABLE: "FAILED_RETRYABLE"
});

const BUSINESS_CATEGORY_MAPPING = Object.freeze({
  [EXPENSE_CATEGORY.OFFICE_RENT]: "RENT_EXPENSE",
  [EXPENSE_CATEGORY.SALARIES]: "SALARY_EXPENSE",
  [EXPENSE_CATEGORY.MARKETING]: "MARKETING_EXPENSE",
  [EXPENSE_CATEGORY.ADVERTISING]: "MARKETING_EXPENSE",
  [EXPENSE_CATEGORY.SOFTWARE]: "SOFTWARE_EXPENSE",
  [EXPENSE_CATEGORY.BANK_CHARGES]: "PAYMENT_PROVIDER_FEE"
});

const normalize = (value) => String(value || "").trim().toUpperCase();
const idOf = (value) => String(value?._id || value?.id || value || "");
const postingKeyFor = (expense) => `expense-recognition:${idOf(expense)}:v1`;

const toPlain = (value) => value?.toObject ? value.toObject() : value || {};
const isApproved = (expense) => ["APPROVED", "PAID"].includes(normalize(expense.status));

const loadCompleteJournal = async (postingKey, attempts = 4) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const journal = await JournalEntry.findOne({ "source.postingKey": postingKey }).lean();
    if (!journal) return null;
    const lines = await JournalEntryLine.find({ journalEntryId: journal._id }).lean();
    if (lines.length === Number(journal.lineCount || 0) && lines.length > 0) return { journal, lines };
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
  }
  return { journal: await JournalEntry.findOne({ "source.postingKey": postingKey }).lean(), lines: [] };
};

const findMapping = async (mappingKey) => {
  const mapping = await AccountingMapping.findOne({ mappingKey, active: { $ne: false } }).lean();
  if (!mapping?.accountCode) return null;
  const account = await ChartOfAccount.findOne({ code: mapping.accountCode, active: { $ne: false } }).lean();
  return account ? { mappingKey, accountCode: mapping.accountCode } : null;
};

const evaluateExpensePostingEligibility = async ({ expense } = {}) => {
  const row = toPlain(expense);
  const blockers = [];
  const scope = normalize(row.accountingScope);
  const category = normalize(row.category);
  const baseCurrency = normalize(row.baseCurrency || configuredBaseCurrency());
  const currency = normalize(row.currency);
  const debitMappingKey = scope === ACCOUNTING_SCOPE.BOOKING
    ? "SUPPLIER_DIRECT_COST"
    : BUSINESS_CATEGORY_MAPPING[category];

  if (!row._id && !row.id) blockers.push("IDENTITY_CONFLICT");
  if (!isApproved(row)) blockers.push("DRAFT_DO_NOT_POST");
  if (normalize(row.status) === "VOID") blockers.push("VOID_EXPENSE");
  if (!scope || ![ACCOUNTING_SCOPE.BUSINESS, ACCOUNTING_SCOPE.BOOKING].includes(scope)) blockers.push("INVALID_ACCOUNTING_SCOPE");
  if (!row.expenseReference) blockers.push("MISSING_EXPENSE_REFERENCE");
  if (!row.amount || !row.baseCurrencyAmount) blockers.push("MISSING_AMOUNT");
  if (currency !== baseCurrency && (!row.exchangeRate || !row.exchangeRateSource)) blockers.push("FX_REVIEW");
  if (["PAID", "PARTIALLY_PAID"].includes(normalize(row.paymentStatus)) && (!row.paymentReference || !row.paymentMethod)) blockers.push("MISSING_PAYMENT_EVIDENCE");
  if (!debitMappingKey) blockers.push("MISSING_MAPPING");

  const [debitMapping, payableMapping] = await Promise.all([
    debitMappingKey ? findMapping(debitMappingKey) : null,
    findMapping("ACCOUNTS_PAYABLE")
  ]);
  if (debitMappingKey && !debitMapping) blockers.push("MISSING_MAPPING");
  if (!payableMapping) blockers.push("MISSING_MAPPING");

  const uniqueBlockers = [...new Set(blockers)];
  const status = uniqueBlockers.length
    ? (uniqueBlockers.includes("DRAFT_DO_NOT_POST") ? EXPENSE_POSTING_STATE.POSTING_BLOCKED : EXPENSE_POSTING_STATE.NEEDS_REVIEW)
    : EXPENSE_POSTING_STATE.READY_TO_POST;
  return {
    eligible: uniqueBlockers.length === 0,
    status,
    blockers: uniqueBlockers,
    postingKey: postingKeyFor(row),
    debitMappingKey,
    creditMappingKey: "ACCOUNTS_PAYABLE"
  };
};

const previewExpensePosting = async ({ expense } = {}) => ({
  expense: toPlain(expense),
  eligibility: await evaluateExpensePostingEligibility({ expense })
});

const postExpense = async ({ expense, auth = {}, requestId = "", mode = process.env.EXPENSE_POSTING_MODE || EXPENSE_POSTING_MODE.PREVIEW_ONLY } = {}) => {
  const row = toPlain(expense);
  const preview = await previewExpensePosting({ expense: row });
  if (!preview.eligibility.eligible) {
    await BusinessExpense.updateOne({ _id: row._id }, {
      $set: { accountingStatus: preview.eligibility.status, canonicalPostingKey: preview.eligibility.postingKey, accountingBlockers: preview.eligibility.blockers },
      $unset: { accountingFailure: "" }
    });
    return { action: "blocked", ...preview };
  }
  if (mode === EXPENSE_POSTING_MODE.PREVIEW_ONLY) return { action: "preview", ...preview };

  const existingResult = await loadCompleteJournal(preview.eligibility.postingKey);
  if (existingResult?.journal) {
    const { journal: existing, lines } = existingResult;
    if (!lines.length || lines.length !== Number(existing.lineCount || 0)) {
      await BusinessExpense.updateOne({ _id: row._id }, { $set: { accountingStatus: EXPENSE_POSTING_STATE.NEEDS_REVIEW, accountingBlockers: ["INCOMPLETE_JOURNAL"] } });
      return { action: "blocked", reason: "INCOMPLETE_JOURNAL", journal: existing };
    }
    await BusinessExpense.updateOne({ _id: row._id }, { $set: { accountingStatus: EXPENSE_POSTING_STATE.POSTED, canonicalPostingKey: preview.eligibility.postingKey, journalEntryId: existing._id, accountingPostedAt: existing.postedAt || new Date(), accountingBlockers: [] } });
    return { action: "existing", journal: existing, eligibility: preview.eligibility };
  }

  await BusinessExpense.updateOne({ _id: row._id }, { $set: { accountingStatus: EXPENSE_POSTING_STATE.POSTING, canonicalPostingKey: preview.eligibility.postingKey, accountingLastAttemptAt: new Date(), accountingBlockers: [] } });
  try {
    const result = await ledger.postBusinessExpense({ expense: row, auth, requestId });
    const journalId = result?.journal?._id || result?.journal?.id || result?.id || null;
    await BusinessExpense.updateOne({ _id: row._id }, { $set: { accountingStatus: EXPENSE_POSTING_STATE.POSTED, journalEntryId: journalId, accountingPostedAt: new Date(), accountingBlockers: [], accountingFailure: "" } });
    return { action: result?.action || "posted", journal: result?.journal || result, eligibility: preview.eligibility };
  } catch (error) {
    const duplicate = error?.code === 11000;
    if (duplicate) {
      const retry = await JournalEntry.findOne({ "source.postingKey": preview.eligibility.postingKey }).lean();
      if (retry) return postExpense({ expense: row, auth, requestId, mode });
    }
    await BusinessExpense.updateOne({ _id: row._id }, { $set: { accountingStatus: EXPENSE_POSTING_STATE.FAILED_RETRYABLE, accountingFailure: error.message || "Expense posting failed", accountingLastAttemptAt: new Date() } });
    throw error;
  }
};

const classifyHistoricalExpense = async ({ expense } = {}) => {
  const row = toPlain(expense);
  const existing = await JournalEntry.findOne({ "source.postingKey": postingKeyFor(row) }).lean();
  if (existing) return { classification: "ALREADY_POSTED", postingKey: postingKeyFor(row), journalId: existing._id };
  const preview = await previewExpensePosting({ expense: row });
  const classification = preview.eligibility.eligible ? "SAFE_TO_POST" : preview.eligibility.blockers.includes("DRAFT_DO_NOT_POST") ? "DRAFT_DO_NOT_POST" : preview.eligibility.blockers.includes("MISSING_MAPPING") ? "MISSING_MAPPING" : "NEEDS_MANUAL_REVIEW";
  return { classification, ...preview.eligibility };
};

module.exports = {
  BUSINESS_CATEGORY_MAPPING,
  EXPENSE_POSTING_STATE,
  classifyHistoricalExpense,
  evaluateExpensePostingEligibility,
  postExpense,
  previewExpensePosting
};