const SupplierPayment = require("../../models/SupplierPayment");
const BusinessExpense = require("../../models/BusinessExpense");
const AccountingMapping = require("../../models/AccountingMapping");
const ChartOfAccount = require("../../models/ChartOfAccount");
const JournalEntry = require("../../models/JournalEntry");
const JournalEntryLine = require("../../models/JournalEntryLine");
const AuditLog = require("../../models/AuditLog");
const ledger = require("../generalLedger/ledger");
const { ACCOUNTING_SCOPE, GL_MAPPING_KEY, EXPENSE_POSTING_MODE, FINANCIAL_ENTRY_STATUS, EXPENSE_PAYMENT_STATUS } = require("../../accounting/constants");
const AppError = require("../../utils/AppError");

const SOURCE_KEYS = Object.freeze({ BANK: GL_MAPPING_KEY.BANK, CASH: GL_MAPPING_KEY.CASH, MOBILE_MONEY: GL_MAPPING_KEY.MOBILE_MONEY });
const SOURCE_ACCOUNT_TYPES = new Set(["ASSET"]);
const SOURCE_ACCOUNT_SUBTYPES = new Set(["CASH", "BANK", "MOBILE_MONEY"]);
const decimalNumber = (value) => Number(value?.toString?.() || value || 0);
const sanitizeAuditReason = (value) => String(value || "")
  .replace(/(access(?:[_-]|\s)?token|refresh(?:[_-]|\s)?token|provider(?:[_-]|\s)?token|authorization|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
  .replace(/\b\d{12,19}\b/g, (digits) => `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`)
  .slice(0, 500);

const recordSupplierPaymentAudit = async ({ AuditLogModel = AuditLog, action, payment, auth = {}, requestId = "", before = null, after = null, reason = "", metadata = {} }) => {
  if (!AuditLogModel?.create || !payment?._id) return null;
  if (AuditLogModel === AuditLog && AuditLogModel.db?.readyState !== 1) return null;
  try {
    return await AuditLogModel.create({
      actorId: auth?.id || null,
      actorRole: auth?.role || "system",
      action,
      entityType: "SupplierPayment",
      entityId: String(payment._id),
      reference: String(payment.paymentReference || ""),
      reason: sanitizeAuditReason(reason),
      requestId,
      before,
      after,
      metadata: {
        amount: payment.amount,
        baseCurrencyAmount: payment.baseCurrencyAmount,
        currency: payment.currency,
        baseCurrency: payment.baseCurrency,
        paymentMethod: payment.paymentMethod,
        paymentReference: payment.paymentReference,
        canonicalPostingKey: payment.canonicalPostingKey || "",
        journalEntryId: payment.journalEntryId || "",
        ...metadata
      }
    });
  } catch (error) {
    return null;
  }
};

const sourceMapping = async (mappingKey, { MappingModel = AccountingMapping, AccountModel = ChartOfAccount } = {}) => {
  const mapping = await MappingModel.findOne({ mappingKey, active: true }).lean();
  if (!mapping?.accountCode) throw new AppError("Supplier payment cash/bank mapping is missing or inactive", 409, "SUPPLIER_PAYMENT_GL_MAPPING_MISSING", { mappingKey });
  const account = await AccountModel.findOne({ code: mapping.accountCode, active: true }).lean();
  if (!account || !SOURCE_ACCOUNT_TYPES.has(account.type) || !SOURCE_ACCOUNT_SUBTYPES.has(account.subtype)) {
    throw new AppError("Supplier payment source account is not an active cash or bank account", 409, "SUPPLIER_PAYMENT_SOURCE_ACCOUNT_INVALID", { mappingKey, accountCode: mapping.accountCode });
  }
  return { mappingKey, accountCode: account.code, accountName: account.name };
};

const completeJournal = async (postingKey, { JournalModel = JournalEntry, LineModel = JournalEntryLine } = {}) => {
  const journal = await JournalModel.findOne({ "source.postingKey": postingKey }).lean();
  if (!journal) return null;
  const lines = await LineModel.find({ journalEntryId: journal._id }).lean();
  if (journal.status !== "POSTED" || lines.length !== Number(journal.lineCount || 0) || lines.length !== 2) {
    throw new AppError("Supplier payment journal is incomplete and requires review", 409, "SUPPLIER_PAYMENT_JOURNAL_INCOMPLETE", { postingKey });
  }
  return { journal, lines };
};

const applyAllocationsOnce = async (payment, { PaymentModel = SupplierPayment, ExpenseModel = BusinessExpense } = {}) => {
  if (payment.allocationsAppliedAt) return payment;
  for (const allocation of payment.allocations || []) {
    await ExpenseModel.updateOne(
      { _id: allocation.expenseId, "supplierPaymentAllocations.paymentId": { $ne: payment._id } },
      { $push: { supplierPaymentAllocations: { paymentId: payment._id, amount: allocation.amount, baseCurrencyAmount: allocation.baseCurrencyAmount, allocatedAt: new Date() } } }
    );
  }
  return PaymentModel.findOneAndUpdate({ _id: payment._id, allocationsAppliedAt: null }, { $set: { allocationsAppliedAt: new Date() } }, { new: true }).lean();
};

const reserveAllocations = async (payment, { PaymentModel = SupplierPayment, ExpenseModel = BusinessExpense } = {}) => {
  if (payment.allocationsReservedAt) return payment;
  const reserved = [];
  try {
    for (const allocation of payment.allocations || []) {
      const result = await ExpenseModel.updateOne(
        {
          _id: allocation.expenseId,
          "supplierPaymentAllocations.paymentId": { $ne: payment._id },
          $expr: {
            $lte: [
              { $add: [{ $ifNull: ["$supplierPaymentAllocatedBaseAmount", 0] }, { $sum: { $ifNull: ["$supplierPaymentAllocations.baseCurrencyAmount", []] } }, allocation.baseCurrencyAmount] },
              "$baseCurrencyAmount"
            ]
          }
        },
        { $push: { supplierPaymentAllocations: { paymentId: payment._id, amount: allocation.amount, baseCurrencyAmount: allocation.baseCurrencyAmount, allocatedAt: new Date() } } }
      );
      if (!result?.matchedCount && !result?.n) {
        const existing = ExpenseModel.findOne
          ? await ExpenseModel.findOne({ _id: allocation.expenseId, "supplierPaymentAllocations.paymentId": payment._id }).lean()
          : null;
        if (!(existing?.supplierPaymentAllocations || []).some((row) => String(row.paymentId) === String(payment._id))) {
          throw new AppError("Supplier payment allocation could not be reserved", 409, "SUPPLIER_PAYMENT_ALLOCATION_CONFLICT", { expenseId: allocation.expenseId });
        }
      }
      reserved.push(allocation.expenseId);
    }
    return PaymentModel.findOneAndUpdate({ _id: payment._id, allocationsReservedAt: null }, { $set: { allocationsReservedAt: new Date() } }, { new: true }).lean();
  } catch (error) {
    if (reserved.length) await ExpenseModel.updateMany({ _id: { $in: reserved } }, { $pull: { supplierPaymentAllocations: { paymentId: payment._id } } });
    throw error;
  }
};

const createSupplierPayment = async ({ input = {}, auth = {}, requestId = "", PaymentModel = SupplierPayment, ExpenseModel = BusinessExpense, MappingModel = AccountingMapping, AccountModel = ChartOfAccount, JournalModel = JournalEntry, LineModel = JournalEntryLine, LedgerService = ledger, AuditLogModel = AuditLog } = {}) => {
  const allocations = Array.isArray(input.allocations) ? input.allocations : [];
  if (!allocations.length) throw new AppError("At least one supplier payment allocation is required", 422, "SUPPLIER_PAYMENT_ALLOCATION_REQUIRED");
  const sourceKey = SOURCE_KEYS[String(input.paymentMethod || "").toUpperCase()];
  if (!sourceKey) throw new AppError("Payment method must resolve to cash, bank, or mobile money", 422, "SUPPLIER_PAYMENT_SOURCE_REQUIRED");
  const source = await sourceMapping(sourceKey, { MappingModel, AccountModel });
  const currency = String(input.currency || "").toUpperCase();
  const baseCurrency = String(input.baseCurrency || currency).toUpperCase();
  if (!currency || !baseCurrency) throw new AppError("Supplier payment currency and base currency are required", 422, "SUPPLIER_PAYMENT_CURRENCY_REQUIRED");
  if (currency !== baseCurrency && (!input.exchangeRate || !input.exchangeRateDate || !input.exchangeRateSource)) throw new AppError("Cross-currency supplier payment requires FX evidence", 422, "SUPPLIER_PAYMENT_FX_EVIDENCE_REQUIRED");
  const idempotencyKey = input.idempotencyKey || input.paymentReference;
  const existingPayment = await PaymentModel.findOne({ idempotencyKey }).lean();
  if (existingPayment?.status === "POSTED" && existingPayment.journalEntryId) return { action: "existing", payment: existingPayment };
  const total = decimalNumber(input.amount);
  const allocated = allocations.reduce((sum, item) => sum + decimalNumber(item.amount), 0);
  const totalBase = decimalNumber(input.baseCurrencyAmount || input.amount);
  const allocatedBase = allocations.reduce((sum, item) => sum + decimalNumber(item.baseCurrencyAmount), 0);
  if (allocations.some((item) => item.baseCurrencyAmount === undefined || item.baseCurrencyAmount === null)) {
    throw new AppError("Every supplier payment allocation requires a base-currency amount", 422, "SUPPLIER_PAYMENT_ALLOCATION_BASE_AMOUNT_REQUIRED");
  }
  if (Math.abs(total - allocated) > 0.005 || Math.abs(totalBase - allocatedBase) > 0.005) throw new AppError("Payment allocations must equal the payment amount", 422, "SUPPLIER_PAYMENT_ALLOCATION_MISMATCH");
  const expenseRows = await ExpenseModel.find({ _id: { $in: allocations.map((item) => item.expenseId) } }).lean();
  if (expenseRows.length !== allocations.length) throw new AppError("Every allocation must reference an existing expense", 422, "SUPPLIER_PAYMENT_EXPENSE_NOT_FOUND");
  for (const expense of expenseRows) {
    if (expense.accountingScope && expense.accountingScope !== ACCOUNTING_SCOPE.BUSINESS) {
      throw new AppError("Supplier payment requires a business-accounting expense", 409, "SUPPLIER_PAYMENT_EXPENSE_SCOPE_INVALID", { expenseId: expense._id, accountingScope: expense.accountingScope });
    }
    if ((expense.status && ![FINANCIAL_ENTRY_STATUS.APPROVED, FINANCIAL_ENTRY_STATUS.PAID].includes(expense.status)) || expense.paymentStatus === EXPENSE_PAYMENT_STATUS.VOID) {
      throw new AppError("Supplier payment requires an approved, non-void expense", 409, "SUPPLIER_PAYMENT_EXPENSE_NOT_ELIGIBLE", { expenseId: expense._id, status: expense.status, paymentStatus: expense.paymentStatus });
    }
    const allocation = allocations.find((item) => String(item.expenseId) === String(expense._id));
    const outstanding = decimalNumber(expense.baseCurrencyAmount) - (expense.supplierPaymentAllocations || []).reduce((sum, item) => sum + decimalNumber(item.baseCurrencyAmount), 0);
    if (decimalNumber(allocation.baseCurrencyAmount) > outstanding + 0.005) throw new AppError("Supplier payment allocation exceeds expense balance", 422, "SUPPLIER_PAYMENT_OVER_ALLOCATION");
  }
  const payment = await PaymentModel.findOneAndUpdate(
    { idempotencyKey },
    { $setOnInsert: { paymentReference: input.paymentReference, idempotencyKey, supplierId: input.supplierId || "", supplierName: input.supplierName || "", amount: input.amount, currency, baseCurrency, exchangeRate: input.exchangeRate || 1, exchangeRateDate: input.exchangeRateDate || null, exchangeRateSource: input.exchangeRateSource || "", baseCurrencyAmount: input.baseCurrencyAmount || input.amount, paymentDate: input.paymentDate || new Date(), paymentMethod: String(input.paymentMethod).toUpperCase(), paymentSourceMappingKey: sourceKey, allocations, createdBy: auth?.id || "", canonicalPostingKey: "" } },
    { upsert: true, new: true }
  );
  if (!existingPayment) {
    await recordSupplierPaymentAudit({
      AuditLogModel,
      action: "supplier_payment_created",
      payment,
      auth,
      requestId,
      after: { status: payment.status || "DRAFT", accountingStatus: payment.accountingStatus || "" }
    });
  }
  const postingKey = `supplier-payment:${payment._id}:v1`;
  if (payment.status === "POSTED" && payment.journalEntryId) return { action: "existing", payment };
  if (process.env.SUPPLIER_PAYMENT_AUTOMATIC_POSTING_ENABLED !== "true" || process.env.EXPENSE_POSTING_MODE !== EXPENSE_POSTING_MODE.AUTOMATIC_SUPPLIER_PAYMENT_POSTING) return { action: "preview", payment };
  let existing;
  try {
    existing = await completeJournal(postingKey, { JournalModel, LineModel });
  } catch (error) {
    await PaymentModel.updateOne({ _id: payment._id }, { $set: { status: "NEEDS_REVIEW", accountingStatus: "NEEDS_REVIEW", failure: error.message || "Supplier payment journal requires review" } });
    await recordSupplierPaymentAudit({
      AuditLogModel,
      action: "supplier_payment_needs_review",
      payment,
      auth,
      requestId,
      before: { status: payment.status || "DRAFT", accountingStatus: payment.accountingStatus || "" },
      after: { status: "NEEDS_REVIEW", accountingStatus: "NEEDS_REVIEW" },
      reason: error.message || "Supplier payment journal requires review",
      metadata: { errorCode: error.code || "SUPPLIER_PAYMENT_JOURNAL_INCOMPLETE" }
    });
    throw error;
  }
  if (existing) {
    const recovered = await PaymentModel.findOneAndUpdate({ _id: payment._id }, { $set: { status: "POSTED", accountingStatus: "POSTED", journalEntryId: existing.journal._id, canonicalPostingKey: postingKey, accountingPostedAt: existing.journal.postedAt || new Date() } }, { new: true }).lean();
    await recordSupplierPaymentAudit({
      AuditLogModel,
      action: "supplier_payment_recovered",
      payment: recovered,
      auth,
      requestId,
      before: { status: payment.status || "DRAFT", accountingStatus: payment.accountingStatus || "" },
      after: { status: "POSTED", accountingStatus: "POSTED" },
      metadata: { recoverySource: "existing_complete_journal" }
    });
    return { action: "recovered", payment: await applyAllocationsOnce(recovered, { PaymentModel, ExpenseModel }), journal: existing.journal };
  }
  const claimed = await PaymentModel.findOneAndUpdate({ _id: payment._id, status: { $in: ["DRAFT", "FAILED_RETRYABLE"] } }, { $set: { status: "POSTING", accountingStatus: "POSTING", canonicalPostingKey: postingKey, accountingLastAttemptAt: new Date(), paymentSourceMappingKey: source.mappingKey } }, { new: true }).lean();
  if (!claimed) return { action: "in_progress", payment };
  await recordSupplierPaymentAudit({
    AuditLogModel,
    action: "supplier_payment_posting_started",
    payment: claimed,
    auth,
    requestId,
    before: { status: payment.status || "DRAFT", accountingStatus: payment.accountingStatus || "" },
    after: { status: "POSTING", accountingStatus: "POSTING" }
  });
  try {
    const reserved = await reserveAllocations(claimed, { PaymentModel, ExpenseModel });
    await recordSupplierPaymentAudit({
      AuditLogModel,
      action: "supplier_payment_allocation_reserved",
      payment: reserved,
      auth,
      requestId,
      before: { status: "POSTING", accountingStatus: "POSTING" },
      after: { status: "POSTING", accountingStatus: "POSTING" }
    });
    const result = await LedgerService.postSupplierPayment({ payment: reserved, auth, requestId });
    const journalId = result?.journal?.id || result?.journal?._id || null;
    const posted = await PaymentModel.findOneAndUpdate({ _id: claimed._id }, { $set: { status: "POSTED", accountingStatus: "POSTED", journalEntryId: journalId, canonicalPostingKey: postingKey, accountingPostedAt: new Date(), failure: "" } }, { new: true }).lean();
    await recordSupplierPaymentAudit({
      AuditLogModel,
      action: "supplier_payment_posted",
      payment: posted,
      auth,
      requestId,
      before: { status: "POSTING", accountingStatus: "POSTING" },
      after: { status: "POSTED", accountingStatus: "POSTED" },
      metadata: { journalEntryId: journalId }
    });
    return { action: result?.action || "posted", payment: await applyAllocationsOnce(posted, { PaymentModel, ExpenseModel }), journal: result?.journal || result };
  } catch (error) {
    await PaymentModel.updateOne({ _id: claimed._id }, { $set: { status: "FAILED_RETRYABLE", accountingStatus: "FAILED_RETRYABLE", failure: error.message || "Supplier payment posting failed" } });
    await recordSupplierPaymentAudit({
      AuditLogModel,
      action: "supplier_payment_failed_retryable",
      payment: claimed,
      auth,
      requestId,
      before: { status: "POSTING", accountingStatus: "POSTING" },
      after: { status: "FAILED_RETRYABLE", accountingStatus: "FAILED_RETRYABLE" },
      reason: error.message || "Supplier payment posting failed",
      metadata: { errorCode: error.code || "SUPPLIER_PAYMENT_POSTING_FAILED" }
    });
    throw error;
  }
};

module.exports = { createSupplierPayment, sourceMapping, reserveAllocations, applyAllocationsOnce };