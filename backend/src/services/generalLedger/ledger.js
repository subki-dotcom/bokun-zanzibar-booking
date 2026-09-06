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
  return GL_MAPPING_KEY.BANK;
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
    exchangeRate: apiMoney(row.exchangeRate || "1"),
    totalDebit: apiMoney(row.totalDebit),
    totalCredit: apiMoney(row.totalCredit),
    baseCurrency: row.baseCurrency || row.currency || "",
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
    exchangeRate: apiMoney(row.exchangeRate || "1"),
    baseCurrencyDebit: apiMoney(row.baseCurrencyDebit),
    baseCurrencyCredit: apiMoney(row.baseCurrencyCredit),
    baseCurrency: row.baseCurrency || row.currency || "",
    businessUnit: row.businessUnit || BUSINESS_UNIT.UNALLOCATED,
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

  const normalizeJournalLines = async ({ lines = [], currency = "USD", baseCurrency = "USD", exchangeRate = "1", source = {}, dimensions = {} }) => {
    if (!asArray(lines).length) {
      throw new AppError("At least two journal lines are required.", 422, "GL_LINES_REQUIRED");
    }

    const normalizedCurrency = requireCurrency(currency);
    const normalizedBaseCurrency = requireCurrency(baseCurrency || currency);
    const rate = money(exchangeRate || 1, { allowNegative: false, field: "exchangeRate" });

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

      resolved.push({
        account,
        description: normalizeToken(line.description || ""),
        debit,
        credit,
        currency: normalizeCurrency(line.currency) || normalizedCurrency,
        exchangeRate: money(line.exchangeRate || rate, { allowNegative: false, field: "line.exchangeRate" }),
        baseCurrencyDebit: multiply(debit, line.exchangeRate || rate),
        baseCurrencyCredit: multiply(credit, line.exchangeRate || rate),
        baseCurrency: normalizedBaseCurrency,
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
      exchangeRate: rate
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
      baseCurrencyDebit: toDecimal128(line.baseCurrencyDebit),
      baseCurrencyCredit: toDecimal128(line.baseCurrencyCredit),
      baseCurrency: line.baseCurrency,
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
      currency: input.currency || "USD",
      baseCurrency: input.baseCurrency || input.currency || "USD",
      exchangeRate: input.exchangeRate || 1,
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

  const postCustomerInvoice = async ({ invoice = {}, booking = {}, auth = {}, requestId = "" } = {}) => {
    const amount = money(invoice.accountingTotal || invoice.total || invoice.amount || 0, { allowNegative: false, field: "invoice.amount" });
    const currency = requireCurrency(invoice.accountingCurrency || invoice.currency || booking.currency || "USD");
    return postSourceEvent({
      event: {
        sourceModule: SOURCE_MODULE.INVOICE,
        sourceEntityType: "Invoice",
        sourceEntityId: normalizeId(invoice._id) || invoice.invoiceNumber,
        sourceReference: invoice.invoiceNumber || invoice.bookingReference || booking.bookingReference,
        postingType: GL_POSTING_TYPE.CUSTOMER_INVOICE,
        postingDate: invoice.issueDate || invoice.createdAt || booking.createdAt,
        description: `Invoice revenue recognized for ${invoice.invoiceNumber || invoice.bookingReference}`,
        currency,
        lines: [
          { mappingKey: GL_MAPPING_KEY.ACCOUNTS_RECEIVABLE, debit: amount, bookingReference: invoice.bookingReference },
          { mappingKey: revenueMappingKey(booking), credit: amount, bookingReference: invoice.bookingReference }
        ],
        sourceSnapshot: { invoice, booking }
      },
      auth,
      requestId
    });
  };

  const postCustomerPayment = async ({ payment = {}, auth = {}, requestId = "" } = {}) => {
    const amount = money(payment.accountingAmount || payment.amountPaid || payment.paidAmount || payment.amount || 0, { allowNegative: false, field: "payment.amount" });
    const fee = money(payment.providerFeeAmount || 0, { allowNegative: false, field: "payment.providerFee" });
    const currency = requireCurrency(payment.accountingCurrency || payment.currency || payment.orderCurrency || "USD");
    const clearingKey = providerMappingKey(payment.provider || payment.paymentProvider || payment.providerName);
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
          { mappingKey: providerMappingKey(refund.provider), credit: amount, bookingReference: refund.bookingReference }
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
    const creditKey = normalizeEnumToken(expense.paymentStatus) === "PAID" ? GL_MAPPING_KEY.BANK : GL_MAPPING_KEY.ACCOUNTS_PAYABLE;
    return postSourceEvent({
      event: {
        sourceModule: SOURCE_MODULE.BUSINESS_ACCOUNTING,
        sourceEntityType: "BusinessExpense",
        sourceEntityId: normalizeId(expense._id) || expense.expenseReference,
        sourceReference: expense.expenseReference || "",
        postingType: GL_POSTING_TYPE.BUSINESS_EXPENSE,
        postingDate: expense.expenseDate || expense.transactionDate || expense.createdAt,
        description: expense.description || `Business expense ${expense.expenseReference || ""}`.trim(),
        currency,
        lines: [
          { mappingKey: expenseMappingKey(expense.category), debit: amount, supplierId: expense.supplier?.supplierId || "" },
          { mappingKey: creditKey, credit: amount, supplierId: expense.supplier?.supplierId || "" }
        ],
        sourceSnapshot: { expense }
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

  const getTrialBalance = async ({ fromDate = "", toDate = "" } = {}) => {
    const rows = await summarizeAccounts({ fromDate, toDate });
    let totalDebit = new Decimal(0);
    let totalCredit = new Decimal(0);
    const items = rows.map((row) => {
      const debitBalance = row.openingDebit.plus(row.periodDebit);
      const creditBalance = row.openingCredit.plus(row.periodCredit);
      const net = debitBalance.minus(creditBalance);
      const closingDebit = net.greaterThanOrEqualTo(0) ? net : new Decimal(0);
      const closingCredit = net.isNegative() ? net.abs() : new Decimal(0);
      totalDebit = totalDebit.plus(closingDebit);
      totalCredit = totalCredit.plus(closingCredit);
      return {
        accountCode: row.accountCode,
        accountName: row.accountName,
        accountType: row.accountType,
        accountSubtype: row.accountSubtype,
        openingDebit: row.openingDebit.toFixed(),
        openingCredit: row.openingCredit.toFixed(),
        periodDebit: row.periodDebit.toFixed(),
        periodCredit: row.periodCredit.toFixed(),
        closingDebit: closingDebit.toFixed(),
        closingCredit: closingCredit.toFixed()
      };
    });
    const balanced = totalDebit.equals(totalCredit);
    return {
      items,
      totals: {
        debit: totalDebit.toFixed(),
        credit: totalCredit.toFixed(),
        difference: totalDebit.minus(totalCredit).abs().toFixed()
      },
      balanced,
      accountingError: balanced ? null : "CRITICAL_ACCOUNTING_ERROR"
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
    const rows = await summarizeAccounts({ fromDate, toDate });
    const section = (types) =>
      rows
        .filter((row) => types.includes(row.accountType))
        .map((row) => ({
          accountCode: row.accountCode,
          accountName: row.accountName,
          accountType: row.accountType,
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
    return {
      sections: { revenue, costOfSales, operatingExpenses, otherIncome, otherExpenses },
      totals: {
        revenue: sum(revenue).toFixed(),
        costOfSales: sum(costOfSales).toFixed(),
        grossProfit: grossProfit.toFixed(),
        operatingExpenses: sum(operatingExpenses).toFixed(),
        operatingProfit: operatingProfit.toFixed(),
        otherIncome: sum(otherIncome).toFixed(),
        otherExpenses: sum(otherExpenses).toFixed(),
        netProfit: netProfit.toFixed()
      },
      source: "GENERAL_LEDGER"
    };
  };

  const getBalanceSheet = async ({ asOfDate = "" } = {}) => {
    const rows = await summarizeAccounts({ toDate: asOfDate });
    const byType = (types) =>
      rows
        .filter((row) => types.includes(row.accountType))
        .map((row) => ({
          accountCode: row.accountCode,
          accountName: row.accountName,
          accountType: row.accountType,
          accountSubtype: row.accountSubtype,
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
    const balanced = totalAssets.equals(totalLiabilities.plus(totalEquity));
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
      accountingError: balanced ? null : "BALANCE_SHEET_OUT_OF_BALANCE"
    };
  };

  const getCashFlow = async ({ fromDate = "", toDate = "" } = {}) => {
    const lines = (await allPostedLines()).filter((line) => lineInRange(line, fromDate, toDate));
    const cashLines = lines.filter((line) =>
      [GL_ACCOUNT_SUBTYPE.CASH, GL_ACCOUNT_SUBTYPE.BANK, GL_ACCOUNT_SUBTYPE.MOBILE_MONEY, GL_ACCOUNT_SUBTYPE.PROVIDER_CLEARING].includes(line.accountSubtype)
    );
    const buckets = {
      operating: new Decimal(0),
      investing: new Decimal(0),
      financing: new Decimal(0)
    };
    cashLines.forEach((line) => {
      const movement = toDecimal(line.baseCurrencyDebit || 0).minus(toDecimal(line.baseCurrencyCredit || 0));
      const postingType = normalizeEnumToken(line.postingType);
      if ([GL_POSTING_TYPE.OWNER_CAPITAL_INJECTION, GL_POSTING_TYPE.OWNER_DRAWING].includes(postingType)) {
        buckets.financing = buckets.financing.plus(movement);
      } else if ([GL_POSTING_TYPE.DEPRECIATION].includes(postingType)) {
        buckets.investing = buckets.investing.plus(movement);
      } else {
        buckets.operating = buckets.operating.plus(movement);
      }
    });
    const netChange = buckets.operating.plus(buckets.investing).plus(buckets.financing);
    return {
      statementType: "CASH_FLOW_FOUNDATION",
      note: "This is ledger-derived cash movement foundation, distinct from the existing management cash flow report.",
      activities: {
        operating: buckets.operating.toFixed(),
        investing: buckets.investing.toFixed(),
        financing: buckets.financing.toFixed()
      },
      netChange: netChange.toFixed(),
      lines: cashLines.map(normalizeLineForApi)
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
    const pendingRefunds = RefundModel.countDocuments ? await RefundModel.countDocuments({ status: { $in: ["requested", "approved", "processing", "awaiting_merchant_approval"] } }) : 0;
    const unpostedExpenses = BusinessExpenseModel.countDocuments ? await BusinessExpenseModel.countDocuments({ accountingPostingId: null, status: { $ne: "VOID" } }) : 0;
    const unreconciledPayments = PaymentModel.countDocuments ? await PaymentModel.countDocuments({ status: "paid", settlementStatus: { $ne: "settled" } }) : 0;
    const unbalancedDraftJournals = asArray(await leanMaybe(JournalEntryModel.find({ status: { $ne: JOURNAL_STATUS.POSTED } }))).filter(
      (entry) => !toDecimal(entry.baseTotalDebit || 0).equals(toDecimal(entry.baseTotalCredit || 0))
    ).length;
    return {
      period: period.periodKey,
      unreconciledPayments,
      pendingRefunds,
      unpostedExpenses,
      unbalancedJournals: unbalancedDraftJournals,
      openSupplierBills: unpostedExpenses,
      dataQualityWarnings: pendingRefunds + unpostedExpenses + unreconciledPayments
    };
  };

  const closePeriod = async ({ periodId, reason = "", auth = {}, requestId = "" } = {}) => {
    if (!reason) throw new AppError("Period close reason is required.", 422, "GL_PERIOD_REASON_REQUIRED");
    const period = await leanMaybe(AccountingPeriodModel.findById(periodId));
    if (!period) throw new AppError("Accounting period not found.", 404, "GL_PERIOD_NOT_FOUND");
    if (period.status === ACCOUNTING_PERIOD_STATUS.LOCKED) {
      throw new AppError("Locked periods cannot be closed again.", 409, "GL_PERIOD_LOCKED");
    }
    const checklist = await buildPeriodCloseChecklist(period);
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
    const trialBalance = await getTrialBalance({ fromDate, toDate });
    const gl = await getGeneralLedger({ fromDate, toDate, limit: 5000 });
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
      risks: [
        "Historical source events are not backfilled until the controlled migration is run.",
        "Subledger totals are reported as foundation until full AR/AP backfill is applied."
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

  const getFixedAssets = async () => {
    const rows = asArray(await leanMaybe(FixedAssetModel.find({})));
    return {
      items: rows.map((asset) => ({
        ...asset,
        depreciationPlan: fixedAssetDepreciationPlan(asset)
      })),
      count: rows.length
    };
  };

  const exportLedgerReport = async ({ reportType = "general-ledger", format = "csv", filters = {} } = {}) => {
    const normalizedType = normalizeToken(reportType || "general-ledger").toLowerCase();
    const normalizedFormat = normalizeToken(format || "csv").toLowerCase();
    let report;
    if (normalizedType === "trial-balance") report = await getTrialBalance(filters);
    else if (normalizedType === "profit-loss") report = await getProfitLoss(filters);
    else if (normalizedType === "balance-sheet") report = await getBalanceSheet(filters);
    else report = await getGeneralLedger(filters);
    const rows = report.items || Object.entries(report.totals || {}).map(([key, value]) => ({ key, value }));
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
    createJournal,
    createManualJournal,
    createOrGetPeriod,
    exportLedgerReport,
    fixedAssetDepreciationPlan,
    getAccountingHealth,
    getBalanceSheet,
    getCashFlow,
    getFixedAssets,
    getGeneralLedger,
    getProfitLoss,
    getReconciliation,
    getTrialBalance,
    listJournals,
    listPeriods,
    postBusinessExpense,
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
