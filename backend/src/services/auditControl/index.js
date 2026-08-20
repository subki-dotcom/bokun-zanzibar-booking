const AuditLog = require("../../models/AuditLog");

const SENSITIVE_KEY_PATTERN =
  /(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|consumer[_-]?secret|company[_-]?token|authorization|password|passcode|card[_-]?(?:number|pan)|cvv|cvc|private[_-]?key|api[_-]?key|secret|signature|webhook[_-]?secret)/i;
const LONG_DIGIT_PATTERN = /\b\d{12,19}\b/g;
const FINANCIAL_ENTITY_TYPES = Object.freeze([
  "AccountingPosting",
  "BusinessExpense",
  "BusinessIncome",
  "BookingFinancialSnapshot",
  "BookingRequest",
  "CommissionRecord",
  "Invoice",
  "Payment",
  "Refund"
]);
const FINANCIAL_ACTION_PATTERN =
  /(accounting|posting|invoice|payment|refund|expense|income|commission|payroll|cash|cost|fee|profit|receivable|payable|settlement|financial|snapshot|adjustment)/i;
const MONEY_FIELD_PATTERN =
  /(amount|total|balance|paid|refunded|refund|revenue|cost|expense|income|profit|fee|commission|receivable|payable|cash|price|rate|margin|tax|discount|net|gross|outstanding)/i;

const normalizeToken = (value = "") => String(value || "").trim();
const parseDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const toIso = (value) => {
  const date = parseDate(value);
  return date ? date.toISOString() : "";
};

const maskSensitiveDigits = (value) =>
  String(value).replace(LONG_DIGIT_PATTERN, (digits) => `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`);

const sanitizeAuditPayload = (value, depth = 0) => {
  if (value === null || value === undefined) return value;
  if (depth > 8) return "[truncated]";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return maskSensitiveDigits(value).slice(0, 5000);
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeAuditPayload(item, depth + 1));

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 250)
      .map(([key, item]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : sanitizeAuditPayload(item, depth + 1)
      ])
  );
};

const decimalLikeToString = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "$numberDecimal")) {
    return String(value.$numberDecimal);
  }
  if (typeof value === "object" && value._bsontype === "Decimal128" && typeof value.toString === "function") {
    return value.toString();
  }
  return String(value);
};

const comparableValue = (value) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "$numberDecimal")) {
    return String(value.$numberDecimal);
  }
  if (typeof value === "object" && value._bsontype === "Decimal128" && typeof value.toString === "function") {
    return value.toString();
  }
  if (typeof value === "object") return JSON.stringify(sanitizeAuditPayload(value));
  return String(value);
};

const numericValue = (value) => {
  const text = decimalLikeToString(value).replace(/,/g, "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
};

const collectFinancialFields = (value, prefix = "", output = new Map(), depth = 0) => {
  if (value === null || value === undefined || depth > 8) return output;
  if (typeof value !== "object" || value instanceof Date) {
    const key = prefix.split(".").pop() || "";
    if (MONEY_FIELD_PATTERN.test(key)) output.set(prefix, value);
    return output;
  }

  Object.entries(value).forEach(([key, item]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (MONEY_FIELD_PATTERN.test(key) && (typeof item !== "object" || item === null || item instanceof Date || item.$numberDecimal)) {
      output.set(path, item);
    }
    if (item && typeof item === "object" && !(item instanceof Date) && !item.$numberDecimal) {
      collectFinancialFields(item, path, output, depth + 1);
    }
  });

  return output;
};

const summarizeFinancialChange = ({ before = {}, after = {}, action = "", entityType = "" } = {}) => {
  const beforeFields = collectFinancialFields(before || {});
  const afterFields = collectFinancialFields(after || {});
  const paths = new Set([...beforeFields.keys(), ...afterFields.keys()]);
  const changedFields = [];

  paths.forEach((path) => {
    const previousValue = beforeFields.get(path);
    const nextValue = afterFields.get(path);
    if (comparableValue(previousValue) === comparableValue(nextValue)) return;
    changedFields.push({
      field: path,
      before: sanitizeAuditPayload(previousValue),
      after: sanitizeAuditPayload(nextValue),
      beforeNumber: numericValue(previousValue),
      afterNumber: numericValue(nextValue)
    });
  });

  const financialAction = FINANCIAL_ENTITY_TYPES.includes(entityType) || FINANCIAL_ACTION_PATTERN.test(action);
  return {
    financialAction,
    moneyChanged: changedFields.length > 0,
    changedFields: changedFields.slice(0, 25),
    maxAbsoluteAmount: changedFields.reduce((max, field) => {
      const amounts = [field.beforeNumber, field.afterNumber].filter((amount) => Number.isFinite(amount));
      const localMax = amounts.length ? Math.max(...amounts.map((amount) => Math.abs(amount))) : 0;
      return Math.max(max, localMax);
    }, 0)
  };
};

const firstNonEmpty = (...values) => values.find((value) => normalizeToken(value) !== "") || "";

const deriveReference = (record = {}) =>
  firstNonEmpty(
    record.reference,
    record.after?.bookingReference,
    record.before?.bookingReference,
    record.metadata?.bookingReference,
    record.after?.invoiceNumber,
    record.before?.invoiceNumber,
    record.metadata?.invoiceNumber,
    record.metadata?.paymentReference,
    record.metadata?.refundReference,
    record.after?.sourceReference,
    record.before?.sourceReference,
    record.entityId
  );

const normalizeAuditLog = (record = {}) => {
  const before = sanitizeAuditPayload(record.before || null);
  const after = sanitizeAuditPayload(record.after || null);
  const metadata = sanitizeAuditPayload(record.metadata || {});
  const changeSummary = summarizeFinancialChange({
    before,
    after,
    action: record.action || "",
    entityType: record.entityType || ""
  });
  const createdAt = toIso(record.createdAt || record.timestamp);

  return {
    id: normalizeToken(record.id || record._id),
    actor: {
      id: record.actorId || null,
      role: record.actorRole || "system"
    },
    action: record.action || "",
    entity: {
      type: record.entityType || "",
      id: record.entityId || ""
    },
    reference: deriveReference(record),
    reason: record.reason || "",
    timestamp: createdAt,
    requestId: record.requestId || "",
    correlationId: record.correlationId || record.requestId || "",
    ipAddress: record.ipAddress || "",
    userAgent: record.userAgent || "",
    before,
    after,
    metadata,
    changeSummary
  };
};

const isFinancialAudit = (record = {}) => {
  const entityType = record.entityType || "";
  const action = record.action || "";
  return FINANCIAL_ENTITY_TYPES.includes(entityType) || FINANCIAL_ACTION_PATTERN.test(action);
};

const makeRegex = (value) => new RegExp(normalizeToken(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

const buildBaseQuery = ({ action = "", entityType = "", entityId = "", actorId = "", actorRole = "", reference = "", fromDate = "", toDate = "" } = {}) => {
  const query = {};
  if (action) query.action = action;
  if (entityType) query.entityType = entityType;
  if (entityId) query.entityId = entityId;
  if (actorId) query.actorId = actorId;
  if (actorRole) query.actorRole = actorRole;

  const from = parseDate(fromDate);
  const to = parseDate(toDate);
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = from;
    if (to) query.createdAt.$lte = to;
  }

  if (reference) {
    const regex = makeRegex(reference);
    query.$or = [
      { reference: regex },
      { entityId: regex },
      { requestId: regex },
      { correlationId: regex },
      { "before.bookingReference": regex },
      { "after.bookingReference": regex },
      { "metadata.bookingReference": regex },
      { "metadata.invoiceNumber": regex },
      { "metadata.paymentReference": regex },
      { "metadata.refundReference": regex }
    ];
  }

  return query;
};

const buildFinancialQuery = (filters = {}) => {
  const base = buildBaseQuery(filters);
  const financialClause = {
    $or: [
      { entityType: { $in: FINANCIAL_ENTITY_TYPES } },
      { action: FINANCIAL_ACTION_PATTERN }
    ]
  };

  if (base.$or) {
    const referenceClause = { $or: base.$or };
    delete base.$or;
    return {
      ...base,
      $and: [referenceClause, financialClause]
    };
  }

  return {
    ...base,
    ...financialClause
  };
};

const asArrayFromQuery = async ({ queryResult, sort = { createdAt: -1 }, skip = 0, limit = 50 }) => {
  if (Array.isArray(queryResult)) {
    return queryResult
      .slice()
      .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0))
      .slice(skip, skip + limit);
  }

  const sorted = queryResult.sort ? queryResult.sort(sort) : queryResult;
  const skipped = sorted.skip ? sorted.skip(skip) : sorted;
  const limited = skipped.limit ? skipped.limit(limit) : skipped;
  return limited.lean ? limited.lean() : limited;
};

const countForQuery = async ({ Model, query, fallbackItems = null }) => {
  if (Model?.countDocuments) return Model.countDocuments(query);
  if (Array.isArray(fallbackItems)) return fallbackItems.length;
  return 0;
};

const filterByAmount = (items, { minAmount, maxAmount } = {}) => {
  const min = minAmount === undefined || minAmount === null || minAmount === "" ? null : Number(minAmount);
  const max = maxAmount === undefined || maxAmount === null || maxAmount === "" ? null : Number(maxAmount);
  if (!Number.isFinite(min) && !Number.isFinite(max)) return items;

  return items.filter((item) => {
    const amount = item.changeSummary?.maxAbsoluteAmount || 0;
    if (Number.isFinite(min) && amount < min) return false;
    if (Number.isFinite(max) && amount > max) return false;
    return true;
  });
};

const createPagination = ({ page = 1, limit = 50, total = 0 }) => {
  const currentPage = Math.max(Number(page || 1), 1);
  const safeLimit = Math.min(Math.max(Number(limit || 50), 1), 200);
  return {
    page: currentPage,
    limit: safeLimit,
    total,
    totalPages: total > 0 ? Math.ceil(total / safeLimit) : 0,
    hasNextPage: currentPage * safeLimit < total
  };
};

const createAuditControlService = ({ AuditLogModel = AuditLog, now = () => new Date() } = {}) => {
  const listAuditLogs = async (filters = {}) => {
    const pagination = createPagination(filters);
    const query = buildBaseQuery(filters);
    const skip = (pagination.page - 1) * pagination.limit;
    const raw = await asArrayFromQuery({
      queryResult: AuditLogModel.find(query),
      skip,
      limit: pagination.limit
    });
    const items = (raw || []).map(normalizeAuditLog);
    const total = await countForQuery({ Model: AuditLogModel, query, fallbackItems: raw });

    return {
      generatedAt: now().toISOString(),
      items,
      pagination: createPagination({ ...pagination, total }),
      immutable: true,
      secretsSanitized: true
    };
  };

  const listFinancialChanges = async (filters = {}) => {
    const pagination = createPagination(filters);
    const query = buildFinancialQuery(filters);
    const skip = (pagination.page - 1) * pagination.limit;
    const raw = await asArrayFromQuery({
      queryResult: AuditLogModel.find(query),
      skip,
      limit: pagination.limit
    });
    const normalized = (raw || [])
      .map(normalizeAuditLog)
      .filter((item) => isFinancialAudit({ entityType: item.entity.type, action: item.action }));
    const amountFiltered = filterByAmount(normalized, filters);
    const total = await countForQuery({ Model: AuditLogModel, query, fallbackItems: raw });

    return {
      generatedAt: now().toISOString(),
      items: amountFiltered,
      pagination: createPagination({ ...pagination, total }),
      viewAnswers: {
        whoChangedTheMoney: amountFiltered.map((item) => item.actor),
        whatChanged: amountFiltered.map((item) => ({
          action: item.action,
          entity: item.entity,
          reference: item.reference,
          changedFields: item.changeSummary.changedFields.map((field) => field.field)
        })),
        whenChanged: amountFiltered.map((item) => item.timestamp),
        whyChanged: amountFiltered.map((item) => item.reason).filter(Boolean)
      },
      immutable: true,
      secretsSanitized: true
    };
  };

  const getSummary = async (filters = {}) => {
    const base = buildBaseQuery(filters);
    const financialQuery = buildFinancialQuery(filters);
    const [totalAuditEvents, totalFinancialChanges, latestRaw] = await Promise.all([
      countForQuery({ Model: AuditLogModel, query: base }),
      countForQuery({ Model: AuditLogModel, query: financialQuery }),
      asArrayFromQuery({
        queryResult: AuditLogModel.find(financialQuery),
        skip: 0,
        limit: 1
      })
    ]);
    const latest = (latestRaw || []).map(normalizeAuditLog)[0] || null;

    return {
      generatedAt: now().toISOString(),
      totalAuditEvents,
      totalFinancialChanges,
      latestFinancialChangeAt: latest?.timestamp || "",
      immutableAudit: true,
      secretsSanitized: true,
      availableViews: [
        "AUDIT_LOGS",
        "FINANCIAL_CHANGES"
      ],
      limitations: [
        "Login history is implemented in a later Step 5 sub-phase.",
        "Failed jobs and system alerts are exposed through the operations-control module.",
        "Financial change classification uses existing AuditLog entity/action evidence and does not rewrite historical audit records."
      ]
    };
  };

  return {
    getSummary,
    listAuditLogs,
    listFinancialChanges
  };
};

const service = createAuditControlService();

module.exports = {
  ...service,
  createAuditControlService,
  __testables: {
    buildBaseQuery,
    buildFinancialQuery,
    deriveReference,
    normalizeAuditLog,
    sanitizeAuditPayload,
    summarizeFinancialChange
  }
};
