const { v4: uuidv4 } = require("uuid");
const AccountingMapping = require("../../models/AccountingMapping");
const AccountingPeriod = require("../../models/AccountingPeriod");
const AuditLog = require("../../models/AuditLog");
const BusinessExpense = require("../../models/BusinessExpense");
const BusinessIncome = require("../../models/BusinessIncome");
const ChartOfAccount = require("../../models/ChartOfAccount");
const FixedAsset = require("../../models/FixedAsset");
const Invoice = require("../../models/Invoice");
const JournalEntry = require("../../models/JournalEntry");
const JournalEntryLine = require("../../models/JournalEntryLine");
const LedgerMigrationRun = require("../../models/LedgerMigrationRun");
const Payment = require("../../models/Payment");
const PostingRule = require("../../models/PostingRule");
const Refund = require("../../models/Refund");
const {
  ACCOUNTING_PERIOD_STATUS,
  BUSINESS_UNIT,
  COST_CENTER_TYPE,
  DEPRECIATION_METHOD,
  FIXED_ASSET_STATUS,
  GL_ACCOUNT_SUBTYPE,
  GL_ACCOUNT_TYPE,
  GL_MAPPING_KEY,
  GL_POSTING_TYPE,
  JOURNAL_STATUS,
  LEDGER_MIGRATION_CONFIDENCE,
  LEDGER_MIGRATION_STATUS,
  SOURCE_MODULE
} = require("../../accounting/constants");
const {
  DEFAULT_ACCOUNTING_MAPPINGS,
  DEFAULT_POSTING_RULES
} = require("../../accounting/defaultAccountingMappings");
const AppError = require("../../utils/AppError");
const { configuredBaseCurrency, resolveFxEvidence } = require("../../accounting/currencyPolicy");
const {
  Decimal,
  decimalString,
  decimalToApi,
  multiply,
  normalizeCurrency,
  requireCurrency,
  toDecimal,
  toDecimal128
} = require("../../utils/money");

const POSTED_LINE_STATUSES = new Set([JOURNAL_STATUS.POSTED, JOURNAL_STATUS.REVERSED]);
const CASH_ACCOUNT_SUBTYPES = new Set([
  GL_ACCOUNT_SUBTYPE.CASH,
  GL_ACCOUNT_SUBTYPE.BANK,
  GL_ACCOUNT_SUBTYPE.MOBILE_MONEY,
  GL_ACCOUNT_SUBTYPE.PROVIDER_CLEARING
]);
const CLOSED_PERIOD_STATUSES = new Set([ACCOUNTING_PERIOD_STATUS.CLOSED, ACCOUNTING_PERIOD_STATUS.LOCKED]);
const MONEY_ZERO = "0";
const DEFAULT_JOURNAL_LIMIT = 25;
const MAX_JOURNAL_LIMIT = 1000;
const DEFAULT_LEDGER_LIMIT = 25;
const MAX_LEDGER_LIMIT = 1000;

const JOURNAL_STATUS_LABELS = Object.freeze({
  [JOURNAL_STATUS.DRAFT]: "Draft",
  [JOURNAL_STATUS.SUBMITTED]: "Submitted",
  [JOURNAL_STATUS.PENDING_APPROVAL]: "Pending Approval",
  [JOURNAL_STATUS.APPROVED]: "Approved",
  [JOURNAL_STATUS.POSTED]: "Posted",
  [JOURNAL_STATUS.REVERSED]: "Reversed",
  [JOURNAL_STATUS.VOID]: "Void"
});

const SOURCE_MODULE_LABELS = Object.freeze({
  [SOURCE_MODULE.BOOKING_ACCOUNTING]: "Booking Accounting",
  [SOURCE_MODULE.BUSINESS_ACCOUNTING]: "Business Accounting",
  [SOURCE_MODULE.BOOKING]: "Booking",
  [SOURCE_MODULE.INVOICE]: "Invoice",
  [SOURCE_MODULE.PAYMENT]: "Payment",
  [SOURCE_MODULE.REFUND]: "Refund",
  [SOURCE_MODULE.COMMISSION]: "Commission",
  [SOURCE_MODULE.CASH_MOVEMENT]: "Cash Movement",
  [SOURCE_MODULE.MANUAL]: "Manual"
});

const asArray = (value) => (Array.isArray(value) ? value : []);
const normalizeToken = (value = "") => String(value || "").trim();
const normalizeEnumToken = (value = "") => normalizeToken(value).toUpperCase();
const normalizeId = (value) => {
  if (!value) return "";
  if (value.toString) return value.toString();
  return String(value);
};

const leanMaybe = async (value) => {
  if (value && typeof value.lean === "function") return value.lean();
  return value;
};

const queryMaybe = (result, { sort = null, limit = null } = {}) => {
  let next = result;
  if (sort && next && typeof next.sort === "function") next = next.sort(sort);
  if (limit && next && typeof next.limit === "function") next = next.limit(limit);
  return next;
};

const parsePositiveInt = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const escapeRegex = (value = "") => normalizeToken(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const labelizeToken = (value = "") => String(value || "")
  .toLowerCase()
  .split("_")
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(" ");

const sourceLabel = (sourceModule = "") => SOURCE_MODULE_LABELS[sourceModule] || labelizeToken(sourceModule);

const statusLabel = (status = "") => JOURNAL_STATUS_LABELS[status] || labelizeToken(status);

const journalDifference = (entry = {}) =>
  decimalDifference(entry.baseTotalDebit || entry.totalDebit || 0, entry.baseTotalCredit || entry.totalCredit || 0);

const journalHasProblem = (entry = {}) => {
  const status = normalizeEnumToken(entry.status);
  return (
    status === JOURNAL_STATUS.VOID ||
    !toDecimal(entry.baseTotalDebit || 0).equals(toDecimal(entry.baseTotalCredit || 0)) ||
    Number(entry.lineCount || 0) < 2
  );
};

const isDebitNormalAccount = (accountType = "") =>
  [GL_ACCOUNT_TYPE.ASSET, GL_ACCOUNT_TYPE.EXPENSE, GL_ACCOUNT_TYPE.COST_OF_SALES, GL_ACCOUNT_TYPE.OTHER_EXPENSE].includes(accountType);

const ledgerLineSignedBalance = (line = {}) => {
  const debit = toDecimal(line.baseCurrencyDebit || 0);
  const credit = toDecimal(line.baseCurrencyCredit || 0);
  return isDebitNormalAccount(line.accountType) ? debit.minus(credit) : credit.minus(debit);
};

const ledgerLineActivityAmount = (line = {}) =>
  toDecimal(line.baseCurrencyDebit || 0).plus(toDecimal(line.baseCurrencyCredit || 0));

const lineDateValue = (line = {}) => new Date(line.postingDate || line.entryDate || 0).getTime();

const sortLedgerRows = (rows = [], { sortBy = "postingDate", sortDirection = "desc" } = {}) => {
  const field = ["postingDate", "entryNumber", "accountCode", "baseCurrencyDebit", "baseCurrencyCredit", "sourceReference"].includes(sortBy)
    ? sortBy
    : "postingDate";
  const direction = String(sortDirection).toLowerCase() === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    if (field === "postingDate") {
      const dateCompare = (lineDateValue(left) - lineDateValue(right)) * direction;
      if (dateCompare) return dateCompare;
      return String(left.entryNumber || "").localeCompare(String(right.entryNumber || ""), "en", { numeric: true }) * direction;
    }
    if (["baseCurrencyDebit", "baseCurrencyCredit"].includes(field)) {
      return toDecimal(left[field] || 0).minus(toDecimal(right[field] || 0)).toNumber() * direction;
    }
    return String(left[field] || "").localeCompare(String(right[field] || ""), "en", { numeric: true, sensitivity: "base" }) * direction;
  });
};

const ledgerTrendBucket = (date, granularity) => {
  const parsed = new Date(date);
  if (granularity === "month") {
    return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  if (granularity === "week") {
    const weekStart = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
    return weekStart.toISOString().slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
};

const chooseLedgerTrendGranularity = ({ fromDate = "", toDate = "" } = {}) => {
  if (!fromDate || !toDate) return "month";
  const spanDays = Math.abs(normalizeDate(toDate).getTime() - normalizeDate(fromDate).getTime()) / 86400000;
  if (spanDays > 120) return "month";
  if (spanDays > 45) return "week";
  return "day";
};

const buildLedgerTrend = (lines = [], filters = {}) => {
  const granularity = chooseLedgerTrendGranularity(filters);
  const buckets = new Map();
  lines.forEach((line) => {
    const bucket = ledgerTrendBucket(line.postingDate || line.entryDate, granularity);
    const row = buckets.get(bucket) || {
      bucket,
      label: bucket,
      debit: new Decimal(0),
      credit: new Decimal(0)
    };
    row.debit = row.debit.plus(toDecimal(line.baseCurrencyDebit || 0));
    row.credit = row.credit.plus(toDecimal(line.baseCurrencyCredit || 0));
    buckets.set(bucket, row);
  });
  return {
    granularity,
    points: Array.from(buckets.values())
      .sort((left, right) => left.bucket.localeCompare(right.bucket))
      .map((row) => ({
        bucket: row.bucket,
        label: row.label,
        debit: row.debit.toFixed(),
        credit: row.credit.toFixed(),
        difference: row.debit.minus(row.credit).toFixed()
      }))
  };
};

const summarizeLedgerLines = (lines = []) => {
  const totalDebit = decimalSum(lines.map((line) => line.baseCurrencyDebit || 0));
  const totalCredit = decimalSum(lines.map((line) => line.baseCurrencyCredit || 0));
  const accountCodes = new Set(lines.map((line) => line.accountCode).filter(Boolean));
  const journalNumbers = new Set(lines.map((line) => line.entryNumber).filter(Boolean));
  const currencySet = new Set(lines.map((line) => line.baseCurrency || line.currency).filter(Boolean));
  const sourceMap = new Map();
  lines.forEach((line) => {
    const sourceModule = line.sourceModule || SOURCE_MODULE.MANUAL;
    const existing = sourceMap.get(sourceModule) || { sourceModule, label: sourceLabel(sourceModule), count: 0 };
    existing.count += 1;
    sourceMap.set(sourceModule, existing);
  });
  return {
    totalTransactions: lines.length,
    totalDebit,
    totalCredit,
    difference: decimalDifference(totalDebit, totalCredit),
    balanced: toDecimal(totalDebit).equals(toDecimal(totalCredit)),
    accountsInUse: accountCodes.size,
    journalsInUse: journalNumbers.size,
    baseCurrencies: Array.from(currencySet),
    sources: Array.from(sourceMap.values()).sort((left, right) => right.count - left.count)
  };
};

const topAccountsFromLedgerLines = (lines = [], limit = 5) => {
  const map = new Map();
  lines.forEach((line) => {
    const key = line.accountCode || "UNKNOWN";
    const row = map.get(key) || {
      accountCode: line.accountCode || "",
      accountName: line.accountName || "Unknown account",
      accountType: line.accountType || "",
      transactions: 0,
      amount: new Decimal(0),
      debit: new Decimal(0),
      credit: new Decimal(0)
    };
    row.transactions += 1;
    row.amount = row.amount.plus(ledgerLineActivityAmount(line));
    row.debit = row.debit.plus(toDecimal(line.baseCurrencyDebit || 0));
    row.credit = row.credit.plus(toDecimal(line.baseCurrencyCredit || 0));
    map.set(key, row);
  });
  return Array.from(map.values())
    .sort((left, right) => right.amount.minus(left.amount).toNumber() || left.accountCode.localeCompare(right.accountCode))
    .slice(0, limit)
    .map((row, index) => ({
      rank: index + 1,
      accountCode: row.accountCode,
      accountName: row.accountName,
      accountType: row.accountType,
      transactions: row.transactions,
      amount: row.amount.toFixed(),
      debit: row.debit.toFixed(),
      credit: row.credit.toFixed()
    }));
};

const sortJournalRows = (rows = [], { sortBy = "postingDate", sortDirection = "desc" } = {}) => {
  const field = ["postingDate", "entryDate", "entryNumber", "status", "baseTotalDebit", "baseTotalCredit", "createdAt"].includes(sortBy)
    ? sortBy
    : "postingDate";
  const direction = String(sortDirection).toLowerCase() === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    if (["postingDate", "entryDate", "createdAt"].includes(field)) {
      return (new Date(left[field] || 0).getTime() - new Date(right[field] || 0).getTime()) * direction;
    }
    if (["baseTotalDebit", "baseTotalCredit"].includes(field)) {
      return toDecimal(left[field] || 0).minus(toDecimal(right[field] || 0)).toNumber() * direction;
    }
    return String(left[field] || "").localeCompare(String(right[field] || ""), "en", { numeric: true, sensitivity: "base" }) * direction;
  });
};

const summarizeJournalRows = (rows = []) => {
  const total = rows.length;
  const posted = rows.filter((entry) => entry.status === JOURNAL_STATUS.POSTED).length;
  const draft = rows.filter((entry) => [JOURNAL_STATUS.DRAFT, JOURNAL_STATUS.SUBMITTED, JOURNAL_STATUS.PENDING_APPROVAL, JOURNAL_STATUS.APPROVED].includes(entry.status)).length;
  const problems = rows.filter(journalHasProblem).length;
  const totalDebit = decimalSum(rows.map((entry) => entry.baseTotalDebit || entry.totalDebit || 0));
  const totalCredit = decimalSum(rows.map((entry) => entry.baseTotalCredit || entry.totalCredit || 0));
  const byStatus = Object.values(JOURNAL_STATUS).map((status) => ({
    status,
    label: statusLabel(status),
    count: rows.filter((entry) => entry.status === status).length
  }));
  const sourceMap = new Map();
  rows.forEach((entry) => {
    const sourceModule = entry.source?.sourceModule || entry.sourceModule || SOURCE_MODULE.MANUAL;
    const existing = sourceMap.get(sourceModule) || { sourceModule, label: sourceLabel(sourceModule), count: 0 };
    existing.count += 1;
    sourceMap.set(sourceModule, existing);
  });

  return {
    total,
    posted,
    draft,
    problems,
    totalDebit,
    totalCredit,
    difference: decimalDifference(totalDebit, totalCredit),
    byStatus,
    bySource: Array.from(sourceMap.values()).sort((left, right) => right.count - left.count),
    tabs: [
      { key: "all", label: "All Entries", count: total },
      { key: "posted", label: "Posted", count: posted },
      { key: "draft", label: "Draft", count: draft },
      { key: "problems", label: "Needs Attention", count: problems }
    ]
  };
};

const money = (value = 0, options = {}) => decimalString(value ?? 0, options);
const apiMoney = (value = 0) => decimalToApi(value, "0");
const isPositive = (value = 0) => toDecimal(value || 0).greaterThan(0);
const periodKeyForDate = (date = new Date()) => {
  const parsed = new Date(date);
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};
const quarterForMonth = (month) => Math.floor((month - 1) / 3) + 1;
const startOfMonthUtc = (year, month) => new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
const endOfMonthUtc = (year, month) => new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

const normalizeDate = (value, fallback = new Date()) => {
  const parsed = new Date(value || fallback);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError("Accounting date is invalid.", 422, "GL_DATE_INVALID");
  }
  return parsed;
};

const decimalSum = (values = []) =>
  values.reduce((sum, value) => sum.plus(toDecimal(value || 0)), new Decimal(0)).toFixed();

const decimalDifference = (left = 0, right = 0) => toDecimal(left || 0).minus(toDecimal(right || 0)).toFixed();

const providerMappingKey = (provider = "") => {
  const normalized = normalizeEnumToken(provider);
  if (normalized === "PESAPAL") return GL_MAPPING_KEY.PESAPAL_CLEARING;
  if (normalized === "PAYPAL") return GL_MAPPING_KEY.PAYPAL_CLEARING;
  if (normalized === "DPO") return GL_MAPPING_KEY.DPO_CLEARING;
  if (normalized === "MOBILE_MONEY") return GL_MAPPING_KEY.MOBILE_MONEY;
  return null;
};

const expenseMappingKey = (category = "") => {
  const normalized = normalizeEnumToken(category);
  if (normalized.includes("RENT")) return GL_MAPPING_KEY.RENT_EXPENSE;
  if (normalized.includes("SOFTWARE")) return GL_MAPPING_KEY.SOFTWARE_EXPENSE;
  if (normalized.includes("MARKETING") || normalized.includes("ADVERTISING")) return GL_MAPPING_KEY.MARKETING_EXPENSE;
  if (normalized.includes("SALAR")) return GL_MAPPING_KEY.SALARY_EXPENSE;
  return GL_MAPPING_KEY.SOFTWARE_EXPENSE;
};

const revenueMappingKey = (booking = {}) => {
  const title = normalizeEnumToken(booking.productTitle || booking.productName || booking.product || "");
  if (title.includes("TRANSFER")) return GL_MAPPING_KEY.TRANSFER_REVENUE;
  return GL_MAPPING_KEY.TOUR_REVENUE;
};

const normalizeJournalForApi = (entry = {}, lines = []) => {
  const row = entry?.toObject ? entry.toObject() : entry || {};
  return {
    id: normalizeId(row._id),
    entryNumber: row.entryNumber || "",
    entryDate: row.entryDate || null,
    postingDate: row.postingDate || null,
    period: row.period || "",
    sourceModule: row.source?.sourceModule || row.sourceModule || "",
    sourceEntityType: row.source?.sourceEntityType || "",
    sourceEntityId: row.source?.sourceEntityId || "",
    sourceReference: row.source?.sourceReference || "",
    postingType: row.source?.postingType || row.postingType || "",
    postingKey: row.source?.postingKey || row.postingKey || "",
    description: row.description || "",
    status: row.status || JOURNAL_STATUS.DRAFT,
    currency: row.currency || "",
    exchangeRate: apiMoney(row.exchangeRate),
    exchangeRateDate: row.exchangeRateDate || null,
    exchangeRateSource: row.exchangeRateSource || "",
    totalDebit: apiMoney(row.totalDebit),
    totalCredit: apiMoney(row.totalCredit),
    baseCurrency: row.baseCurrency || "",
    cashFlowCategory: row.cashFlowCategory || "NONE",
    baseTotalDebit: apiMoney(row.baseTotalDebit),
    baseTotalCredit: apiMoney(row.baseTotalCredit),
    lineCount: row.lineCount || lines.length || 0,
    requiresApproval: Boolean(row.requiresApproval),
    createdBy: row.createdBy || "",
    approvedBy: row.approvedBy || "",
    approvedAt: row.approvedAt || null,
    postedBy: row.postedBy || "",
    postedAt: row.postedAt || null,
    reversalOf: normalizeId(row.reversalOf),
    reversedBy: normalizeId(row.reversedBy),
    reversedAt: row.reversedAt || null,
    reason: row.reason || "",
    evidence: row.evidence || {},
    correlationId: row.correlationId || "",
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
    lines: lines.map(normalizeLineForApi)
  };
};

const normalizeLineForApi = (line = {}) => {
  const row = line?.toObject ? line.toObject() : line || {};
  return {
    id: normalizeId(row._id),
    journalEntryId: normalizeId(row.journalEntryId),
    entryNumber: row.entryNumber || "",
    journalStatus: row.journalStatus || "",
    postingDate: row.postingDate || null,
    period: row.period || "",
    accountId: normalizeId(row.accountId),
    accountCode: row.accountCode || "",
    accountName: row.accountName || "",
    accountType: row.accountType || "",
    accountSubtype: row.accountSubtype || "",
    description: row.description || "",
    debit: apiMoney(row.debit),
    credit: apiMoney(row.credit),
    currency: row.currency || "",
    exchangeRate: apiMoney(row.exchangeRate),
    exchangeRateDate: row.exchangeRateDate || null,
    exchangeRateSource: row.exchangeRateSource || "",
    baseCurrencyDebit: apiMoney(row.baseCurrencyDebit),
    baseCurrencyCredit: apiMoney(row.baseCurrencyCredit),
    baseCurrency: row.baseCurrency || "",
    businessUnit: row.businessUnit || BUSINESS_UNIT.UNALLOCATED,
    cashFlowCategory: row.cashFlowCategory || "NONE",
    costCenter: row.costCenter || COST_CENTER_TYPE.OTHER,
    productId: row.productId || "",
    channel: row.channel || "",
    customerId: row.customerId || "",
    supplierId: row.supplierId || "",
    agentId: row.agentId || "",
    bookingId: row.bookingId || "",
    bookingReference: row.bookingReference || "",
    vehicleId: row.vehicleId || "",
    driverId: row.driverId || "",
    guideId: row.guideId || "",
    sourceModule: row.sourceModule || "",
    sourceEntityType: row.sourceEntityType || "",
    sourceEntityId: row.sourceEntityId || "",
    sourceReference: row.sourceReference || "",
    postingType: row.postingType || "",
    postingKey: row.postingKey || "",
    metadata: row.metadata || {}
  };
};

const createGeneralLedgerService = ({
  AccountingMappingModel = AccountingMapping,
  AccountingPeriodModel = AccountingPeriod,
  AuditLogModel = AuditLog,
  BusinessExpenseModel = BusinessExpense,
  BusinessIncomeModel = BusinessIncome,
  ChartOfAccountModel = ChartOfAccount,
  FixedAssetModel = FixedAsset,
  InvoiceModel = Invoice,
  JournalEntryModel = JournalEntry,
  JournalEntryLineModel = JournalEntryLine,
  LedgerMigrationRunModel = LedgerMigrationRun,
  PaymentModel = Payment,
  PostingRuleModel = PostingRule,
  RefundModel = Refund,
  defaultMappings = DEFAULT_ACCOUNTING_MAPPINGS,
  defaultPostingRules = DEFAULT_POSTING_RULES,
  now = () => new Date()
} = {}) => {
  const recordAudit = async ({ action, entityType = "JournalEntry", entity = null, auth = {}, requestId = "", reason = "", before = null, after = null, metadata = {} }) => {
    if (!AuditLogModel?.create) return null;
    return AuditLogModel.create({
      actorId: auth?.id || null,
      actorRole: auth?.role || "system",
      action,
      entityType,
      entityId: normalizeId(entity?._id) || metadata.entityId || entityType,
      reference: entity?.entryNumber || entity?.periodKey || entity?.mappingKey || entity?.assetReference || metadata.reference || "",
      reason,
      requestId,
      before,
      after,
      metadata
    });
  };

  const findAccountByCode = async (code) => {
    const account = await leanMaybe(ChartOfAccountModel.findOne({ code: normalizeEnumToken(code), active: true }));
    if (!account) {
      throw new AppError("Mapped chart account is missing or inactive.", 409, "GL_ACCOUNT_MAPPING_MISSING", {
        accountCode: code
      });
    }
    return account;
  };

  const resolveAccountByMapping = async (mappingKey) => {
    const key = normalizeEnumToken(mappingKey);
    let mapping = await leanMaybe(AccountingMappingModel.findOne({ mappingKey: key, active: true }));
    if (!mapping) {
      mapping = defaultMappings.find((item) => item.mappingKey === key);
    }
    if (!mapping?.accountCode) {
      throw new AppError("Accounting mapping is missing.", 409, "GL_MAPPING_MISSING", { mappingKey: key });
    }
    return findAccountByCode(mapping.accountCode);
  };

  const ensureOpenPeriod = async (postingDate) => {
    const date = normalizeDate(postingDate, now());
    const key = periodKeyForDate(date);
    const period = await leanMaybe(
      AccountingPeriodModel.findOne({
        startDate: { $lte: date },
        endDate: { $gte: date }
      })
    );
    if (period && CLOSED_PERIOD_STATUSES.has(period.status)) {
      throw new AppError("Accounting period is closed or locked.", 409, "GL_PERIOD_CLOSED", {
        period: period.periodKey,
        status: period.status
      });
    }
    return {
      periodKey: period?.periodKey || key,
      period: period || null
    };
  };

  const generateEntryNumber = async (postingDate) => {
    const year = normalizeDate(postingDate, now()).getUTCFullYear();
    let count = 0;
    if (JournalEntryModel.countDocuments) {
      count = await JournalEntryModel.countDocuments({
        entryNumber: new RegExp(`^JE-${year}-`)
      });
    }
    const sequence = String(count + 1).padStart(6, "0");
    return `JE-${year}-${sequence}`;
  };

  const buildPostingKey = ({ sourceModule, sourceEntityId, sourceReference, postingType }) =>
    [
      normalizeEnumToken(sourceModule || SOURCE_MODULE.MANUAL),
      normalizeToken(sourceEntityId || sourceReference || "manual"),
      normalizeEnumToken(postingType || GL_POSTING_TYPE.MANUAL_JOURNAL)
    ].join(":");

  const normalizeJournalLines = async ({ lines = [], currency, baseCurrency, exchangeRate, exchangeRateDate, exchangeRateSource, postingDate, source = {}, dimensions = {} }) => {
    if (!asArray(lines).length) {
      throw new AppError("At least two journal lines are required.", 422, "GL_LINES_REQUIRED");
    }

    const fx = resolveFxEvidence({ transactionCurrency: currency, baseCurrency, exchangeRate, exchangeRateDate, exchangeRateSource, transactionDate: postingDate });
    const normalizedCurrency = fx.transactionCurrency;
    const normalizedBaseCurrency = fx.baseCurrency;
    const rate = fx.exchangeRate;

    const resolved = [];
    for (const line of lines) {
      const account = line.accountCode
        ? await findAccountByCode(line.accountCode)
        : await resolveAccountByMapping(line.mappingKey);
      if (account.allowManualPosting === false && source.postingType === GL_POSTING_TYPE.MANUAL_JOURNAL) {
        throw new AppError("Manual posting is not allowed for one or more accounts.", 409, "GL_MANUAL_POSTING_BLOCKED", {
          accountCode: account.code
        });
      }

      const debit = money(line.debit || 0, { allowNegative: false, field: "debit" });
      const credit = money(line.credit || 0, { allowNegative: false, field: "credit" });
      if (isPositive(debit) && isPositive(credit)) {
        throw new AppError("A journal line cannot contain both debit and credit.", 422, "GL_LINE_DOUBLE_SIDED");
      }
      if (!isPositive(debit) && !isPositive(credit)) {
        throw new AppError("Each journal line must contain a debit or credit amount.", 422, "GL_LINE_AMOUNT_REQUIRED");
      }

      const lineCurrency = normalizeCurrency(line.currency) || normalizedCurrency;
      const lineFx = resolveFxEvidence({ transactionCurrency: lineCurrency, baseCurrency: normalizedBaseCurrency, exchangeRate: line.exchangeRate ?? (lineCurrency === normalizedCurrency ? rate : undefined), exchangeRateDate: line.exchangeRateDate || fx.exchangeRateDate, exchangeRateSource: line.exchangeRateSource || fx.exchangeRateSource, transactionDate: postingDate });
      resolved.push({
        account,
        description: normalizeToken(line.description || ""),
        debit,
        credit,
        currency: lineCurrency,
        exchangeRate: lineFx.exchangeRate,
        exchangeRateDate: lineFx.exchangeRateDate,
        exchangeRateSource: lineFx.exchangeRateSource,
        baseCurrencyDebit: multiply(debit, lineFx.exchangeRate),
        baseCurrencyCredit: multiply(credit, lineFx.exchangeRate),
        baseCurrency: normalizedBaseCurrency,
        cashFlowCategory: normalizeEnumToken(line.cashFlowCategory || account.cashFlowCategory || "NONE"),
        businessUnit: normalizeEnumToken(line.businessUnit || dimensions.businessUnit || BUSINESS_UNIT.UNALLOCATED),
        costCenter: normalizeEnumToken(line.costCenter || dimensions.costCenter || COST_CENTER_TYPE.OTHER),
        productId: normalizeToken(line.productId || dimensions.productId || ""),
        channel: normalizeEnumToken(line.channel || dimensions.channel || ""),
        customerId: normalizeToken(line.customerId || dimensions.customerId || ""),
        supplierId: normalizeToken(line.supplierId || dimensions.supplierId || ""),
        agentId: normalizeToken(line.agentId || dimensions.agentId || ""),
        bookingId: normalizeToken(line.bookingId || dimensions.bookingId || ""),
        bookingReference: normalizeToken(line.bookingReference || dimensions.bookingReference || ""),
        vehicleId: normalizeToken(line.vehicleId || dimensions.vehicleId || ""),
        driverId: normalizeToken(line.driverId || dimensions.driverId || ""),
        guideId: normalizeToken(line.guideId || dimensions.guideId || ""),
        metadata: line.metadata || {}
      });
    }

    const totalDebit = decimalSum(resolved.map((line) => line.debit));
    const totalCredit = decimalSum(resolved.map((line) => line.credit));
    const baseTotalDebit = decimalSum(resolved.map((line) => line.baseCurrencyDebit));
    const baseTotalCredit = decimalSum(resolved.map((line) => line.baseCurrencyCredit));
    if (!toDecimal(baseTotalDebit).equals(toDecimal(baseTotalCredit))) {
      throw new AppError("Journal entry is unbalanced.", 422, "GL_JOURNAL_UNBALANCED", {
        totalDebit,
        totalCredit,
        baseTotalDebit,
        baseTotalCredit
      });
    }

    return {
      lines: resolved,
      totalDebit,
      totalCredit,
      baseTotalDebit,
      baseTotalCredit,
      currency: normalizedCurrency,
      baseCurrency: normalizedBaseCurrency,
      exchangeRate: rate,
      exchangeRateDate: fx.exchangeRateDate,
      exchangeRateSource: fx.exchangeRateSource
    };
  };

  const persistLines = async ({ entry, source, lines }) => {
    const payloads = lines.map((line) => ({
      journalEntryId: entry._id,
      entryNumber: entry.entryNumber,
      journalStatus: entry.status,
      entryDate: entry.entryDate,
      postingDate: entry.postingDate,
      period: entry.period,
      accountId: line.account._id,
      accountCode: line.account.code,
      accountName: line.account.name,
      accountType: line.account.type,
      accountSubtype: line.account.subtype,
      description: line.description || entry.description,
      debit: toDecimal128(line.debit),
      credit: toDecimal128(line.credit),
      currency: line.currency,
      exchangeRate: toDecimal128(line.exchangeRate),
      exchangeRateDate: line.exchangeRateDate,
      exchangeRateSource: line.exchangeRateSource,
      baseCurrencyDebit: toDecimal128(line.baseCurrencyDebit),
      baseCurrencyCredit: toDecimal128(line.baseCurrencyCredit),
      baseCurrency: line.baseCurrency,
      cashFlowCategory: line.cashFlowCategory,
      businessUnit: line.businessUnit,
      costCenter: line.costCenter,
      productId: line.productId,
      channel: line.channel,
      customerId: line.customerId,
      supplierId: line.supplierId,
      agentId: line.agentId,
      bookingId: line.bookingId,
      bookingReference: line.bookingReference,
      vehicleId: line.vehicleId,
      driverId: line.driverId,
      guideId: line.guideId,
      sourceModule: source.sourceModule,
      sourceEntityType: source.sourceEntityType,
      sourceEntityId: source.sourceEntityId,
      sourceReference: source.sourceReference,
      postingType: source.postingType,
      postingKey: source.postingKey,
      metadata: line.metadata
    }));

    const created = [];
    for (const payload of payloads) {
      created.push(await JournalEntryLineModel.create(payload));
    }
    return created;
  };

  const updateLineStatus = async (entryId, status) => {
    if (JournalEntryLineModel.updateMany) {
      await JournalEntryLineModel.updateMany({ journalEntryId: entryId }, { $set: { journalStatus: status } });
    }
  };

  const createJournal = async ({ input = {}, status = JOURNAL_STATUS.DRAFT, auth = {}, requestId = "" } = {}) => {
    const postingDate = normalizeDate(input.postingDate || input.entryDate || now(), now());
    const entryDate = normalizeDate(input.entryDate || postingDate, postingDate);
    const source = {
      sourceModule: normalizeEnumToken(input.sourceModule || SOURCE_MODULE.MANUAL),
      sourceEntityType: normalizeToken(input.sourceEntityType || "ManualJournal"),
      sourceEntityId: normalizeToken(input.sourceEntityId || input.sourceReference || uuidv4()),
      sourceReference: normalizeToken(input.sourceReference || input.sourceEntityId || ""),
      postingType: normalizeEnumToken(input.postingType || GL_POSTING_TYPE.MANUAL_JOURNAL),
      postingKey: normalizeToken(input.postingKey || "")
    };
    source.postingKey = source.postingKey || buildPostingKey(source);

    const existing = await leanMaybe(JournalEntryModel.findOne({ "source.postingKey": source.postingKey }));
    if (existing) {
      const lines = await leanMaybe(JournalEntryLineModel.find({ journalEntryId: existing._id }));
      return {
        action: "existing",
        idempotent: true,
        journal: normalizeJournalForApi(existing, lines)
      };
    }

    await ensureOpenPeriod(postingDate);
    const normalized = await normalizeJournalLines({
      lines: input.lines,
      currency: input.currency,
      baseCurrency: input.baseCurrency || configuredBaseCurrency(),
      exchangeRate: input.exchangeRate,
      exchangeRateDate: input.exchangeRateDate,
      exchangeRateSource: input.exchangeRateSource,
      postingDate,
      source,
      dimensions: input.dimensions || {}
    });
    const entryNumber = input.entryNumber || await generateEntryNumber(postingDate);
    const period = input.period || periodKeyForDate(postingDate);
    const requiresApproval = input.requiresApproval !== false && source.postingType === GL_POSTING_TYPE.MANUAL_JOURNAL;
    const entry = await JournalEntryModel.create({
      entryNumber,
      entryDate,
      postingDate,
      period,
      source,
      description: normalizeToken(input.description || "General ledger journal"),
      status,
      currency: normalized.currency,
      exchangeRate: toDecimal128(normalized.exchangeRate),
      exchangeRateDate: normalized.exchangeRateDate,
      exchangeRateSource: normalized.exchangeRateSource,
      totalDebit: toDecimal128(normalized.totalDebit),
      totalCredit: toDecimal128(normalized.totalCredit),
      baseCurrency: normalized.baseCurrency,
      baseTotalDebit: toDecimal128(normalized.baseTotalDebit),
      baseTotalCredit: toDecimal128(normalized.baseTotalCredit),
      lineCount: normalized.lines.length,
      requiresApproval,
      createdBy: auth?.id || input.createdBy || "",
      approvedBy: [JOURNAL_STATUS.APPROVED, JOURNAL_STATUS.POSTED].includes(status) ? auth?.id || "" : "",
      approvedAt: [JOURNAL_STATUS.APPROVED, JOURNAL_STATUS.POSTED].includes(status) ? now() : null,
      postedBy: status === JOURNAL_STATUS.POSTED ? auth?.id || "" : "",
      postedAt: status === JOURNAL_STATUS.POSTED ? now() : null,
      reversalOf: input.reversalOf || null,
      reason: input.reason || "",
      evidence: input.evidence || {},
      sourceSnapshot: input.sourceSnapshot || {},
      metadata: input.metadata || {},
      correlationId: input.correlationId || requestId || uuidv4()
    });
    const lines = await persistLines({ entry, source, lines: normalized.lines });

    await recordAudit({
      action: status === JOURNAL_STATUS.POSTED ? "gl_journal_posted" : "gl_journal_created",
      entity: entry,
      auth,
      requestId,
      reason: input.reason || "Journal entry created",
      after: normalizeJournalForApi(entry, lines)
    });

    return {
      action: "created",
      idempotent: false,
      journal: normalizeJournalForApi(entry, lines)
    };
  };

  const createManualJournal = async ({ input = {}, auth = {}, requestId = "" } = {}) => {
    const submit = Boolean(input.submit);
    return createJournal({
      input: {
        ...input,
        sourceModule: SOURCE_MODULE.MANUAL,
        sourceEntityType: "ManualJournal",
        postingType: GL_POSTING_TYPE.MANUAL_JOURNAL,
        requiresApproval: input.requiresApproval !== false,
        reason: input.reason || "Manual journal entry"
      },
      status: submit ? JOURNAL_STATUS.PENDING_APPROVAL : JOURNAL_STATUS.DRAFT,
      auth,
      requestId
    });
  };

  const loadJournalWithLines = async (journalId) => {
    const entry = await leanMaybe(JournalEntryModel.findById(journalId));
    if (!entry) throw new AppError("Journal entry not found.", 404, "GL_JOURNAL_NOT_FOUND");
    const lines = await leanMaybe(queryMaybe(JournalEntryLineModel.find({ journalEntryId: entry._id }), { sort: { accountCode: 1 } }));
    return { entry, lines: asArray(lines) };
  };

  const updateJournal = async (journalId, update) =>
    leanMaybe(JournalEntryModel.findByIdAndUpdate(journalId, { $set: update }, { new: true }));

  const assertJournalEditable = (entry) => {
    if ([JOURNAL_STATUS.POSTED, JOURNAL_STATUS.REVERSED].includes(entry.status)) {
      throw new AppError("Posted journals are immutable; create a reversal and correcting entry.", 409, "GL_POSTED_JOURNAL_IMMUTABLE");
    }
  };

  const approveJournal = async ({ journalId, auth = {}, requestId = "", override = false } = {}) => {
    const { entry, lines } = await loadJournalWithLines(journalId);
    assertJournalEditable(entry);
    if (entry.createdBy && entry.createdBy === auth?.id && !override && auth?.role !== "super_admin") {
      throw new AppError("Journal creator cannot approve this journal without a privileged override.", 403, "GL_SEGREGATION_OF_DUTIES");
    }
    if (![JOURNAL_STATUS.DRAFT, JOURNAL_STATUS.SUBMITTED, JOURNAL_STATUS.PENDING_APPROVAL].includes(entry.status)) {
      throw new AppError("Only draft or pending journals can be approved.", 409, "GL_JOURNAL_STATUS_INVALID");
    }

    const updated = await updateJournal(entry._id, {
      status: JOURNAL_STATUS.APPROVED,
      approvedBy: auth?.id || "",
      approvedAt: now()
    });
    await updateLineStatus(entry._id, JOURNAL_STATUS.APPROVED);
    await recordAudit({
      action: "gl_journal_approved",
      entity: updated,
      auth,
      requestId,
      reason: override ? "Journal approved with privileged override" : "Journal approved",
      before: normalizeJournalForApi(entry, lines),
      after: normalizeJournalForApi(updated, lines),
      metadata: { override: Boolean(override) }
    });

    return { action: "approved", journal: normalizeJournalForApi(updated, lines) };
  };

  const postJournal = async ({ journalId, auth = {}, requestId = "", override = false } = {}) => {
    const { entry, lines } = await loadJournalWithLines(journalId);
    if (entry.status === JOURNAL_STATUS.POSTED) {
      return { action: "existing", idempotent: true, journal: normalizeJournalForApi(entry, lines) };
    }
    assertJournalEditable(entry);
    if (![JOURNAL_STATUS.APPROVED, JOURNAL_STATUS.PENDING_APPROVAL, JOURNAL_STATUS.DRAFT].includes(entry.status)) {
      throw new AppError("Journal cannot be posted from its current status.", 409, "GL_JOURNAL_STATUS_INVALID");
    }
    if (entry.requiresApproval && entry.status !== JOURNAL_STATUS.APPROVED && !override) {
      throw new AppError("Journal approval is required before posting.", 409, "GL_JOURNAL_APPROVAL_REQUIRED");
    }
    await ensureOpenPeriod(entry.postingDate);

    const debit = decimalSum(lines.map((line) => line.baseCurrencyDebit));
    const credit = decimalSum(lines.map((line) => line.baseCurrencyCredit));
    if (!toDecimal(debit).equals(toDecimal(credit))) {
      throw new AppError("Journal entry is unbalanced.", 422, "GL_JOURNAL_UNBALANCED", { debit, credit });
    }

    const updated = await updateJournal(entry._id, {
      status: JOURNAL_STATUS.POSTED,
      postedBy: auth?.id || "",
      postedAt: now(),
      approvedBy: entry.approvedBy || auth?.id || "",
      approvedAt: entry.approvedAt || now()
    });
    await updateLineStatus(entry._id, JOURNAL_STATUS.POSTED);
    await recordAudit({
      action: "gl_journal_posted",
      entity: updated,
      auth,
      requestId,
      reason: override ? "Journal posted with privileged override" : "Journal posted",
      before: normalizeJournalForApi(entry, lines),
      after: normalizeJournalForApi(updated, lines),
      metadata: { override: Boolean(override) }
    });

    return { action: "posted", idempotent: false, journal: normalizeJournalForApi(updated, lines) };
  };

  const reverseJournal = async ({ journalId, reason = "", auth = {}, requestId = "" } = {}) => {
    if (!reason) throw new AppError("Reversal reason is required.", 422, "GL_REVERSAL_REASON_REQUIRED");
    const { entry, lines } = await loadJournalWithLines(journalId);
    if (entry.reversedBy) {
      const reversal = await leanMaybe(JournalEntryModel.findById(entry.reversedBy));
      const reversalLines = reversal ? await leanMaybe(JournalEntryLineModel.find({ journalEntryId: reversal._id })) : [];
      return { action: "existing", idempotent: true, journal: normalizeJournalForApi(reversal, reversalLines) };
    }
    if (entry.status !== JOURNAL_STATUS.POSTED) {
      throw new AppError("Only posted journals can be reversed.", 409, "GL_JOURNAL_NOT_POSTED");
    }

    const reversal = await createJournal({
      input: {
        entryDate: now(),
        postingDate: now(),
        sourceModule: entry.source.sourceModule,
        sourceEntityType: entry.source.sourceEntityType,
        sourceEntityId: `${entry.source.sourceEntityId}:REVERSAL`,
        sourceReference: entry.source.sourceReference,
        postingType: entry.source.postingType,
        postingKey: `${entry.source.postingKey}:REVERSAL`,
        description: `Reversal of ${entry.entryNumber}: ${reason}`,
        currency: entry.currency,
        baseCurrency: entry.baseCurrency,
        exchangeRate: entry.exchangeRate,
        reversalOf: entry._id,
        requiresApproval: false,
        reason,
        lines: lines.map((line) => ({
          accountCode: line.accountCode,
          description: `Reverse ${line.description || entry.entryNumber}`,
          debit: line.credit,
          credit: line.debit,
          businessUnit: line.businessUnit,
          costCenter: line.costCenter,
          productId: line.productId,
          channel: line.channel,
          customerId: line.customerId,
          supplierId: line.supplierId,
          agentId: line.agentId,
          bookingId: line.bookingId,
          bookingReference: line.bookingReference,
          vehicleId: line.vehicleId,
          driverId: line.driverId,
          guideId: line.guideId
        }))
      },
      status: JOURNAL_STATUS.POSTED,
      auth,
      requestId
    });

    const updatedOriginal = await updateJournal(entry._id, {
      status: JOURNAL_STATUS.REVERSED,
      reversedBy: reversal.journal.id,
      reversedAt: now()
    });
    await updateLineStatus(entry._id, JOURNAL_STATUS.REVERSED);
    await recordAudit({
      action: "gl_journal_reversed",
      entity: updatedOriginal,
      auth,
      requestId,
      reason,
      before: normalizeJournalForApi(entry, lines),
      after: {
        original: normalizeJournalForApi(updatedOriginal, lines),
        reversal: reversal.journal
      }
    });

    return { action: "reversed", journal: reversal.journal };
  };

  const postSourceEvent = async ({ event = {}, auth = {}, requestId = "" } = {}) => {
    const sourceModule = normalizeEnumToken(event.sourceModule);
    const postingType = normalizeEnumToken(event.postingType);
    const sourceEntityId = normalizeToken(event.sourceEntityId || event.sourceReference);
    const sourceReference = normalizeToken(event.sourceReference || sourceEntityId);
    const postingKey = normalizeToken(event.postingKey || buildPostingKey({ sourceModule, sourceEntityId, sourceReference, postingType }));
    return createJournal({
      input: {
        ...event,
        sourceModule,
        sourceEntityType: event.sourceEntityType || postingType,
        sourceEntityId,
        sourceReference,
        postingType,
        postingKey,
        requiresApproval: false
      },
      status: JOURNAL_STATUS.POSTED,
      auth,
      requestId
    });
  };

  const postCustomerInvoice = async () => {
    throw new AppError("Invoice-gross recognition is disabled; use verified service revenue recognition.", 409, "SERVICE_REVENUE_RECOGNITION_REQUIRED");
  };

  const postCustomerPayment = async ({ payment = {}, auth = {}, requestId = "", postingKey = "" } = {}) => {
    const amount = money(payment.accountingAmount || payment.amountPaid || payment.paidAmount || payment.amount || 0, { allowNegative: false, field: "payment.amount" });
    const fee = money(payment.providerFeeAmount || 0, { allowNegative: false, field: "payment.providerFee" });
    const currency = requireCurrency(payment.accountingCurrency || payment.currency || payment.orderCurrency || "USD");
    const clearingKey = providerMappingKey(payment.provider || payment.paymentProvider || payment.providerName);
    if (!clearingKey) throw new AppError("A provider-specific clearing mapping is required.", 409, "GL_CLEARING_MAPPING_REQUIRED");
    const lines = [
      { mappingKey: clearingKey, debit: amount, bookingReference: payment.bookingReference },
      { mappingKey: GL_MAPPING_KEY.ACCOUNTS_RECEIVABLE, credit: amount, bookingReference: payment.bookingReference }
    ];
    if (isPositive(fee)) {
      lines.push(
        { mappingKey: GL_MAPPING_KEY.PAYMENT_PROVIDER_FEE, debit: fee, bookingReference: payment.bookingReference },
        { mappingKey: clearingKey, credit: fee, bookingReference: payment.bookingReference }
      );
    }
    return postSourceEvent({
      event: {
        sourceModule: SOURCE_MODULE.PAYMENT,
        sourceEntityType: "Payment",
        sourceEntityId: normalizeId(payment._id) || payment.intentId || payment.orderTrackingId,
        sourceReference: payment.intentId || payment.orderTrackingId || payment.bookingReference,
        postingType: GL_POSTING_TYPE.CUSTOMER_PAYMENT,
        postingKey,
        postingDate: payment.paidAt || payment.verifiedAt || payment.createdAt,
        description: `Customer payment posted for ${payment.bookingReference || payment.intentId}`,
        currency,
        lines,
        sourceSnapshot: { payment }
      },
      auth,
      requestId
    });
  };

  const postProviderSettlement = async ({ settlement = {}, auth = {}, requestId = "" } = {}) => {
    const amount = money(settlement.amount || 0, { allowNegative: false, field: "settlement.amount" });
    const fee = settlement.feeAlreadyPosted
      ? MONEY_ZERO
      : money(settlement.fee || 0, { allowNegative: false, field: "settlement.fee" });
    const clearingCredit = decimalSum([amount, fee]);
    const currency = requireCurrency(settlement.currency || "USD");
    const clearingKey = providerMappingKey(settlement.provider);
    if (!clearingKey) throw new AppError("A provider-specific clearing mapping is required.", 409, "GL_CLEARING_MAPPING_REQUIRED");
    const lines = [
      { mappingKey: GL_MAPPING_KEY.BANK, debit: amount },
      { mappingKey: clearingKey, credit: clearingCredit }
    ];
    if (isPositive(fee)) lines.push({ mappingKey: GL_MAPPING_KEY.PAYMENT_PROVIDER_FEE, debit: fee });
    return postSourceEvent({
      event: {
        sourceModule: SOURCE_MODULE.CASH_MOVEMENT,
        sourceEntityType: "ProviderSettlement",
        sourceEntityId: settlement.id || settlement.reference || uuidv4(),
        sourceReference: settlement.reference || "",
        postingType: GL_POSTING_TYPE.PROVIDER_SETTLEMENT,
        postingDate: settlement.settledAt || settlement.postingDate || settlement.createdAt,
        description: `Provider settlement ${settlement.provider || ""}`.trim(),
        currency,
        lines,
        sourceSnapshot: { settlement }
      },
      auth,
      requestId
    });
  };

  const postRefundApproval = async ({ refund = {}, auth = {}, requestId = "" } = {}) => {
    const amount = money(refund.approvedAmount || refund.requestedAmount || refund.amount || 0, { allowNegative: false, field: "refund.amount" });
    const currency = requireCurrency(refund.currency || "USD");
    return postSourceEvent({
      event: {
        sourceModule: SOURCE_MODULE.REFUND,
        sourceEntityType: "Refund",
        sourceEntityId: normalizeId(refund._id) || refund.refundReference,
        sourceReference: refund.refundReference || refund.bookingReference,
        postingType: GL_POSTING_TYPE.REFUND_APPROVAL,
        postingDate: refund.approvedAt || refund.requestedAt || refund.createdAt,
        description: `Refund approved for ${refund.bookingReference || refund.refundReference}`,
        currency,
        lines: [
          { mappingKey: GL_MAPPING_KEY.REFUND_ALLOWANCE, debit: amount, bookingReference: refund.bookingReference },
          { mappingKey: GL_MAPPING_KEY.REFUND_PAYABLE, credit: amount, bookingReference: refund.bookingReference }
        ],
        sourceSnapshot: { refund }
      },
      auth,
      requestId
    });
  };

  const postRefundCompletion = async ({ refund = {}, auth = {}, requestId = "" } = {}) => {
    const amount = money(refund.confirmedRefundedAmount || refund.amountRefunded || refund.amount || 0, { allowNegative: false, field: "refund.confirmedAmount" });
    const currency = requireCurrency(refund.currency || "USD");
    const clearingKey = providerMappingKey(refund.provider);
    if (!clearingKey) throw new AppError("A provider-specific clearing mapping is required.", 409, "GL_CLEARING_MAPPING_REQUIRED");
    return postSourceEvent({
      event: {
        sourceModule: SOURCE_MODULE.REFUND,
        sourceEntityType: "Refund",
        sourceEntityId: `${normalizeId(refund._id) || refund.refundReference}:COMPLETED`,
        sourceReference: refund.refundReference || refund.bookingReference,
        postingType: GL_POSTING_TYPE.REFUND_COMPLETION,
        postingDate: refund.refundedAt || refund.completedAt || refund.updatedAt,
        description: `Refund completed for ${refund.bookingReference || refund.refundReference}`,
        currency,
        lines: [
          { mappingKey: GL_MAPPING_KEY.REFUND_PAYABLE, debit: amount, bookingReference: refund.bookingReference },
          { mappingKey: clearingKey, credit: amount, bookingReference: refund.bookingReference }
        ],
        sourceSnapshot: { refund }
      },
      auth,
      requestId
    });
  };

  const postBusinessExpense = async ({ expense = {}, auth = {}, requestId = "" } = {}) => {
    const amount = money(expense.baseCurrencyAmount || expense.amount || 0, { allowNegative: false, field: "expense.amount" });
    const currency = requireCurrency(expense.baseCurrency || expense.currency || "USD");
    const isBookingExpense = normalizeEnumToken(expense.accountingScope) === "BOOKING_ACCOUNTING";
    const creditKey = GL_MAPPING_KEY.ACCOUNTS_PAYABLE;
    const debitKey = isBookingExpense ? GL_MAPPING_KEY.SUPPLIER_DIRECT_COST : expenseMappingKey(expense.category);
    const expenseId = normalizeId(expense._id) || expense.expenseReference;
    const canonicalPostingKey = `expense-recognition:${expenseId}:v1`;
    return postSourceEvent({
      event: {
        sourceModule: isBookingExpense ? SOURCE_MODULE.BOOKING_ACCOUNTING : SOURCE_MODULE.BUSINESS_ACCOUNTING,
        sourceEntityType: "BusinessExpense",
        sourceEntityId: expenseId,
        sourceReference: expense.expenseReference || "",
        postingType: GL_POSTING_TYPE.BUSINESS_EXPENSE,
        postingKey: canonicalPostingKey,
        postingDate: expense.expenseDate || expense.transactionDate || expense.createdAt,
        description: expense.description || `Business expense ${expense.expenseReference || ""}`.trim(),
        currency,
        lines: [
          { mappingKey: debitKey, debit: amount, supplierId: expense.supplier?.supplierId || "", bookingId: expense.bookingId, bookingReference: expense.bookingReference },
          { mappingKey: creditKey, credit: amount, supplierId: expense.supplier?.supplierId || "" }
        ],
        sourceSnapshot: { expense },
        metadata: { canonicalExpensePosting: true, canonicalPostingKey }
      },
      auth,
      requestId
    });
  };

  const postSupplierPayment = async ({ payment = {}, auth = {}, requestId = "" } = {}) => {
    const amount = money(payment.baseCurrencyAmount || payment.amount || 0, { allowNegative: false, field: "supplierPayment.amount" });
    const currency = requireCurrency(payment.baseCurrency || payment.currency || "USD");
    const paymentId = normalizeId(payment._id) || payment.paymentReference;
    const postingKey = `supplier-payment:${paymentId}:v1`;
    return postSourceEvent({
      event: {
        sourceModule: SOURCE_MODULE.BUSINESS_ACCOUNTING,
        sourceEntityType: "SupplierPayment",
        sourceEntityId: paymentId,
        sourceReference: payment.paymentReference || "",
        postingType: GL_POSTING_TYPE.BUSINESS_EXPENSE_PAYMENT,
        postingKey,
        postingDate: payment.paymentDate || payment.createdAt,
        description: payment.description || `Supplier payment ${payment.paymentReference || ""}`.trim(),
        currency,
        lines: [
          { mappingKey: GL_MAPPING_KEY.ACCOUNTS_PAYABLE, debit: amount, supplierId: payment.supplierId || "" },
          { mappingKey: payment.paymentSourceMappingKey || GL_MAPPING_KEY.BANK, credit: amount, supplierId: payment.supplierId || "" }
        ],
        sourceSnapshot: { payment },
        metadata: { canonicalSupplierPayment: true, postingKey }
      },
      auth,
      requestId
    });
  };

  const postBusinessIncome = async ({ income = {}, auth = {}, requestId = "" } = {}) => {
    const amount = money(income.baseCurrencyAmount || income.amount || 0, { allowNegative: false, field: "income.amount" });
    const currency = requireCurrency(income.baseCurrency || income.currency || "USD");
    return postSourceEvent({
      event: {
        sourceModule: SOURCE_MODULE.BUSINESS_ACCOUNTING,
        sourceEntityType: "BusinessIncome",
        sourceEntityId: normalizeId(income._id) || income.incomeReference,
        sourceReference: income.incomeReference || "",
        postingType: GL_POSTING_TYPE.BUSINESS_INCOME,
        postingDate: income.transactionDate || income.createdAt,
        description: income.description || `Business income ${income.incomeReference || ""}`.trim(),
        currency,
        lines: [
          { mappingKey: GL_MAPPING_KEY.BANK, debit: amount },
          { mappingKey: GL_MAPPING_KEY.OTHER_INCOME, credit: amount }
        ],
        sourceSnapshot: { income }
      },
      auth,
      requestId
    });
  };

  const postOwnerCapital = async ({ amount, currency = "USD", reference = "", drawing = false, auth = {}, requestId = "" } = {}) => {
    const normalizedAmount = money(amount || 0, { allowNegative: false, field: "owner.amount" });
    const normalizedCurrency = requireCurrency(currency);
    return postSourceEvent({
      event: {
        sourceModule: SOURCE_MODULE.MANUAL,
        sourceEntityType: drawing ? "OwnerDrawing" : "OwnerCapital",
        sourceEntityId: reference || uuidv4(),
        sourceReference: reference,
        postingType: drawing ? GL_POSTING_TYPE.OWNER_DRAWING : GL_POSTING_TYPE.OWNER_CAPITAL_INJECTION,
        description: drawing ? "Owner drawing" : "Owner capital injection",
        currency: normalizedCurrency,
        lines: drawing
          ? [
              { mappingKey: GL_MAPPING_KEY.OWNER_DRAWING, debit: normalizedAmount },
              { mappingKey: GL_MAPPING_KEY.BANK, credit: normalizedAmount }
            ]
          : [
              { mappingKey: GL_MAPPING_KEY.BANK, debit: normalizedAmount },
              { mappingKey: GL_MAPPING_KEY.OWNER_CAPITAL, credit: normalizedAmount }
            ],
        sourceSnapshot: { amount: normalizedAmount, currency: normalizedCurrency, reference, drawing }
      },
      auth,
      requestId
    });
  };

  const listJournals = async ({
    status = "",
    sourceModule = "",
    fromDate = "",
    toDate = "",
    search = "",
    createdBy = "",
    postedBy = "",
    currency = "",
    tab = "",
    includeLines = false,
    page = 1,
    limit = DEFAULT_JOURNAL_LIMIT,
    sortBy = "postingDate",
    sortDirection = "desc"
  } = {}) => {
    const query = {};
    const normalizedStatus = normalizeEnumToken(status);
    const normalizedTab = normalizeToken(tab).toLowerCase();
    if (normalizedTab === "posted") query.status = JOURNAL_STATUS.POSTED;
    else if (normalizedTab === "draft") query.status = { $in: [JOURNAL_STATUS.DRAFT, JOURNAL_STATUS.SUBMITTED, JOURNAL_STATUS.PENDING_APPROVAL, JOURNAL_STATUS.APPROVED] };
    else if (normalizedStatus) query.status = normalizedStatus;
    if (sourceModule) query["source.sourceModule"] = normalizeEnumToken(sourceModule);
    if (createdBy) query.createdBy = normalizeToken(createdBy);
    if (postedBy) query.postedBy = normalizeToken(postedBy);
    if (currency) query.currency = requireCurrency(currency);
    if (fromDate || toDate) {
      query.postingDate = {};
      if (fromDate) query.postingDate.$gte = normalizeDate(fromDate);
      if (toDate) query.postingDate.$lte = normalizeDate(toDate);
    }
    if (search) {
      const expression = new RegExp(escapeRegex(search), "i");
      const lineMatches = await leanMaybe(queryMaybe(JournalEntryLineModel.find({
        $or: [
          { accountCode: expression },
          { accountName: expression },
          { description: expression }
        ]
      }), { limit: 1000 }));
      const journalIds = asArray(lineMatches).map((line) => line.journalEntryId).filter(Boolean);
      const entryNumbers = asArray(lineMatches).map((line) => line.entryNumber).filter(Boolean);
      query.$or = [
        { entryNumber: expression },
        { description: expression },
        { "source.sourceReference": expression },
        { "source.sourceEntityId": expression },
        { currency: expression },
        ...(journalIds.length ? [{ _id: { $in: journalIds } }] : []),
        ...(entryNumbers.length ? [{ entryNumber: { $in: entryNumbers } }] : [])
      ];
    }

    const allRowsRaw = await leanMaybe(queryMaybe(JournalEntryModel.find(query), { sort: { postingDate: -1, entryNumber: -1 } }));
    const allRows = asArray(allRowsRaw);
    const problemFiltered = normalizedTab === "problems" ? allRows.filter(journalHasProblem) : allRows;
    const sorted = sortJournalRows(problemFiltered, { sortBy, sortDirection });
    const normalizedPage = parsePositiveInt(page, 1);
    const normalizedLimit = parsePositiveInt(limit, DEFAULT_JOURNAL_LIMIT, { min: 1, max: MAX_JOURNAL_LIMIT });
    const skip = (normalizedPage - 1) * normalizedLimit;
    const rows = sorted.slice(skip, skip + normalizedLimit);
    const linesByJournal = new Map();
    if (includeLines && rows.length) {
      for (const entry of rows) {
        const lines = await leanMaybe(queryMaybe(JournalEntryLineModel.find({ journalEntryId: entry._id }), { sort: { accountCode: 1 } }));
        linesByJournal.set(normalizeId(entry._id), asArray(lines));
      }
    }
    const summary = summarizeJournalRows(problemFiltered);
    const total = problemFiltered.length;
    const pages = Math.max(1, Math.ceil(total / normalizedLimit));
    return {
      items: asArray(rows).map((row) => {
        const lines = linesByJournal.get(normalizeId(row._id)) || [];
        const normalized = normalizeJournalForApi(row, lines);
        return {
          ...normalized,
          statusLabel: statusLabel(normalized.status),
          sourceLabel: sourceLabel(normalized.sourceModule),
          balanced: toDecimal(normalized.baseTotalDebit || 0).equals(toDecimal(normalized.baseTotalCredit || 0)),
          difference: journalDifference(row),
          needsAttention: journalHasProblem(row)
        };
      }),
      count: rows.length,
      total,
      pagination: {
        page: normalizedPage,
        limit: normalizedLimit,
        total,
        pages,
        from: total ? skip + 1 : 0,
        to: Math.min(skip + rows.length, total),
        hasPrevious: normalizedPage > 1,
        hasNext: normalizedPage < pages
      },
      summary,
      sources: summary.bySource,
      sort: {
        by: ["postingDate", "entryDate", "entryNumber", "status", "baseTotalDebit", "baseTotalCredit", "createdAt"].includes(sortBy) ? sortBy : "postingDate",
        direction: String(sortDirection).toLowerCase() === "asc" ? "asc" : "desc"
      },
      filters: {
        status: normalizedStatus,
        sourceModule: normalizeEnumToken(sourceModule),
        fromDate,
        toDate,
        search: normalizeToken(search),
        createdBy,
        postedBy,
        currency: normalizeEnumToken(currency),
        tab: normalizedTab,
        includeLines: Boolean(includeLines),
        page: normalizedPage,
        limit: normalizedLimit
      }
    };
  };

  const allPostedLines = async () => {
    const rows = await leanMaybe(queryMaybe(JournalEntryLineModel.find({}), { sort: { postingDate: 1, entryNumber: 1 } }));
    return asArray(rows).filter((line) => POSTED_LINE_STATUSES.has(line.journalStatus));
  };

  const lineInRange = (line, fromDate, toDate) => {
    const date = new Date(line.postingDate);
    if (fromDate && date < normalizeDate(fromDate)) return false;
    if (toDate && date > normalizeDate(toDate)) return false;
    return true;
  };

  const getGeneralLedger = async ({
    accountCode = "",
    accountId = "",
    sourceModule = "",
    journal = "",
    entryNumber = "",
    user = "",
    search = "",
    fromDate = "",
    toDate = "",
    page = 1,
    limit = DEFAULT_LEDGER_LIMIT,
    sortBy = "postingDate",
    sortDirection = "desc"
  } = {}) => {
    const normalizedAccountCode = normalizeEnumToken(accountCode);
    const normalizedSourceModule = normalizeEnumToken(sourceModule);
    const normalizedJournal = normalizeToken(journal || entryNumber);
    const normalizedSearch = normalizeToken(search);
    const normalizedUser = normalizeToken(user);
    const normalizedPage = parsePositiveInt(page, 1);
    const normalizedLimit = parsePositiveInt(limit, DEFAULT_LEDGER_LIMIT, { min: 1, max: MAX_LEDGER_LIMIT });
    const hasAccountContext = Boolean(normalizedAccountCode || accountId);
    let allowedJournalNumbers = null;
    let searchJournalNumbers = null;

    if (normalizedUser) {
      const userJournals = await leanMaybe(queryMaybe(JournalEntryModel.find({
        status: { $in: Array.from(POSTED_LINE_STATUSES) },
        $or: [
          { createdBy: normalizedUser },
          { approvedBy: normalizedUser },
          { postedBy: normalizedUser }
        ]
      }), { limit: MAX_LEDGER_LIMIT }));
      allowedJournalNumbers = new Set(asArray(userJournals).map((entry) => entry.entryNumber).filter(Boolean));
    }

    if (normalizedSearch) {
      const expression = new RegExp(escapeRegex(normalizedSearch), "i");
      const matchingJournals = await leanMaybe(queryMaybe(JournalEntryModel.find({
        status: { $in: Array.from(POSTED_LINE_STATUSES) },
        $or: [
          { entryNumber: expression },
          { description: expression },
          { "source.sourceReference": expression },
          { "source.sourceEntityId": expression }
        ]
      }), { limit: MAX_LEDGER_LIMIT }));
      searchJournalNumbers = new Set(asArray(matchingJournals).map((entry) => entry.entryNumber).filter(Boolean));
    }

    const allLines = await allPostedLines();
    const accountScopedLines = allLines
      .filter((line) => (!normalizedAccountCode || line.accountCode === normalizedAccountCode))
      .filter((line) => (!accountId || normalizeId(line.accountId) === normalizeId(accountId)));
    const openingLines = hasAccountContext && fromDate
      ? accountScopedLines.filter((line) => new Date(line.postingDate) < normalizeDate(fromDate))
      : [];

    const searchable = normalizedSearch ? new RegExp(escapeRegex(normalizedSearch), "i") : null;
    const periodLines = accountScopedLines
      .filter((line) => (!normalizedSourceModule || normalizeEnumToken(line.sourceModule) === normalizedSourceModule))
      .filter((line) => (!normalizedJournal || line.entryNumber === normalizedJournal))
      .filter((line) => (!allowedJournalNumbers || allowedJournalNumbers.has(line.entryNumber)))
      .filter((line) => lineInRange(line, fromDate, toDate))
      .filter((line) => {
        if (!searchable) return true;
        return searchJournalNumbers?.has(line.entryNumber) || [
          line.accountCode,
          line.accountName,
          line.entryNumber,
          line.sourceReference,
          line.description,
          line.sourceEntityId,
          line.postingKey
        ].some((value) => searchable.test(String(value || "")));
      });

    const summary = summarizeLedgerLines(periodLines);
    const trend = buildLedgerTrend(periodLines, { fromDate, toDate });
    const topAccounts = topAccountsFromLedgerLines(periodLines, 5);
    const chronologicalAccountLines = hasAccountContext
      ? sortLedgerRows(periodLines, { sortBy: "postingDate", sortDirection: "asc" })
      : [];
    const runningByLine = new Map();
    let running = openingLines.reduce((total, line) => total.plus(ledgerLineSignedBalance(line)), new Decimal(0));
    chronologicalAccountLines.forEach((line) => {
      running = running.plus(ledgerLineSignedBalance(line));
      runningByLine.set(normalizeId(line._id) || `${line.entryNumber}:${line.accountCode}:${line.postingDate}`, running.toFixed());
    });

    const effectiveSortDirection = hasAccountContext ? "asc" : sortDirection;
    const sorted = sortLedgerRows(periodLines, { sortBy, sortDirection: effectiveSortDirection });
    const skip = (normalizedPage - 1) * normalizedLimit;
    const paged = sorted.slice(skip, skip + normalizedLimit);
    const total = periodLines.length;
    const pages = Math.max(1, Math.ceil(total / normalizedLimit));
    const baseCurrency = summary.baseCurrencies.length === 1 ? summary.baseCurrencies[0] : "";
    const accountOpening = openingLines.reduce((total, line) => total.plus(ledgerLineSignedBalance(line)), new Decimal(0));
    const accountDebits = decimalSum(periodLines.map((line) => line.baseCurrencyDebit || 0));
    const accountCredits = decimalSum(periodLines.map((line) => line.baseCurrencyCredit || 0));
    const accountClosing = accountOpening.plus(
      periodLines.reduce((total, line) => total.plus(ledgerLineSignedBalance(line)), new Decimal(0))
    );
    const firstAccountLine = accountScopedLines[0] || {};

    return {
      items: paged.map((line) => {
        const normalized = normalizeLineForApi(line);
        return {
          ...normalized,
          sourceLabel: sourceLabel(normalized.sourceModule),
          amount: ledgerLineActivityAmount(line).toFixed(),
          runningBalance: hasAccountContext
            ? runningByLine.get(normalizeId(line._id) || `${line.entryNumber}:${line.accountCode}:${line.postingDate}`) || "0"
            : null
        };
      }),
      count: paged.length,
      total,
      pagination: {
        page: normalizedPage,
        limit: normalizedLimit,
        total,
        pages,
        from: total ? skip + 1 : 0,
        to: Math.min(skip + paged.length, total),
        hasPrevious: normalizedPage > 1,
        hasNext: normalizedPage < pages
      },
      summary: {
        ...summary,
        baseCurrency,
        mixedBaseCurrencies: summary.baseCurrencies.length > 1
      },
      trend,
      topAccounts,
      accountSummary: hasAccountContext
        ? {
            accountCode: firstAccountLine.accountCode || normalizedAccountCode,
            accountName: firstAccountLine.accountName || "",
            accountType: firstAccountLine.accountType || "",
            normalBalance: isDebitNormalAccount(firstAccountLine.accountType) ? "DEBIT" : "CREDIT",
            openingBalance: accountOpening.toFixed(),
            periodDebit: accountDebits,
            periodCredit: accountCredits,
            closingBalance: accountClosing.toFixed(),
            baseCurrency: firstAccountLine.baseCurrency || baseCurrency
          }
        : null,
      filters: {
        accountCode: normalizedAccountCode,
        accountId,
        sourceModule: normalizedSourceModule,
        journal: normalizedJournal,
        user: normalizedUser,
        search: normalizedSearch,
        fromDate,
        toDate,
        page: normalizedPage,
        limit: normalizedLimit
      },
      sort: {
        by: ["postingDate", "entryNumber", "accountCode", "baseCurrencyDebit", "baseCurrencyCredit", "sourceReference"].includes(sortBy) ? sortBy : "postingDate",
        direction: String(effectiveSortDirection).toLowerCase() === "asc" ? "asc" : "desc"
      }
    };
  };

  const getCashBankDashboard = async ({
    fromDate = "",
    toDate = "",
    search = "",
    accountCode = "",
    direction = "all",
    postingType = "",
    sourceModule = "",
    currency = "",
    page = 1,
    limit = 10,
    sortBy = "postingDate",
    sortDirection = "desc"
  } = {}) => {
    const accountsLoaded = await leanMaybe(ChartOfAccountModel.find({ active: true }));
    const cashAccounts = asArray(accountsLoaded).filter((account) => CASH_ACCOUNT_SUBTYPES.has(account.subtype));
    const cashCodes = new Set(cashAccounts.map((account) => account.code));
    const allLines = await allPostedLines();
    const endDate = toDate ? normalizeDate(toDate) : now();
    if (toDate && /^\d{4}-\d{2}-\d{2}$/.test(String(toDate))) {
      endDate.setUTCHours(23, 59, 59, 999);
    }
    const asOfLines = allLines.filter((line) => cashCodes.has(line.accountCode) && new Date(line.postingDate) <= endDate);
    const periodStart = fromDate ? normalizeDate(fromDate) : null;
    const periodLines = asOfLines.filter((line) => {
      const date = new Date(line.postingDate);
      return (!periodStart || date >= periodStart) && date <= endDate;
    });
    const linesByJournal = new Map();
    allLines.forEach((line) => {
      const key = line.entryNumber || normalizeId(line.journalEntryId);
      if (!linesByJournal.has(key)) linesByJournal.set(key, []);
      linesByJournal.get(key).push(line);
    });
    const transferJournal = (line) => {
      if (line.postingType === GL_POSTING_TYPE.PROVIDER_SETTLEMENT) return true;
      const journalLines = linesByJournal.get(line.entryNumber || normalizeId(line.journalEntryId)) || [];
      const cashLegs = journalLines.filter((candidate) => cashCodes.has(candidate.accountCode));
      return cashLegs.length >= 2 && journalLines.every((candidate) => cashCodes.has(candidate.accountCode));
    };
    const balances = cashAccounts.map((account) => {
      const accountLines = asOfLines.filter((line) => line.accountCode === account.code);
      const originalCurrencies = Array.from(new Set(accountLines.map((line) => normalizeCurrency(line.currency)).filter(Boolean)));
      const baseCurrencies = Array.from(new Set(accountLines.map((line) => normalizeCurrency(line.baseCurrency)).filter(Boolean)));
      const configuredCurrency = normalizeCurrency(account.currency);
      const canUseOriginal = originalCurrencies.length <= 1 && (!configuredCurrency || !originalCurrencies[0] || configuredCurrency === originalCurrencies[0]);
      const balanceCurrency = canUseOriginal
        ? (configuredCurrency || originalCurrencies[0] || baseCurrencies[0] || "")
        : (baseCurrencies.length === 1 ? baseCurrencies[0] : "");
      const balance = accountLines.reduce((total, line) => total.plus(
        canUseOriginal
          ? toDecimal(line.debit || 0).minus(toDecimal(line.credit || 0))
          : toDecimal(line.baseCurrencyDebit || 0).minus(toDecimal(line.baseCurrencyCredit || 0))
      ), new Decimal(0));
      return {
        id: normalizeId(account._id),
        code: account.code,
        name: account.name,
        subtype: account.subtype,
        typeLabel: account.subtype === GL_ACCOUNT_SUBTYPE.PROVIDER_CLEARING ? "Gateway Clearing" : labelizeToken(account.subtype),
        currency: balanceCurrency,
        balance: balanceCurrency || !accountLines.length ? balance.toFixed() : null,
        hasActivity: accountLines.length > 0,
        active: account.active !== false,
        reconciliation: {
          status: "UNAVAILABLE",
          statementBalance: null,
          difference: null,
          reason: "No bank statement or provider statement balance is stored for this account."
        }
      };
    });
    const balanceCurrencies = Array.from(new Set(balances.map((row) => row.currency).filter(Boolean)));
    const balanceTotals = balanceCurrencies.map((currencyCode) => ({
      currency: currencyCode,
      amount: balances.filter((row) => row.currency === currencyCode).reduce((sum, row) => sum.plus(toDecimal(row.balance || 0)), new Decimal(0)).toFixed()
    }));

    const decorated = periodLines.map((line) => {
      const transfer = transferJournal(line);
      const inflow = toDecimal(line.baseCurrencyDebit || 0);
      const outflow = toDecimal(line.baseCurrencyCredit || 0);
      return {
        ...normalizeLineForApi(line),
        id: normalizeId(line._id) || `${line.entryNumber}:${line.accountCode}:${line.postingDate}`,
        transactionType: transfer ? "INTERNAL_TRANSFER" : line.postingType || line.sourceModule || "CASH_MOVEMENT",
        typeLabel: transfer ? "Internal Transfer" : labelizeToken(line.postingType || line.sourceModule || "Cash Movement"),
        direction: transfer ? "transfer" : inflow.greaterThan(0) ? "inflow" : "outflow",
        inflow: inflow.toFixed(),
        outflow: outflow.toFixed(),
        amount: inflow.plus(outflow).toFixed(),
        balanceAfterTransaction: null,
        isInternalTransfer: transfer,
        reconciliationStatus: "UNRECONCILED"
      };
    });
    const normalizedSearch = normalizeToken(search).toLowerCase();
    const normalizedAccount = normalizeEnumToken(accountCode);
    const normalizedDirection = normalizeToken(direction).toLowerCase();
    const normalizedPostingType = normalizeEnumToken(postingType);
    const normalizedSource = normalizeEnumToken(sourceModule);
    const normalizedCurrency = normalizeCurrency(currency);
    const baseFiltered = decorated.filter((row) => {
      if (normalizedAccount && row.accountCode !== normalizedAccount) return false;
      if (normalizedPostingType && row.postingType !== normalizedPostingType) return false;
      if (normalizedSource && row.sourceModule !== normalizedSource) return false;
      if (normalizedCurrency && normalizeCurrency(row.baseCurrency) !== normalizedCurrency) return false;
      if (!normalizedSearch) return true;
      return [row.sourceReference, row.description, row.accountCode, row.accountName, row.entryNumber, row.bookingReference, row.amount]
        .some((value) => String(value || "").toLowerCase().includes(normalizedSearch));
    });
    const tabCounts = {
      all: baseFiltered.length,
      inflows: baseFiltered.filter((row) => row.direction === "inflow").length,
      outflows: baseFiltered.filter((row) => row.direction === "outflow").length,
      transfers: baseFiltered.filter((row) => row.direction === "transfer").length
    };
    const filtered = baseFiltered.filter((row) => normalizedDirection === "all" || !normalizedDirection || row.direction === normalizedDirection);
    if (normalizedAccount) {
      const opening = asOfLines
        .filter((line) => line.accountCode === normalizedAccount && fromDate && new Date(line.postingDate) < normalizeDate(fromDate))
        .reduce((sum, line) => sum.plus(toDecimal(line.baseCurrencyDebit || 0)).minus(toDecimal(line.baseCurrencyCredit || 0)), new Decimal(0));
      let running = opening;
      [...filtered].sort((left, right) => lineDateValue(left) - lineDateValue(right)).forEach((row) => {
        running = running.plus(toDecimal(row.inflow)).minus(toDecimal(row.outflow));
        row.balanceAfterTransaction = running.toFixed();
      });
    }
    const economicRows = baseFiltered.filter((row) => !row.isInternalTransfer);
    const movementCurrencies = Array.from(new Set(economicRows.map((row) => normalizeCurrency(row.baseCurrency)).filter(Boolean)));
    const movementTotals = movementCurrencies.map((currencyCode) => {
      const rows = economicRows.filter((row) => normalizeCurrency(row.baseCurrency) === currencyCode);
      const inflow = rows.reduce((sum, row) => sum.plus(toDecimal(row.inflow)), new Decimal(0));
      const outflow = rows.reduce((sum, row) => sum.plus(toDecimal(row.outflow)), new Decimal(0));
      return { currency: currencyCode, inflow: inflow.toFixed(), outflow: outflow.toFixed(), net: inflow.minus(outflow).toFixed() };
    });
    const span = fromDate && toDate ? Math.abs(normalizeDate(toDate) - normalizeDate(fromDate)) / 86400000 : 365;
    const trendMap = new Map();
    economicRows.forEach((row) => {
      const date = new Date(row.postingDate);
      const bucket = span > 62 ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}` : date.toISOString().slice(0, 10);
      const rowCurrency = normalizeCurrency(row.baseCurrency);
      const key = `${rowCurrency}:${bucket}`;
      const existing = trendMap.get(key) || { bucket, currency: rowCurrency, inflow: new Decimal(0), outflow: new Decimal(0) };
      existing.inflow = existing.inflow.plus(toDecimal(row.inflow));
      existing.outflow = existing.outflow.plus(toDecimal(row.outflow));
      trendMap.set(key, existing);
    });
    const trend = Array.from(trendMap.values()).sort((left, right) => left.bucket.localeCompare(right.bucket)).map((row) => ({ bucket: row.bucket, currency: row.currency, inflow: row.inflow.toFixed(), outflow: row.outflow.toFixed(), net: row.inflow.minus(row.outflow).toFixed() }));
    const sortField = ["postingDate", "sourceReference", "accountCode", "postingType", "inflow", "outflow"].includes(sortBy) ? sortBy : "postingDate";
    const directionMultiplier = String(sortDirection).toLowerCase() === "asc" ? 1 : -1;
    filtered.sort((left, right) => {
      if (sortField === "postingDate") return (lineDateValue(left) - lineDateValue(right)) * directionMultiplier;
      if (["inflow", "outflow"].includes(sortField)) return toDecimal(left[sortField]).minus(toDecimal(right[sortField])).toNumber() * directionMultiplier;
      return String(left[sortField] || "").localeCompare(String(right[sortField] || ""), "en", { numeric: true }) * directionMultiplier;
    });
    const safePage = parsePositiveInt(page, 1);
    const safeLimit = parsePositiveInt(limit, 10, { min: 1, max: 100 });
    const skip = (safePage - 1) * safeLimit;
    const pages = Math.max(1, Math.ceil(filtered.length / safeLimit));
    const mixedBalances = balanceTotals.length > 1 || balances.some((row) => row.hasActivity && !row.currency);
    const mixedMovements = movementTotals.length > 1;

    return {
      accounts: balances.sort((left, right) => toDecimal(right.balance || 0).minus(toDecimal(left.balance || 0)).toNumber()),
      items: filtered.slice(skip, skip + safeLimit),
      recentTransactions: [...baseFiltered].sort((left, right) => lineDateValue(right) - lineDateValue(left)).slice(0, 5),
      pagination: { page: safePage, limit: safeLimit, total: filtered.length, pages, from: filtered.length ? skip + 1 : 0, to: Math.min(skip + safeLimit, filtered.length), hasPrevious: safePage > 1, hasNext: safePage < pages },
      summary: {
        totalBalance: mixedBalances ? null : (balanceTotals[0]?.amount || "0"),
        reportingCurrency: mixedBalances ? "" : (balanceTotals[0]?.currency || ""),
        balanceTotals,
        inflow: mixedMovements ? null : (movementTotals[0]?.inflow || "0"),
        outflow: mixedMovements ? null : (movementTotals[0]?.outflow || "0"),
        netCashFlow: mixedMovements ? null : (movementTotals[0]?.net || "0"),
        movementTotals,
        activeAccounts: balances.length,
        bankAccounts: balances.filter((row) => row.subtype === GL_ACCOUNT_SUBTYPE.BANK).length,
        cashAccounts: balances.filter((row) => row.subtype === GL_ACCOUNT_SUBTYPE.CASH).length,
        clearingAccounts: balances.filter((row) => row.subtype === GL_ACCOUNT_SUBTYPE.PROVIDER_CLEARING).length,
        mixedCurrencies: mixedBalances || mixedMovements,
        inflowRule: "Posted cash-account debits excluding internal transfers and provider settlements.",
        outflowRule: "Posted cash-account credits excluding internal transfers and provider settlements."
      },
      tabCounts,
      trend,
      reconciliation: {
        status: "UNAVAILABLE",
        reason: "Bank and provider statement balances are not persisted, so GL-to-statement reconciliation cannot be asserted."
      },
      filterOptions: {
        accounts: balances.map((row) => ({ code: row.code, name: row.name, subtype: row.subtype, currency: row.currency })),
        postingTypes: Array.from(new Set(decorated.map((row) => row.postingType).filter(Boolean))).sort()
      },
      capabilities: {
        createTransaction: false,
        createTransactionReason: "Use the source payment, expense, refund or approved journal workflow.",
        transfer: false,
        transferReason: "A dedicated transfer workflow with period-close and approval controls is not implemented.",
        reconcileStatement: false
      }
    };
  };

  const summarizeAccounts = async ({ fromDate = "", toDate = "" } = {}) => {
    const allLines = await allPostedLines();
    const openingLines = allLines.filter((line) => fromDate && new Date(line.postingDate) < normalizeDate(fromDate));
    const periodLines = allLines.filter((line) => lineInRange(line, fromDate, toDate));
    const accounts = new Map();

    const ensure = (line) => {
      const key = line.accountCode;
      if (!accounts.has(key)) {
        accounts.set(key, {
          accountCode: line.accountCode,
          accountName: line.accountName,
          accountType: line.accountType,
          accountSubtype: line.accountSubtype,
          openingDebit: new Decimal(0),
          openingCredit: new Decimal(0),
          periodDebit: new Decimal(0),
          periodCredit: new Decimal(0)
        });
      }
      return accounts.get(key);
    };

    openingLines.forEach((line) => {
      const row = ensure(line);
      row.openingDebit = row.openingDebit.plus(toDecimal(line.baseCurrencyDebit || 0));
      row.openingCredit = row.openingCredit.plus(toDecimal(line.baseCurrencyCredit || 0));
    });
    periodLines.forEach((line) => {
      const row = ensure(line);
      row.periodDebit = row.periodDebit.plus(toDecimal(line.baseCurrencyDebit || 0));
      row.periodCredit = row.periodCredit.plus(toDecimal(line.baseCurrencyCredit || 0));
    });

    return Array.from(accounts.values()).sort((left, right) => left.accountCode.localeCompare(right.accountCode));
  };

  const getTrialBalance = async ({
    fromDate = "",
    toDate = "",
    search = "",
    accountType = "",
    accountSubtype = "",
    status = "",
    activity = "",
    balanceSide = "",
    page = "",
    limit = "",
    sortBy = "accountCode",
    sortDirection = "asc"
  } = {}) => {
    const normalizedSearch = normalizeToken(search);
    const normalizedType = normalizeEnumToken(accountType);
    const normalizedSubtype = normalizeEnumToken(accountSubtype);
    const normalizedStatus = normalizeToken(status).toLowerCase();
    const normalizedActivity = normalizeToken(activity).toLowerCase();
    const normalizedBalanceSide = normalizeToken(balanceSide).toLowerCase();
    const expression = normalizedSearch ? new RegExp(escapeRegex(normalizedSearch), "i") : null;
    const rows = await summarizeAccounts({ fromDate, toDate });
    const periodLines = (await allPostedLines())
      .filter((line) => lineInRange(line, fromDate, toDate))
      .filter((line) => (!normalizedType || (normalizedType === "OTHER"
        ? [GL_ACCOUNT_TYPE.OTHER_INCOME, GL_ACCOUNT_TYPE.OTHER_EXPENSE].includes(line.accountType)
        : line.accountType === normalizedType)))
      .filter((line) => (!normalizedSubtype || line.accountSubtype === normalizedSubtype))
      .filter((line) => {
        if (!expression) return true;
        return [line.accountCode, line.accountName, line.entryNumber, line.sourceReference, line.description]
          .some((value) => expression.test(String(value || "")));
      });
    const baseCurrencies = Array.from(new Set(periodLines
      .map((line) => normalizeEnumToken(line.baseCurrency || line.currency))
      .filter(Boolean)));

    const decoratedRows = rows.map((row) => {
      const debitBalance = row.openingDebit.plus(row.periodDebit);
      const creditBalance = row.openingCredit.plus(row.periodCredit);
      const net = debitBalance.minus(creditBalance);
      const closingDebit = net.greaterThanOrEqualTo(0) ? net : new Decimal(0);
      const closingCredit = net.isNegative() ? net.abs() : new Decimal(0);
      const hasActivity = row.periodDebit.greaterThan(0) || row.periodCredit.greaterThan(0);
      const hasBalance = closingDebit.greaterThan(0) || closingCredit.greaterThan(0);
      const normalBalance = isDebitNormalAccount(row.accountType) ? "DEBIT" : "CREDIT";
      const balanceSideValue = closingDebit.greaterThan(0) ? "debit" : closingCredit.greaterThan(0) ? "credit" : "zero";
      const abnormalBalance = (normalBalance === "DEBIT" && closingCredit.greaterThan(0)) ||
        (normalBalance === "CREDIT" && closingDebit.greaterThan(0));
      return {
        accountCode: row.accountCode,
        accountName: row.accountName,
        accountType: row.accountType,
        accountSubtype: row.accountSubtype,
        normalBalance,
        openingDebit: row.openingDebit.toFixed(),
        openingCredit: row.openingCredit.toFixed(),
        periodDebit: row.periodDebit.toFixed(),
        periodCredit: row.periodCredit.toFixed(),
        closingDebit: closingDebit.toFixed(),
        closingCredit: closingCredit.toFixed(),
        balanceSide: balanceSideValue,
        hasActivity,
        hasBalance,
        reviewStatus: abnormalBalance ? "review" : "normal",
        reviewReason: abnormalBalance ? `Abnormal ${balanceSideValue} balance for ${normalBalance.toLowerCase()}-normal account` : ""
      };
    });

    const filteredRows = decoratedRows
      .filter((row) => (!normalizedType || (normalizedType === "OTHER"
        ? [GL_ACCOUNT_TYPE.OTHER_INCOME, GL_ACCOUNT_TYPE.OTHER_EXPENSE].includes(row.accountType)
        : row.accountType === normalizedType)))
      .filter((row) => (!normalizedSubtype || row.accountSubtype === normalizedSubtype))
      .filter((row) => {
        if (!expression) return true;
        return [row.accountCode, row.accountName, row.accountType, row.accountSubtype].some((value) => expression.test(String(value || "")));
      })
      .filter((row) => {
        if (!normalizedActivity || normalizedActivity === "all") return true;
        if (normalizedActivity === "with_activity") return row.hasActivity;
        if (normalizedActivity === "with_balance") return row.hasBalance;
        if (normalizedActivity === "no_activity") return !row.hasActivity;
        return true;
      })
      .filter((row) => {
        if (!normalizedBalanceSide || normalizedBalanceSide === "all") return true;
        return row.balanceSide === normalizedBalanceSide;
      })
      .filter((row) => {
        if (!normalizedStatus || normalizedStatus === "all") return true;
        return row.reviewStatus === normalizedStatus;
      });

    const sortField = ["accountCode", "accountName", "accountType", "periodDebit", "periodCredit", "closingDebit", "closingCredit"].includes(sortBy)
      ? sortBy
      : "accountCode";
    const direction = String(sortDirection).toLowerCase() === "desc" ? -1 : 1;
    const sortedRows = [...filteredRows].sort((left, right) => {
      if (["periodDebit", "periodCredit", "closingDebit", "closingCredit"].includes(sortField)) {
        return toDecimal(left[sortField] || 0).minus(toDecimal(right[sortField] || 0)).toNumber() * direction;
      }
      return String(left[sortField] || "").localeCompare(String(right[sortField] || ""), "en", { numeric: true, sensitivity: "base" }) * direction;
    });

    const hasExplicitPagination = Boolean(page || limit);
    const normalizedPage = parsePositiveInt(page, 1);
    const normalizedLimit = parsePositiveInt(limit, hasExplicitPagination ? DEFAULT_LEDGER_LIMIT : MAX_LEDGER_LIMIT, { min: 1, max: MAX_LEDGER_LIMIT });
    const skip = (normalizedPage - 1) * normalizedLimit;
    const items = sortedRows.slice(skip, skip + normalizedLimit);
    let totalDebit = new Decimal(0);
    let totalCredit = new Decimal(0);
    let openingDebit = new Decimal(0);
    let openingCredit = new Decimal(0);
    let periodDebit = new Decimal(0);
    let periodCredit = new Decimal(0);
    filteredRows.forEach((row) => {
      openingDebit = openingDebit.plus(toDecimal(row.openingDebit || 0));
      openingCredit = openingCredit.plus(toDecimal(row.openingCredit || 0));
      periodDebit = periodDebit.plus(toDecimal(row.periodDebit || 0));
      periodCredit = periodCredit.plus(toDecimal(row.periodCredit || 0));
      totalDebit = totalDebit.plus(toDecimal(row.closingDebit || 0));
      totalCredit = totalCredit.plus(toDecimal(row.closingCredit || 0));
    });
    const accountsWithActivity = filteredRows.filter((row) => row.hasActivity).length;
    const debitBalanceAccounts = filteredRows.filter((row) => row.balanceSide === "debit").length;
    const creditBalanceAccounts = filteredRows.filter((row) => row.balanceSide === "credit").length;
    const reviewAccounts = filteredRows.filter((row) => row.reviewStatus === "review").length;
    const byTypeMap = new Map();
    filteredRows.forEach((row) => {
      const key = [GL_ACCOUNT_TYPE.OTHER_INCOME, GL_ACCOUNT_TYPE.OTHER_EXPENSE].includes(row.accountType) ? "OTHER" : row.accountType;
      const existing = byTypeMap.get(key) || { accountType: key, label: labelizeToken(key), accounts: 0, debit: new Decimal(0), credit: new Decimal(0), absoluteBalance: new Decimal(0) };
      existing.accounts += 1;
      existing.debit = existing.debit.plus(toDecimal(row.closingDebit || 0));
      existing.credit = existing.credit.plus(toDecimal(row.closingCredit || 0));
      existing.absoluteBalance = existing.absoluteBalance.plus(toDecimal(row.closingDebit || 0)).plus(toDecimal(row.closingCredit || 0));
      byTypeMap.set(key, existing);
    });
    const topAccounts = [...filteredRows]
      .map((row) => ({
        accountCode: row.accountCode,
        accountName: row.accountName,
        accountType: row.accountType,
        balance: toDecimal(row.closingDebit || 0).plus(toDecimal(row.closingCredit || 0)).toFixed()
      }))
      .sort((left, right) => toDecimal(right.balance).minus(toDecimal(left.balance)).toNumber() || left.accountCode.localeCompare(right.accountCode))
      .slice(0, 5)
      .map((row, index) => ({ ...row, rank: index + 1 }));
    const balanced = totalDebit.equals(totalCredit);
    const hasData = filteredRows.length > 0;
    return {
      items,
      count: items.length,
      total: filteredRows.length,
      pagination: {
        page: normalizedPage,
        limit: normalizedLimit,
        total: filteredRows.length,
        pages: Math.max(1, Math.ceil(filteredRows.length / normalizedLimit)),
        from: filteredRows.length ? skip + 1 : 0,
        to: Math.min(skip + items.length, filteredRows.length),
        hasPrevious: normalizedPage > 1,
        hasNext: normalizedPage < Math.max(1, Math.ceil(filteredRows.length / normalizedLimit))
      },
      totals: {
        debit: totalDebit.toFixed(),
        credit: totalCredit.toFixed(),
        difference: totalDebit.minus(totalCredit).abs().toFixed(),
        openingDebit: openingDebit.toFixed(),
        openingCredit: openingCredit.toFixed(),
        periodDebit: periodDebit.toFixed(),
        periodCredit: periodCredit.toFixed(),
        closingDebit: totalDebit.toFixed(),
        closingCredit: totalCredit.toFixed()
      },
      balanced,
      status: hasData ? (balanced ? "BALANCED" : "NEEDS_ATTENTION") : "NO_DATA",
      accountingError: balanced ? null : "CRITICAL_ACCOUNTING_ERROR",
      summary: {
        totalAccounts: filteredRows.length,
        accountsWithActivity,
        debitBalanceAccounts,
        creditBalanceAccounts,
        reviewAccounts,
        hasData,
        baseCurrency: baseCurrencies.length === 1 ? baseCurrencies[0] : "",
        baseCurrencies,
        mixedBaseCurrencies: baseCurrencies.length > 1,
        byType: Array.from(byTypeMap.values()).map((row) => ({
          accountType: row.accountType,
          label: row.label,
          accounts: row.accounts,
          debit: row.debit.toFixed(),
          credit: row.credit.toFixed(),
          absoluteBalance: row.absoluteBalance.toFixed()
        })),
        topAccounts
      },
      trend: buildLedgerTrend(periodLines, { fromDate, toDate }),
      filters: {
        fromDate,
        toDate,
        search: normalizedSearch,
        accountType: normalizedType,
        accountSubtype: normalizedSubtype,
        status: normalizedStatus,
        activity: normalizedActivity,
        balanceSide: normalizedBalanceSide,
        page: normalizedPage,
        limit: normalizedLimit
      },
      sort: {
        by: sortField,
        direction: direction === -1 ? "desc" : "asc"
      }
    };
  };

  const signedAccountBalance = (row) => {
    const debit = row.openingDebit.plus(row.periodDebit);
    const credit = row.openingCredit.plus(row.periodCredit);
    if ([GL_ACCOUNT_TYPE.ASSET, GL_ACCOUNT_TYPE.COST_OF_SALES, GL_ACCOUNT_TYPE.EXPENSE, GL_ACCOUNT_TYPE.OTHER_EXPENSE].includes(row.accountType)) {
      return debit.minus(credit);
    }
    return credit.minus(debit);
  };

  const getProfitLoss = async ({ fromDate = "", toDate = "" } = {}) => {
    const [rows, chartRows, postedLines] = await Promise.all([
      summarizeAccounts({ fromDate, toDate }),
      leanMaybe(ChartOfAccountModel.find({})),
      allPostedLines()
    ]);
    const chartByCode = new Map(asArray(chartRows).map((account) => [account.code, account]));
    const periodLines = postedLines.filter((line) => lineInRange(line, fromDate, toDate));
    const baseCurrencies = Array.from(new Set(periodLines.map((line) => normalizeEnumToken(line.baseCurrency || line.currency)).filter(Boolean)));
    const section = (types) =>
      rows
        .filter((row) => types.includes(row.accountType))
        .map((row) => ({
          accountCode: row.accountCode,
          accountName: row.accountName,
          accountType: row.accountType,
          accountSubtype: row.accountSubtype,
          parentCode: chartByCode.get(row.accountCode)?.parentCode || "",
          amount: signedAccountBalance({ ...row, openingDebit: new Decimal(0), openingCredit: new Decimal(0) }).toFixed()
        }));
    const sum = (items) => items.reduce((total, item) => total.plus(toDecimal(item.amount || 0)), new Decimal(0));
    const revenue = section([GL_ACCOUNT_TYPE.REVENUE]);
    const costOfSales = section([GL_ACCOUNT_TYPE.COST_OF_SALES]);
    const operatingExpenses = section([GL_ACCOUNT_TYPE.EXPENSE]);
    const otherIncome = section([GL_ACCOUNT_TYPE.OTHER_INCOME]);
    const otherExpenses = section([GL_ACCOUNT_TYPE.OTHER_EXPENSE]);
    const grossProfit = sum(revenue).minus(sum(costOfSales));
    const operatingProfit = grossProfit.minus(sum(operatingExpenses));
    const netProfit = operatingProfit.plus(sum(otherIncome)).minus(sum(otherExpenses));
    const totalExpenses = sum(costOfSales).plus(sum(operatingExpenses)).plus(sum(otherExpenses));
    const totalRevenue = sum(revenue);
    const profitMargin = totalRevenue.isZero() ? null : netProfit.dividedBy(totalRevenue).times(100).toFixed(2);
    const trendMap = new Map();
    periodLines.forEach((line) => {
      if (![GL_ACCOUNT_TYPE.REVENUE, GL_ACCOUNT_TYPE.COST_OF_SALES, GL_ACCOUNT_TYPE.EXPENSE, GL_ACCOUNT_TYPE.OTHER_EXPENSE].includes(line.accountType)) return;
      const date = new Date(line.postingDate);
      const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
      const bucket = trendMap.get(key) || { date: key, revenue: new Decimal(0), expenses: new Decimal(0) };
      const debit = toDecimal(line.baseCurrencyDebit || 0);
      const credit = toDecimal(line.baseCurrencyCredit || 0);
      if (line.accountType === GL_ACCOUNT_TYPE.REVENUE) bucket.revenue = bucket.revenue.plus(credit.minus(debit));
      else bucket.expenses = bucket.expenses.plus(debit.minus(credit));
      trendMap.set(key, bucket);
    });
    return {
      sections: { revenue, costOfSales, operatingExpenses, otherIncome, otherExpenses },
      totals: {
        revenue: totalRevenue.toFixed(),
        costOfSales: sum(costOfSales).toFixed(),
        grossProfit: grossProfit.toFixed(),
        operatingExpenses: sum(operatingExpenses).toFixed(),
        operatingProfit: operatingProfit.toFixed(),
        otherIncome: sum(otherIncome).toFixed(),
        otherExpenses: sum(otherExpenses).toFixed(),
        netProfit: netProfit.toFixed(),
        totalExpenses: totalExpenses.toFixed(),
        profitMargin
      },
      trend: Array.from(trendMap.values()).sort((a, b) => a.date.localeCompare(b.date)).map((row) => ({ date: row.date, revenue: row.revenue.toFixed(), expenses: row.expenses.toFixed() })),
      expenseBreakdown: [...costOfSales, ...operatingExpenses, ...otherExpenses].filter((row) => !toDecimal(row.amount || 0).isZero()).sort((a, b) => toDecimal(b.amount).abs().minus(toDecimal(a.amount).abs()).toNumber()),
      summary: { fromDate: fromDate || null, toDate: toDate || null, baseCurrency: baseCurrencies.length === 1 ? baseCurrencies[0] : "", baseCurrencies, mixedBaseCurrencies: baseCurrencies.length > 1, consolidationAvailable: baseCurrencies.length <= 1 },
      source: "GENERAL_LEDGER"
    };
  };

  const getBalanceSheet = async ({ asOfDate = "" } = {}) => {
    const [rows, chartRows, postedLines] = await Promise.all([
      summarizeAccounts({ toDate: asOfDate }),
      leanMaybe(ChartOfAccountModel.find({})),
      allPostedLines()
    ]);
    const chartByCode = new Map(asArray(chartRows).map((account) => [account.code, account]));
    const baseCurrencies = Array.from(new Set(postedLines
      .filter((line) => lineInRange(line, "", asOfDate))
      .map((line) => normalizeEnumToken(line.baseCurrency || line.currency))
      .filter(Boolean)));
    const byType = (types) =>
      rows
        .filter((row) => types.includes(row.accountType))
        .map((row) => ({
          accountCode: row.accountCode,
          accountName: row.accountName,
          accountType: row.accountType,
          accountSubtype: row.accountSubtype,
          parentCode: chartByCode.get(row.accountCode)?.parentCode || "",
          amount: signedAccountBalance(row).toFixed()
        }));
    const sum = (items) => items.reduce((total, item) => total.plus(toDecimal(item.amount || 0)), new Decimal(0));
    const assets = byType([GL_ACCOUNT_TYPE.ASSET]);
    const liabilities = byType([GL_ACCOUNT_TYPE.LIABILITY]);
    const equity = byType([GL_ACCOUNT_TYPE.EQUITY]);
    const profitLoss = await getProfitLoss({ toDate: asOfDate });
    const currentEarnings = toDecimal(profitLoss.totals.netProfit || 0);
    const totalAssets = sum(assets);
    const totalLiabilities = sum(liabilities);
    const totalEquity = sum(equity).plus(currentEarnings);
    const consolidationAvailable = baseCurrencies.length <= 1;
    const balanced = consolidationAvailable && totalAssets.equals(totalLiabilities.plus(totalEquity));
    return {
      sections: {
        assets,
        liabilities,
        equity: [
          ...equity,
          {
            accountCode: "CURRENT_EARNINGS",
            accountName: "Current Period Earnings",
            accountType: GL_ACCOUNT_TYPE.EQUITY,
            amount: currentEarnings.toFixed()
          }
        ]
      },
      totals: {
        assets: totalAssets.toFixed(),
        liabilities: totalLiabilities.toFixed(),
        equity: totalEquity.toFixed(),
        liabilitiesAndEquity: totalLiabilities.plus(totalEquity).toFixed(),
        difference: totalAssets.minus(totalLiabilities.plus(totalEquity)).abs().toFixed()
      },
      balanced,
      accountingError: !consolidationAvailable ? "MULTIPLE_BASE_CURRENCIES" : balanced ? null : "BALANCE_SHEET_OUT_OF_BALANCE",
      summary: {
        asOfDate: asOfDate || null,
        source: "GENERAL_LEDGER",
        baseCurrency: baseCurrencies.length === 1 ? baseCurrencies[0] : "",
        baseCurrencies,
        mixedBaseCurrencies: baseCurrencies.length > 1,
        consolidationAvailable
      }
    };
  };

  const getCashFlow = async ({ fromDate = "", toDate = "" } = {}) => {
    const allLines = await allPostedLines();
    const isCashEquivalent = (line) => [GL_ACCOUNT_SUBTYPE.CASH, GL_ACCOUNT_SUBTYPE.BANK, GL_ACCOUNT_SUBTYPE.MOBILE_MONEY].includes(line.accountSubtype);
    const cashLines = allLines.filter((line) => lineInRange(line, fromDate, toDate) && isCashEquivalent(line));
    const openingLines = allLines.filter((line) => isCashEquivalent(line) && fromDate && new Date(line.postingDate) < new Date(fromDate));
    const baseCurrencies = Array.from(new Set([...cashLines, ...openingLines].map((line) => normalizeEnumToken(line.baseCurrency)).filter(Boolean)));
    const consolidationAvailable = baseCurrencies.length <= 1;
    const buckets = {
      operating: new Decimal(0),
      investing: new Decimal(0),
      financing: new Decimal(0)
    };
    const activityLines = { operating: [], investing: [], financing: [] };
    const classify = (line) => {
      const postingType = normalizeEnumToken(line.postingType);
      if ([GL_POSTING_TYPE.OWNER_CAPITAL_INJECTION, GL_POSTING_TYPE.OWNER_DRAWING].includes(postingType)) return "financing";
      if (["OPERATING", "INVESTING", "FINANCING"].includes(normalizeEnumToken(line.cashFlowCategory))) return normalizeEnumToken(line.cashFlowCategory).toLowerCase();
      return "operating";
    };
    const trend = new Map();
    let inflows = new Decimal(0); let outflows = new Decimal(0);
    cashLines.forEach((line) => {
      const movement = toDecimal(line.baseCurrencyDebit || 0).minus(toDecimal(line.baseCurrencyCredit || 0));
      const activity = classify(line);
      buckets[activity] = buckets[activity].plus(movement);
      if (movement.greaterThanOrEqualTo(0)) inflows = inflows.plus(movement); else outflows = outflows.plus(movement.abs());
      const date = new Date(line.postingDate).toISOString().slice(0, 10);
      const point = trend.get(date) || { date, inflows: new Decimal(0), outflows: new Decimal(0), net: new Decimal(0) };
      if (movement.greaterThanOrEqualTo(0)) point.inflows = point.inflows.plus(movement); else point.outflows = point.outflows.plus(movement.abs());
      point.net = point.net.plus(movement); trend.set(date, point);
      activityLines[activity].push({ ...normalizeLineForApi(line), movement: movement.toFixed(), activity: activity.toUpperCase() });
    });
    const netChange = buckets.operating.plus(buckets.investing).plus(buckets.financing);
    const openingBalance = openingLines.reduce((sum, line) => sum.plus(toDecimal(line.baseCurrencyDebit || 0)).minus(toDecimal(line.baseCurrencyCredit || 0)), new Decimal(0));
    const closingBalance = openingBalance.plus(netChange);
    return {
      statementType: "CASH_FLOW_STATEMENT",
      activities: {
        operating: buckets.operating.toFixed(),
        investing: buckets.investing.toFixed(),
        financing: buckets.financing.toFixed()
      },
      totals: { inflows: inflows.toFixed(), outflows: outflows.toFixed(), netCashFlow: netChange.toFixed(), openingBalance: openingBalance.toFixed(), closingBalance: closingBalance.toFixed(), integrityDifference: openingBalance.plus(netChange).minus(closingBalance).abs().toFixed() },
      netChange: netChange.toFixed(),
      trend: Array.from(trend.values()).sort((a,b)=>a.date.localeCompare(b.date)).map((row)=>({ date: row.date, inflows: row.inflows.toFixed(), outflows: row.outflows.toFixed(), netCashFlow: row.net.toFixed() })),
      activityLines,
      lines: cashLines.map(normalizeLineForApi),
      summary: { fromDate: fromDate || null, toDate: toDate || null, baseCurrency: baseCurrencies.length === 1 ? baseCurrencies[0] : "", baseCurrencies, mixedBaseCurrencies: baseCurrencies.length > 1, consolidationAvailable, source: "POSTED_GENERAL_LEDGER_CASH_EQUIVALENTS", cashEquivalentSubtypes: [GL_ACCOUNT_SUBTYPE.CASH, GL_ACCOUNT_SUBTYPE.BANK, GL_ACCOUNT_SUBTYPE.MOBILE_MONEY] },
      warnings: consolidationAvailable ? [] : [{ code: "MULTIPLE_BASE_CURRENCIES", message: "Cash Flow cannot be consolidated until all posted cash movements have one verified base currency." }]
    };
  };

  const listPeriods = async ({ year = "", status = "" } = {}) => {
    const query = {};
    if (year) query.year = Number(year);
    if (status) query.status = normalizeEnumToken(status);
    const rows = await leanMaybe(queryMaybe(AccountingPeriodModel.find(query), { sort: { startDate: 1 } }));
    return { items: asArray(rows), count: asArray(rows).length };
  };

  const createOrGetPeriod = async ({ year, month, auth = {}, requestId = "" } = {}) => {
    const numericYear = Number(year);
    const numericMonth = Number(month);
    const periodKey = `${numericYear}-${String(numericMonth).padStart(2, "0")}`;
    const existing = await leanMaybe(AccountingPeriodModel.findOne({ periodKey }));
    if (existing) return { action: "existing", period: existing };
    const created = await AccountingPeriodModel.create({
      periodKey,
      label: periodKey,
      year: numericYear,
      month: numericMonth,
      quarter: quarterForMonth(numericMonth),
      startDate: startOfMonthUtc(numericYear, numericMonth),
      endDate: endOfMonthUtc(numericYear, numericMonth),
      status: ACCOUNTING_PERIOD_STATUS.OPEN
    });
    await recordAudit({ action: "gl_period_created", entityType: "AccountingPeriod", entity: created, auth, requestId, reason: "Accounting period created", after: created });
    return { action: "created", period: created };
  };

  const buildPeriodCloseChecklist = async (period) => {
    const range = { $gte: new Date(period.startDate), $lte: new Date(period.endDate) };
    const [trialBalance, periodJournals, pendingRefunds, unpostedExpenses, unreconciledPayments] = await Promise.all([
      getTrialBalance({ fromDate: period.startDate, toDate: period.endDate }),
      leanMaybe(JournalEntryModel.find({ postingDate: range })),
      RefundModel.countDocuments ? RefundModel.countDocuments({ requestedAt: range, status: { $in: ["requested", "eligible", "pending_approval", "approved", "awaiting_merchant_approval", "processing", "verification_required", "manual_review", "manual_refund_required"] } }) : 0,
      BusinessExpenseModel.countDocuments ? BusinessExpenseModel.countDocuments({ expenseDate: range, accountingPostingId: null, status: { $ne: "VOID" } }) : 0,
      PaymentModel.countDocuments ? PaymentModel.countDocuments({ paidAt: range, status: "paid", "reconciliation.reviewed": { $ne: true } }) : 0
    ]);
    const journals = asArray(periodJournals);
    const unbalancedJournals = journals.filter(
      (entry) => !toDecimal(entry.baseTotalDebit || 0).equals(toDecimal(entry.baseTotalCredit || 0))
    ).length;
    const unpostedJournals = journals.filter(
      (entry) => ![JOURNAL_STATUS.POSTED, JOURNAL_STATUS.REVERSED, JOURNAL_STATUS.VOID].includes(entry.status)
    ).length;
    const checks = [
      { key: "trial_balance", label: "Trial Balance Balanced", status: trialBalance.balanced ? "PASS" : "FAIL", count: trialBalance.balanced ? 0 : 1, blocking: true, detail: `Difference ${trialBalance.totals?.difference || "0"}` },
      { key: "journal_balance", label: "Journal Entries Balanced", status: unbalancedJournals ? "FAIL" : "PASS", count: unbalancedJournals, blocking: true },
      { key: "journal_posting", label: "Journal Entries Posted", status: unpostedJournals ? "FAIL" : "PASS", count: unpostedJournals, blocking: true },
      { key: "business_expenses", label: "Business Expenses Posted", status: unpostedExpenses ? "FAIL" : "PASS", count: unpostedExpenses, blocking: true },
      { key: "payments", label: "Payments Reconciled", status: unreconciledPayments ? "FAIL" : "PASS", count: unreconciledPayments, blocking: true },
      { key: "refunds", label: "Refunds Resolved", status: pendingRefunds ? "FAIL" : "PASS", count: pendingRefunds, blocking: true },
      { key: "booking_sync", label: "Booking Accounting Sync", status: "NOT_VERIFIED", count: null, blocking: false, detail: "No period-scoped verification is available." },
      { key: "cash_reconciliation", label: "Bank/Cash Reconciliation", status: "NOT_VERIFIED", count: null, blocking: false, detail: "No period-scoped reconciliation completion record is available." }
    ];
    const blockingIssues = checks.filter((check) => check.blocking && check.status === "FAIL").reduce((total, check) => total + Math.max(1, Number(check.count || 0)), 0);
    return {
      period: period.periodKey,
      readyToClose: blockingIssues === 0,
      blockingIssues,
      baseCurrency: trialBalance.summary?.baseCurrency || "",
      checks,
      journalCount: journals.length,
      unreconciledPayments,
      pendingRefunds,
      unpostedExpenses,
      unbalancedJournals,
      unpostedJournals,
      dataQualityWarnings: pendingRefunds + unpostedExpenses + unreconciledPayments + unbalancedJournals + unpostedJournals
    };
  };

  const getPeriodCloseOverview = async ({ periodId } = {}) => {
    const period = await leanMaybe(AccountingPeriodModel.findById(periodId));
    if (!period) throw new AppError("Accounting period not found.", 404, "GL_PERIOD_NOT_FOUND");
    const [checklist, accounts, profitLoss, cashFlow, reconciliation] = await Promise.all([
      buildPeriodCloseChecklist(period),
      leanMaybe(ChartOfAccountModel.find({})),
      getProfitLoss({ fromDate: period.startDate, toDate: period.endDate }),
      getCashFlow({ fromDate: period.startDate, toDate: period.endDate }),
      getReconciliation({ fromDate: period.startDate, toDate: period.endDate })
    ]);
    const accountRows = asArray(accounts);
    return {
      period,
      checklist,
      metrics: {
        chartOfAccounts: accountRows.length,
        activeAccounts: accountRows.filter((account) => account.active !== false).length,
        journalEntries: checklist.journalCount,
        trialBalance: reconciliation.trialBalance,
        accountingHealth: period.status === ACCOUNTING_PERIOD_STATUS.CLOSED || period.status === ACCOUNTING_PERIOD_STATUS.LOCKED
          ? "CLOSED"
          : checklist.readyToClose ? "READY_TO_CLOSE" : "ATTENTION_REQUIRED"
      },
      financialSummary: {
        revenue: profitLoss.totals?.revenue ?? null,
        expenses: toDecimal(profitLoss.totals?.costOfSales || 0).plus(toDecimal(profitLoss.totals?.operatingExpenses || 0)).plus(toDecimal(profitLoss.totals?.otherExpenses || 0)).toFixed(),
        netProfit: profitLoss.totals?.netProfit ?? null,
        cashMovement: cashFlow.netChange ?? null,
        receivables: reconciliation.arControl?.ledgerBalance ?? null,
        payables: reconciliation.apControl?.ledgerBalance ?? null,
        baseCurrency: checklist.baseCurrency
      },
      reportFilters: { fromDate: period.startDate, toDate: period.endDate }
    };
  };

  const closePeriod = async ({ periodId, reason = "", auth = {}, requestId = "" } = {}) => {
    if (!reason) throw new AppError("Period close reason is required.", 422, "GL_PERIOD_REASON_REQUIRED");
    const period = await leanMaybe(AccountingPeriodModel.findById(periodId));
    if (!period) throw new AppError("Accounting period not found.", 404, "GL_PERIOD_NOT_FOUND");
    if (period.status === ACCOUNTING_PERIOD_STATUS.CLOSED) {
      throw new AppError("Accounting period is already closed.", 409, "GL_PERIOD_ALREADY_CLOSED");
    }
    if (period.status === ACCOUNTING_PERIOD_STATUS.LOCKED) {
      throw new AppError("Locked periods cannot be closed again.", 409, "GL_PERIOD_LOCKED");
    }
    const checklist = await buildPeriodCloseChecklist(period);
    if (!checklist.readyToClose) {
      throw new AppError("Period cannot be closed until the accounting issues are resolved.", 409, "GL_PERIOD_CLOSE_BLOCKED", { checklist });
    }
    const updated = await leanMaybe(AccountingPeriodModel.findByIdAndUpdate(periodId, {
      $set: {
        status: ACCOUNTING_PERIOD_STATUS.CLOSED,
        closedBy: auth?.id || "",
        closedAt: now(),
        reason,
        closeChecklist: checklist
      }
    }, { new: true }));
    await recordAudit({ action: "gl_period_closed", entityType: "AccountingPeriod", entity: updated, auth, requestId, reason, before: period, after: updated, metadata: { checklist } });
    return { action: "closed", period: updated, checklist };
  };

  const reopenPeriod = async ({ periodId, reason = "", auth = {}, requestId = "" } = {}) => {
    if (!reason) throw new AppError("Period reopen reason is required.", 422, "GL_PERIOD_REASON_REQUIRED");
    if (auth?.role !== "super_admin") {
      throw new AppError("Only super admins can reopen accounting periods.", 403, "GL_PERIOD_REOPEN_FORBIDDEN");
    }
    const period = await leanMaybe(AccountingPeriodModel.findById(periodId));
    if (!period) throw new AppError("Accounting period not found.", 404, "GL_PERIOD_NOT_FOUND");
    if (period.status === ACCOUNTING_PERIOD_STATUS.OPEN) {
      throw new AppError("Accounting period is already open.", 409, "GL_PERIOD_ALREADY_OPEN");
    }
    if (period.status === ACCOUNTING_PERIOD_STATUS.LOCKED) {
      throw new AppError("Locked periods cannot be reopened.", 409, "GL_PERIOD_LOCKED");
    }
    const updated = await leanMaybe(AccountingPeriodModel.findByIdAndUpdate(periodId, {
      $set: {
        status: ACCOUNTING_PERIOD_STATUS.OPEN,
        reopenedBy: auth?.id || "",
        reopenedAt: now(),
        reason
      }
    }, { new: true }));
    await recordAudit({ action: "gl_period_reopened", entityType: "AccountingPeriod", entity: updated, auth, requestId, reason, before: period, after: updated });
    return { action: "reopened", period: updated };
  };

  const seedDefaultMappings = async ({ dryRun = true, auth = {}, requestId = "" } = {}) => {
    const existing = asArray(await leanMaybe(AccountingMappingModel.find({})));
    const byKey = new Map(existing.map((row) => [row.mappingKey, row]));
    const plan = defaultMappings.map((mapping) => ({
      action: byKey.has(mapping.mappingKey) ? "exists" : "create",
      mapping
    }));
    const ruleRows = asArray(await leanMaybe(PostingRuleModel.find({})));
    const ruleKeys = new Set(ruleRows.map((row) => `${row.eventType}:${row.sourceModule}`));
    const rulePlan = defaultPostingRules.map((rule) => ({
      action: ruleKeys.has(`${rule.eventType}:${rule.sourceModule}`) ? "exists" : "create",
      rule
    }));
    if (dryRun) return { dryRun: true, plan, rulePlan, willCreate: plan.filter((item) => item.action === "create").length + rulePlan.filter((item) => item.action === "create").length };
    const created = [];
    for (const item of plan.filter((row) => row.action === "create")) {
      created.push(await AccountingMappingModel.create({ ...item.mapping, systemMapping: true, active: true, createdBy: auth?.id || "" }));
    }
    const rulesCreated = [];
    for (const item of rulePlan.filter((row) => row.action === "create")) {
      rulesCreated.push(await PostingRuleModel.create({ ...item.rule, systemRule: true, active: true, createdBy: auth?.id || "" }));
    }
    await recordAudit({
      action: "gl_account_mappings_seeded",
      entityType: "AccountingMapping",
      auth,
      requestId,
      after: { created: created.length, rulesCreated: rulesCreated.length },
      metadata: { entityId: "default-accounting-mappings", reference: "DEFAULT_GL_MAPPINGS" }
    });
    return { dryRun: false, createdCount: created.length, rulesCreatedCount: rulesCreated.length, created, rulesCreated };
  };

  const getReconciliation = async ({ fromDate = "", toDate = "" } = {}) => {
    const [trialBalance, gl, entries, accounts, invoices, expenses, assets] = await Promise.all([
      getTrialBalance({ fromDate, toDate }), getGeneralLedger({ fromDate, toDate, limit: 5000 }),
      leanMaybe(JournalEntryModel.find({})), leanMaybe(ChartOfAccountModel.find({})), InvoiceModel.find ? leanMaybe(InvoiceModel.find({})) : [],
      BusinessExpenseModel.find ? leanMaybe(BusinessExpenseModel.find({})) : [], getFixedAssets()
    ]);
    const sumAccount = (code) =>
      gl.items
        .filter((line) => line.accountCode === code)
        .reduce((total, line) => total.plus(toDecimal(line.baseCurrencyDebit || 0)).minus(toDecimal(line.baseCurrencyCredit || 0)), new Decimal(0));
    const ar = sumAccount("1100");
    const ap = sumAccount("2010").abs();
    const providerClearing = ["1030", "1040", "1050"].map((code) => ({
      accountCode: code,
      balance: sumAccount(code).toFixed()
    }));
    const profitLoss = await getProfitLoss({ fromDate, toDate });
    const currency = trialBalance.summary?.baseCurrency || configuredBaseCurrency();
    const mixed = Boolean(trialBalance.summary?.mixedBaseCurrencies);
    const invoiceRows = asArray(invoices).filter((row)=>!fromDate||new Date(row.issueDate||row.createdAt)>=new Date(fromDate)).filter((row)=>!toDate||new Date(row.issueDate||row.createdAt)<=new Date(`${toDate}T23:59:59.999Z`));
    const postedInvoiceReferences = new Set(asArray(entries).filter((entry)=>entry.status===JOURNAL_STATUS.POSTED&&entry.sourceModule===SOURCE_MODULE.INVOICE).map((entry)=>normalizeToken(entry.sourceReference)));
    const unpostedInvoices = invoiceRows.filter((row)=>!postedInvoiceReferences.has(normalizeToken(row.invoiceNumber||row.bookingReference))).length;
    const arCurrencies = new Set(invoiceRows.map(row=>normalizeEnumToken(row.accountingCurrency||row.transactionCurrency||row.currency)).filter(Boolean));
    const arSubledger = invoiceRows.reduce((sum,row)=>sum.plus(toDecimal(row.balanceDueAmount??row.balanceDue??0)),new Decimal(0));
    const expenseRows = asArray(expenses).filter(row=>row.sourceModule===SOURCE_MODULE.BUSINESS_ACCOUNTING&&!['VOID','REJECTED'].includes(normalizeEnumToken(row.status)));
    const apCurrencies = new Set(expenseRows.map(row=>normalizeEnumToken(row.baseCurrency||row.currency)).filter(Boolean));
    const apEvidenceComplete = expenseRows.every(row=>normalizeEnumToken(row.paymentStatus)!=="PARTIALLY_PAID");
    const apSubledger = expenseRows.reduce((sum,row)=>normalizeEnumToken(row.paymentStatus)==="PAID"?sum:sum.plus(toDecimal(row.baseCurrencyAmount||row.amount||0)),new Decimal(0));
    const fixedAssetGl = gl.items.filter(line=>[GL_ACCOUNT_SUBTYPE.FIXED_ASSET,GL_ACCOUNT_SUBTYPE.ACCUMULATED_DEPRECIATION].includes(line.accountSubtype)).reduce((sum,line)=>sum.plus(toDecimal(line.baseCurrencyDebit||0)).minus(toDecimal(line.baseCurrencyCredit||0)),new Decimal(0));
    const fixedAssetRegister = assets.summary?.netBookValue==null?null:toDecimal(assets.summary.netBookValue);
    const statusFor=(sub,ledger,{records=0,evidence=true,currencySafe=true}={})=>{if(!records)return"NOT_EVALUATED";if(!evidence||!currencySafe)return"NEEDS_REVIEW";return toDecimal(sub).equals(toDecimal(ledger))?"BALANCED":"WITH_DIFFERENCES"};
    const modules=[
      {key:"general-ledger",label:"General Ledger",records:asArray(entries).filter(e=>e.status===JOURNAL_STATUS.POSTED).length,subledgerBalance:null,glBalance:null,difference:trialBalance.totals.difference,currency,status:trialBalance.summary?.accountsWithActivity?trialBalance.balanced?"BALANCED":"ERROR":"NOT_EVALUATED",route:"/admin/business-accounting/trial-balance",basis:"Period debits equal period credits"},
      {key:"accounts-receivable",label:"Accounts Receivable",records:invoiceRows.length,subledgerBalance:arSubledger.toFixed(),glBalance:ar.toFixed(),difference:arSubledger.minus(ar).toFixed(),currency:arCurrencies.size===1?[...arCurrencies][0]:currency,status:statusFor(arSubledger,ar,{records:invoiceRows.length,evidence:arCurrencies.size<=1,currencySafe:!mixed}),route:"/admin/business-accounting/accounts-receivable",basis:"Invoice accounting balances vs GL 1100"},
      {key:"accounts-payable",label:"Accounts Payable",records:expenseRows.length,subledgerBalance:apEvidenceComplete?apSubledger.toFixed():null,glBalance:ap.toFixed(),difference:apEvidenceComplete?apSubledger.minus(ap).toFixed():null,currency:apCurrencies.size===1?[...apCurrencies][0]:currency,status:statusFor(apSubledger,ap,{records:expenseRows.length,evidence:apEvidenceComplete&&apCurrencies.size<=1,currencySafe:!mixed}),route:"/admin/business-accounting/accounts-payable",basis:"Approved supplier balances vs GL 2010"},
      {key:"cash-bank",label:"Cash & Bank",records:gl.items.filter(line=>[GL_ACCOUNT_SUBTYPE.CASH,GL_ACCOUNT_SUBTYPE.BANK,GL_ACCOUNT_SUBTYPE.MOBILE_MONEY].includes(line.accountSubtype)).length,subledgerBalance:null,glBalance:null,difference:null,currency,status:gl.items.some(line=>[GL_ACCOUNT_SUBTYPE.CASH,GL_ACCOUNT_SUBTYPE.BANK,GL_ACCOUNT_SUBTYPE.MOBILE_MONEY].includes(line.accountSubtype))?"NOT_RECONCILED":"NOT_EVALUATED",route:"/admin/business-accounting/cash-bank",basis:"External statement balances are not stored"},
      {key:"channel-settlements",label:"Channel Settlements",records:providerClearing.filter(row=>!toDecimal(row.balance).isZero()).length,subledgerBalance:null,glBalance:providerClearing.reduce((sum,row)=>sum.plus(toDecimal(row.balance)),new Decimal(0)).toFixed(),difference:null,currency,status:providerClearing.some(row=>!toDecimal(row.balance).isZero())?"NEEDS_REVIEW":"NOT_EVALUATED",route:"/admin/payments",basis:"Provider clearing balances; customer paid status is not settlement"},
      {key:"fixed-assets",label:"Fixed Assets",records:assets.count||0,subledgerBalance:fixedAssetRegister?.toFixed()??null,glBalance:fixedAssetGl.toFixed(),difference:fixedAssetRegister?fixedAssetRegister.minus(fixedAssetGl).toFixed():null,currency,status:statusFor(fixedAssetRegister||0,fixedAssetGl,{records:assets.count||0,evidence:!assets.summary?.mixedCurrencies,currencySafe:!mixed}),route:"/admin/business-accounting/fixed-assets",basis:"Scheduled register NBV vs fixed-asset GL accounts; schedule is not posted depreciation"}
    ];
    const attention=modules.filter(row=>!["BALANCED","NOT_APPLICABLE","NOT_EVALUATED"].includes(row.status));const evaluated=modules.filter(row=>!["NOT_APPLICABLE","NOT_EVALUATED"].includes(row.status));const balanced=modules.filter(row=>row.status==="BALANCED").length;
    return {
      trialBalance: {
        balanced: trialBalance.balanced,
        difference: trialBalance.totals.difference
      },
      arControl: { accountCode: "1100", ledgerBalance: ar.toFixed(), subledgerStatus: "FOUNDATION" },
      apControl: { accountCode: "2010", ledgerBalance: ap.toFixed(), subledgerStatus: "FOUNDATION" },
      providerClearing,
      managementVsLedger: {
        status: "FOUNDATION",
        ledgerNetProfit: profitLoss.totals.netProfit,
        note: "Management accounting remains separate; detailed reconciliation expands as source events are migrated."
      },
      modules,
      summary:{fromDate:fromDate||null,toDate:toDate||null,totalAccounts:asArray(accounts).length,postedJournals:asArray(entries).filter(e=>e.status===JOURNAL_STATUS.POSTED&&(!fromDate||new Date(e.postingDate)>=new Date(fromDate))&&(!toDate||new Date(e.postingDate)<=new Date(`${toDate}T23:59:59.999Z`))).length,unpostedInvoices,baseCurrency:currency,mixedBaseCurrencies:mixed,attentionCount:attention.length,evaluatedCount:evaluated.length,balancedCount:balanced,reconciledPercent:evaluated.length?Number(((balanced/evaluated.length)*100).toFixed(1)):null,health:!evaluated.length?"NOT_EVALUATED":attention.some(row=>row.status==="ERROR")?"CRITICAL":attention.length?"ATTENTION_REQUIRED":"PASS"},
      activity:[],
      risks: [
        "Historical source events are not backfilled until the controlled migration is run.",
        "Invoices without a source-linked posted journal remain visible as reconciliation differences until a reviewed ledger migration is applied."
      ]
    };
  };

  const getAccountingHealth = async () => {
    const entries = asArray(await leanMaybe(JournalEntryModel.find({})));
    const unbalanced = entries.filter((entry) => !toDecimal(entry.baseTotalDebit || 0).equals(toDecimal(entry.baseTotalCredit || 0)));
    const mappingRows = asArray(await leanMaybe(AccountingMappingModel.find({ active: true })));
    const missingDefaultMappings = defaultMappings.filter((mapping) => !mappingRows.some((row) => row.mappingKey === mapping.mappingKey));
    const sourceKeys = new Set();
    let duplicateSourcePostings = 0;
    entries.forEach((entry) => {
      const key = entry.source?.postingKey;
      if (!key) return;
      if (sourceKeys.has(key)) duplicateSourcePostings += 1;
      sourceKeys.add(key);
    });
    const periods = asArray(await leanMaybe(AccountingPeriodModel.find({ status: { $in: [ACCOUNTING_PERIOD_STATUS.CLOSED, ACCOUNTING_PERIOD_STATUS.LOCKED] } })));
    const lines = await allPostedLines();
    const closedPeriodViolations = lines.filter((line) => {
      const lineDate = new Date(line.postingDate);
      return periods.some((period) => lineDate >= new Date(period.startDate) && lineDate <= new Date(period.endDate));
    }).length;
    return {
      checks: {
        unbalancedJournals: unbalanced.length,
        missingAccountMappings: missingDefaultMappings.length,
        duplicateSourcePostings,
        unpostedFinancialEvents: entries.filter((entry) => entry.status !== JOURNAL_STATUS.POSTED && entry.status !== JOURNAL_STATUS.REVERSED).length,
        closedPeriodViolations,
        arMismatch: "FOUNDATION",
        apMismatch: "FOUNDATION",
        cashMismatch: "FOUNDATION"
      },
      status: unbalanced.length || missingDefaultMappings.length || duplicateSourcePostings || closedPeriodViolations ? "WARNING" : "PASS",
      missingDefaultMappings
    };
  };

  const runHistoricalMigration = async ({ dryRun = true, fromDate = "", toDate = "", evidenceNote = "", auth = {}, requestId = "" } = {}) => {
    const filters = { fromDate, toDate };
    const plan = {
      strategy: "DRY_RUN_CLASSIFY_REPORT_APPLY_RECONCILE_VERIFY",
      filters,
      sources: ["Payments", "Invoices", "Refunds", "BusinessExpenses", "BusinessIncome"],
      actions: [
        "Classify source events by confidence",
        "Report unmapped or ambiguous events",
        "Do not fabricate missing counterpart accounts",
        "Apply only after operator evidence and review"
      ]
    };
    if (dryRun) {
      return {
        dryRun: true,
        confidence: LEDGER_MIGRATION_CONFIDENCE.MANUAL_REVIEW_REQUIRED,
        classifiedEvents: 0,
        unmappedEvents: 0,
        plan,
        writes: 0
      };
    }
    if (!evidenceNote) {
      throw new AppError("Historical ledger migration requires an evidence note before apply.", 422, "LEDGER_MIGRATION_EVIDENCE_REQUIRED");
    }
    const run = await LedgerMigrationRunModel.create({
      migrationReference: `GLM-${now().toISOString().slice(0, 10).replace(/-/g, "")}-${uuidv4().slice(0, 8).toUpperCase()}`,
      status: LEDGER_MIGRATION_STATUS.READY_FOR_REVIEW,
      fromDate: fromDate ? normalizeDate(fromDate) : null,
      toDate: toDate ? normalizeDate(toDate) : null,
      dryRun: false,
      confidence: LEDGER_MIGRATION_CONFIDENCE.MANUAL_REVIEW_REQUIRED,
      classifiedEvents: 0,
      unmappedEvents: 0,
      appliedJournalCount: 0,
      plan,
      warnings: ["Apply does not create historical journals automatically; opening balance and reviewed event batches are required."],
      createdBy: auth?.id || "",
      evidenceNote
    });
    await recordAudit({ action: "gl_historical_migration_planned", entityType: "LedgerMigrationRun", entity: run, auth, requestId, reason: evidenceNote, after: run });
    return { dryRun: false, action: "planned_for_review", run };
  };

  const createFixedAsset = async ({ input = {}, auth = {}, requestId = "" } = {}) => {
    const purchaseCost = money(input.purchaseCost || 0, { allowNegative: false, field: "asset.purchaseCost" });
    const salvageValue = money(input.salvageValue || 0, { allowNegative: false, field: "asset.salvageValue" });
    if (toDecimal(salvageValue).greaterThan(toDecimal(purchaseCost))) {
      throw new AppError("Asset salvage value cannot exceed purchase cost.", 422, "FIXED_ASSET_SALVAGE_INVALID");
    }
    const asset = await FixedAssetModel.create({
      assetReference: input.assetReference || `FA-${now().toISOString().slice(0, 10).replace(/-/g, "")}-${uuidv4().slice(0, 8).toUpperCase()}`,
      name: input.name,
      assetAccount: input.assetAccount,
      accumulatedDepreciationAccount: input.accumulatedDepreciationAccount,
      depreciationExpenseAccount: input.depreciationExpenseAccount,
      purchaseCost: toDecimal128(purchaseCost),
      currency: requireCurrency(input.currency || "USD"),
      salvageValue: toDecimal128(salvageValue),
      usefulLifeMonths: Number(input.usefulLifeMonths),
      depreciationMethod: input.depreciationMethod || DEPRECIATION_METHOD.STRAIGHT_LINE,
      startDate: normalizeDate(input.startDate || now()),
      status: input.status || FIXED_ASSET_STATUS.DRAFT,
      createdBy: auth?.id || "",
      metadata: input.metadata || {}
    });
    await recordAudit({ action: "gl_fixed_asset_created", entityType: "FixedAsset", entity: asset, auth, requestId, reason: "Fixed asset created", after: asset });
    return { action: "created", asset };
  };

  const createFixedAssetDepreciationJournal = async ({ assetId, postingDate, auth = {}, requestId = "", reason = "" } = {}) => {
    const asset = await leanMaybe(FixedAssetModel.findById(assetId));
    if (!asset) throw new AppError("Fixed asset was not found.", 404, "FIXED_ASSET_NOT_FOUND");
    if (asset.status !== FIXED_ASSET_STATUS.ACTIVE) {
      throw new AppError("Only active fixed assets can generate depreciation journals.", 409, "FIXED_ASSET_NOT_ACTIVE");
    }
    const amount = toDecimal(asset.purchaseCost).minus(toDecimal(asset.salvageValue || 0)).dividedBy(Number(asset.usefulLifeMonths || 1)).toDecimalPlaces(2);
    if (!amount.greaterThan(0)) throw new AppError("Fixed asset has no depreciable amount.", 422, "FIXED_ASSET_NOT_DEPRECIABLE");
    const accounts = await leanMaybe(ChartOfAccountModel.find({ _id: { $in: [asset.assetAccount, asset.accumulatedDepreciationAccount, asset.depreciationExpenseAccount] }, active: true }));
    const byId = new Map(accounts.map((account) => [String(account._id), account]));
    const expenseAccount = byId.get(String(asset.depreciationExpenseAccount));
    const accumulatedAccount = byId.get(String(asset.accumulatedDepreciationAccount));
    if (!expenseAccount || !accumulatedAccount) throw new AppError("Fixed asset depreciation accounts are missing or inactive.", 422, "FIXED_ASSET_ACCOUNTS_INVALID");
    const period = periodKeyForDate(normalizeDate(postingDate || now(), now()));
    const sourceEntityId = String(asset._id);
    return createJournal({
      input: {
        entryDate: postingDate || now(),
        postingDate: postingDate || now(),
        sourceModule: SOURCE_MODULE.BUSINESS_ACCOUNTING,
        sourceEntityType: "FixedAssetDepreciation",
        sourceEntityId,
        sourceReference: `${asset.assetReference}:${period}`,
        postingType: GL_POSTING_TYPE.DEPRECIATION,
        postingKey: `FIXED_ASSET_DEPRECIATION:${asset.assetReference}:${period}`,
        description: `Depreciation for ${asset.assetReference} - ${period}`,
        currency: asset.currency,
        requiresApproval: true,
        reason: reason || "Fixed asset depreciation journal generated for review",
        metadata: { assetReference: asset.assetReference, period, basis: "STRAIGHT_LINE_SCHEDULE" },
        lines: [
          { accountCode: expenseAccount.code, description: `Depreciation expense - ${asset.assetReference}`, debit: amount.toFixed() },
          { accountCode: accumulatedAccount.code, description: `Accumulated depreciation - ${asset.assetReference}`, credit: amount.toFixed() }
        ]
      },
      status: JOURNAL_STATUS.DRAFT,
      auth,
      requestId
    });
  };

  const createFixedAssetAcquisitionJournal = async ({ assetId, fundingAccountCode = "1010", postingDate, auth = {}, requestId = "", reason = "", evidence = {} } = {}) => {
    const asset = await leanMaybe(FixedAssetModel.findById(assetId));
    if (!asset) throw new AppError("Fixed asset was not found.", 404, "FIXED_ASSET_NOT_FOUND");
    const amount = money(asset.purchaseCost, { allowNegative: false, field: "asset.purchaseCost" });
    const key = `FIXED_ASSET_ACQUISITION:${asset.assetReference}`;
    return createJournal({
      input: {
        entryDate: postingDate || asset.startDate || now(),
        postingDate: postingDate || asset.startDate || now(),
        sourceModule: SOURCE_MODULE.BUSINESS_ACCOUNTING,
        sourceEntityType: "FixedAssetAcquisition",
        sourceEntityId: String(asset._id),
        sourceReference: asset.assetReference,
        postingType: GL_POSTING_TYPE.FIXED_ASSET_ACQUISITION,
        postingKey: key,
        description: `Fixed asset acquisition - ${asset.assetReference}`,
        currency: asset.currency,
        requiresApproval: true,
        reason: reason || "Fixed asset acquisition journal generated for review",
        evidence,
        metadata: { assetReference: asset.assetReference, acquisitionBasis: "VERIFIED_SOURCE_EVIDENCE_REQUIRED" },
        lines: [
          { accountCode: (await leanMaybe(ChartOfAccountModel.findById(asset.assetAccount))).code, description: `Asset cost - ${asset.assetReference}`, debit: toDecimal(amount).toFixed() },
          { accountCode: fundingAccountCode, description: `Funding for - ${asset.assetReference}`, credit: toDecimal(amount).toFixed() }
        ]
      },
      status: JOURNAL_STATUS.DRAFT,
      auth,
      requestId
    });
  };

  const fixedAssetDepreciationPlan = (asset = {}) => {
    const depreciable = toDecimal(asset.purchaseCost || 0).minus(toDecimal(asset.salvageValue || 0));
    const monthly = depreciable.dividedBy(Number(asset.usefulLifeMonths || 1)).toDecimalPlaces(2);
    return {
      assetReference: asset.assetReference,
      method: asset.depreciationMethod || DEPRECIATION_METHOD.STRAIGHT_LINE,
      monthlyDepreciation: monthly.toFixed(),
      usefulLifeMonths: asset.usefulLifeMonths,
      startDate: asset.startDate,
      automaticPostingEnabled: false
    };
  };

  const fixedAssetValues = (asset = {}, asOf = now()) => {
    const cost = toDecimal(asset.purchaseCost || 0); const salvage = toDecimal(asset.salvageValue || 0);
    const monthly = cost.minus(salvage).dividedBy(Number(asset.usefulLifeMonths || 1)).toDecimalPlaces(2);
    const start = new Date(asset.startDate); const end = asset.disposedAt && new Date(asset.disposedAt) < asOf ? new Date(asset.disposedAt) : asOf;
    const elapsed = end < start ? 0 : Math.max(0, (end.getUTCFullYear()-start.getUTCFullYear())*12+end.getUTCMonth()-start.getUTCMonth());
    const months = Math.min(Number(asset.usefulLifeMonths || 0), start <= asOf ? elapsed + 1 : 0); const accumulated = Decimal.min(monthly.times(months), cost.minus(salvage));
    return { scheduledAccumulatedDepreciation: accumulated.toFixed(), netBookValue: cost.minus(accumulated).toFixed(), monthlyDepreciation: monthly.toFixed(), elapsedMonths: months, fullyDepreciated: months >= Number(asset.usefulLifeMonths || 0) };
  };

  const getFixedAssets = async () => {
    const rows = asArray(await leanMaybe(FixedAssetModel.find({})));
    const items = rows.map((asset) => ({ ...asset, category: asset.metadata?.category || "Uncategorized", location: asset.metadata?.location || "", depreciationPlan: fixedAssetDepreciationPlan(asset), values: fixedAssetValues(asset) }));
    const currencies = Array.from(new Set(items.map((row)=>normalizeEnumToken(row.currency)).filter(Boolean)));
    const canCombine = currencies.length <= 1;
    const sum = (field) => canCombine ? items.reduce((total,row)=>total.plus(toDecimal(field(row)||0)),new Decimal(0)).toFixed() : null;
    const categoryMap = new Map(); items.forEach((row)=>{const key=row.category;const current=categoryMap.get(key)||{category:key,count:0,cost:new Decimal(0),netBookValue:new Decimal(0)};current.count+=1;current.cost=current.cost.plus(toDecimal(row.purchaseCost||0));current.netBookValue=current.netBookValue.plus(toDecimal(row.values.netBookValue));categoryMap.set(key,current)});
    return {
      items,
      count: items.length,
      summary: { totalCost: sum(row=>row.purchaseCost), scheduledAccumulatedDepreciation: sum(row=>row.values.scheduledAccumulatedDepreciation), netBookValue: sum(row=>row.values.netBookValue), monthlyDepreciation: sum(row=>row.values.monthlyDepreciation), currency: currencies.length===1?currencies[0]:"", currencies, mixedCurrencies: currencies.length>1, depreciationBasis:"STRAIGHT_LINE_SCHEDULE_NOT_POSTED_GL" },
      categories: Array.from(categoryMap.values()).map(row=>({category:row.category,count:row.count,cost:row.cost.toFixed(),netBookValue:row.netBookValue.toFixed()})),
      warnings: ["Scheduled depreciation is an estimate. Automatic depreciation journal posting is not enabled; posted GL depreciation remains the financial-statement authority."]
    };
  };

  const exportLedgerReport = async ({ reportType = "general-ledger", format = "csv", filters = {} } = {}) => {
    const normalizedType = normalizeToken(reportType || "general-ledger").toLowerCase();
    const normalizedFormat = normalizeToken(format || "csv").toLowerCase();
    let report;
    if (normalizedType === "trial-balance") report = await getTrialBalance(filters);
    else if (normalizedType === "profit-loss") report = await getProfitLoss(filters);
    else if (normalizedType === "balance-sheet") report = await getBalanceSheet(filters);
    else if (normalizedType === "cash-flow") report = await getCashFlow(filters);
    else if (normalizedType === "fixed-assets") report = await getFixedAssets(filters);
    else if (normalizedType === "reconciliation") report = await getReconciliation(filters);
    else report = await getGeneralLedger(filters);
    const rows = report.items || report.modules || Object.entries(report.totals || {}).map(([key, value]) => ({ key, value }));
    const csv = [
      Object.keys(rows[0] || { report: normalizedType }).join(","),
      ...rows.map((row) => Object.values(row).map((value) => JSON.stringify(value ?? "")).join(","))
    ].join("\r\n");
    if (normalizedFormat === "json") {
      return { content: JSON.stringify(report, null, 2), contentType: "application/json", filename: `${normalizedType}.json` };
    }
    if (normalizedFormat === "pdf") {
      return { content: `PDF EXPORT PLACEHOLDER\n${csv}`, contentType: "application/pdf", filename: `${normalizedType}.pdf` };
    }
    if (["xlsx", "excel"].includes(normalizedFormat)) {
      return { content: csv, contentType: "application/vnd.ms-excel", filename: `${normalizedType}.xls` };
    }
    return { content: csv, contentType: "text/csv; charset=utf-8", filename: `${normalizedType}.csv` };
  };

  return {
    approveJournal,
    closePeriod,
    createFixedAsset,
    createFixedAssetDepreciationJournal,
    createFixedAssetAcquisitionJournal,
    createJournal,
    createManualJournal,
    createOrGetPeriod,
    exportLedgerReport,
    fixedAssetDepreciationPlan,
    getAccountingHealth,
    getBalanceSheet,
    getCashBankDashboard,
    getCashFlow,
    getFixedAssets,
    getGeneralLedger,
    getProfitLoss,
    getPeriodCloseOverview,
    getReconciliation,
    getTrialBalance,
    listJournals,
    listPeriods,
    postBusinessExpense,
    postSupplierPayment,
    postBusinessIncome,
    postCustomerInvoice,
    postCustomerPayment,
    postJournal,
    postOwnerCapital,
    postProviderSettlement,
    postRefundApproval,
    postRefundCompletion,
    postSourceEvent,
    reopenPeriod,
    reverseJournal,
    runHistoricalMigration,
    seedDefaultMappings
  };
};

const service = createGeneralLedgerService();

module.exports = {
  ...service,
  createGeneralLedgerService,
  __testables: {
    buildPostingKey: ({ sourceModule, sourceEntityId, sourceReference, postingType }) =>
      [
        normalizeEnumToken(sourceModule || SOURCE_MODULE.MANUAL),
        normalizeToken(sourceEntityId || sourceReference || "manual"),
        normalizeEnumToken(postingType || GL_POSTING_TYPE.MANUAL_JOURNAL)
      ].join(":"),
    expenseMappingKey,
    fixedAssetDepreciationPlan: service.fixedAssetDepreciationPlan,
    normalizeJournalForApi,
    normalizeLineForApi,
    periodKeyForDate,
    providerMappingKey,
    revenueMappingKey
  }
};
