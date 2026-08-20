const { v4: uuidv4 } = require("uuid");
const AccountingPosting = require("../../models/AccountingPosting");
const AuditLog = require("../../models/AuditLog");
const Booking = require("../../models/Booking");
const BusinessExpense = require("../../models/BusinessExpense");
const BusinessIncome = require("../../models/BusinessIncome");
const CommissionRecord = require("../../models/CommissionRecord");
const Invoice = require("../../models/Invoice");
const Payment = require("../../models/Payment");
const Refund = require("../../models/Refund");
const {
  ACCOUNTING_SCOPE,
  BUSINESS_UNIT,
  COUNTED_FINANCIAL_STATUSES,
  EXPENSE_CATEGORY,
  EXPENSE_PAYMENT_STATUS,
  FINANCIAL_ENTRY_STATUS,
  INCOME_CATEGORY,
  POSTING_DIRECTION,
  POSTING_TYPE,
  SOURCE_MODULE
} = require("../../accounting/constants");
const AppError = require("../../utils/AppError");
const {
  Decimal,
  add,
  decimalOrNull,
  decimalString,
  decimalToApi,
  multiply,
  normalizeCurrency,
  requireCurrency,
  subtract,
  toDecimal
} = require("../../utils/money");

const FINAL_REFUND_STATUSES = new Set(["refunded", "partially_refunded"]);

const normalizeToken = (value = "") => String(value || "").trim();

const leanMaybe = async (value) => {
  if (value && typeof value.lean === "function") return value.lean();
  return value;
};

const asArray = (value) => (Array.isArray(value) ? value : []);

const moneyOrZero = (value) => {
  const normalized = decimalToApi(value);
  if (normalized !== null && normalized !== undefined) return normalized;
  try {
    return decimalString(value ?? 0);
  } catch (error) {
    return "0";
  }
};

const numberOrZero = (value) => {
  try {
    return Number(toDecimal(value ?? 0).toFixed(2));
  } catch (error) {
    return 0;
  }
};

const toApiMoney = (value) => Number(toDecimal(value || 0).toFixed(2));

const paymentIdentity = (payment = {}) =>
  normalizeToken(payment.intentId || payment.providerTransactionId || payment.orderTrackingId || payment._id);

const hasCanonicalPaymentAccounting = (payment = {}) =>
  payment?.accountingAmount !== null &&
  payment?.accountingAmount !== undefined &&
  Boolean(normalizeCurrency(payment.accountingCurrency));

const paymentIsCountable = (payment = {}) => {
  if (String(payment.status || "").toLowerCase() !== "paid") return false;
  if (!hasCanonicalPaymentAccounting(payment)) return true;
  return payment.verificationStatus === "verified" && payment.accountingAllocationStatus === "applied";
};

const paymentAccountingAmount = (payment = {}) => {
  if (!paymentIsCountable(payment)) return "0";
  if (hasCanonicalPaymentAccounting(payment)) return moneyOrZero(payment.accountingAmount);
  return moneyOrZero(payment.amountPaid ?? payment.paidAmount ?? payment.amount ?? 0);
};

const paymentProviderFeeAmount = (payment = {}) => {
  if (!paymentIsCountable(payment)) return "0";
  return moneyOrZero(payment.providerFeeAmount ?? 0);
};

const paymentCurrency = (payment = {}) =>
  normalizeCurrency(payment.accountingCurrency || payment.currency || payment.orderCurrency || "");

const dedupePaidPayments = (payments = []) => {
  const byIdentity = new Map();
  asArray(payments).filter(paymentIsCountable).forEach((payment) => {
    const key = paymentIdentity(payment);
    if (!key) return;
    const amount = paymentAccountingAmount(payment);
    const existing = byIdentity.get(key);
    if (!existing || toDecimal(amount).greaterThan(toDecimal(paymentAccountingAmount(existing)))) {
      byIdentity.set(key, payment);
    }
  });
  return Array.from(byIdentity.values());
};

const sumMoney = (rows = [], mapper = (row) => row) =>
  rows.reduce((sum, row) => sum.plus(toDecimal(mapper(row) || 0)), new Decimal(0)).toFixed();

const firstCurrency = (...values) => {
  for (const value of values) {
    const currency = normalizeCurrency(value);
    if (currency) return currency;
  }
  return "";
};

const assertSingleCurrency = ({ currency, payments = [], invoice = null, booking = null } = {}) => {
  const currencies = new Set();
  if (currency) currencies.add(currency);
  if (invoice?.accountingCurrency) currencies.add(normalizeCurrency(invoice.accountingCurrency));
  if (booking?.currency) currencies.add(normalizeCurrency(booking.currency));
  asArray(payments).forEach((payment) => {
    const paymentCurrencyCode = paymentCurrency(payment);
    if (paymentCurrencyCode) currencies.add(paymentCurrencyCode);
  });
  currencies.delete("");
  if (currencies.size > 1) {
    throw new AppError(
      "Business accounting posting cannot combine multiple currencies without a locked historical FX rate.",
      409,
      "BUSINESS_ACCOUNTING_CURRENCY_CONFLICT",
      { currencies: Array.from(currencies) }
    );
  }
};

const bookingDate = (booking = {}, invoice = null, payments = [], nowDate = new Date()) => {
  const paidPayment = asArray(payments).find((payment) => payment.paidAt);
  const candidate =
    booking.bokunOperationalDates?.bookingConfirmedAtBokun?.normalizedAt ||
    booking.bokunOperationalDates?.travelDate?.normalizedAt ||
    paidPayment?.paidAt ||
    invoice?.issueDate ||
    booking.createdAt ||
    nowDate;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? nowDate : parsed;
};

const resolveBusinessUnitForBooking = (booking = {}) => {
  if (Object.values(BUSINESS_UNIT).includes(booking.businessUnit)) return booking.businessUnit;
  if (booking.bokunProductId || booking.productTitle) return BUSINESS_UNIT.TOURS;
  return BUSINESS_UNIT.UNALLOCATED;
};

const buildPostingKey = ({ accountingScope, sourceModule, sourceReference, postingType }) =>
  [accountingScope, sourceModule, sourceReference, postingType]
    .map((value) => normalizeToken(value).toUpperCase())
    .join(":");

const isCountedStatus = (status = "") => COUNTED_FINANCIAL_STATUSES.includes(String(status || "").toUpperCase());

const buildBusinessIncomeReference = (nowDate = new Date()) =>
  `BI-${nowDate.toISOString().slice(0, 10).replace(/-/g, "")}-${uuidv4().slice(0, 8).toUpperCase()}`;

const buildBusinessExpenseReference = (nowDate = new Date()) =>
  `BE-${nowDate.toISOString().slice(0, 10).replace(/-/g, "")}-${uuidv4().slice(0, 8).toUpperCase()}`;

const normalizeBusinessUnit = (value = "", fallback = BUSINESS_UNIT.GENERAL_COMPANY) =>
  Object.values(BUSINESS_UNIT).includes(String(value || "").toUpperCase())
    ? String(value || "").toUpperCase()
    : fallback;

const normalizeEntryStatus = (value = FINANCIAL_ENTRY_STATUS.DRAFT) =>
  Object.values(FINANCIAL_ENTRY_STATUS).includes(String(value || "").toUpperCase())
    ? String(value || "").toUpperCase()
    : FINANCIAL_ENTRY_STATUS.DRAFT;

const normalizeIncomeCategory = (value = "") => {
  const category = String(value || "").toUpperCase();
  if (!Object.values(INCOME_CATEGORY).includes(category)) {
    throw new AppError("Income category is required", 422, "BUSINESS_INCOME_CATEGORY_INVALID");
  }
  return category;
};

const normalizeExpenseCategory = (value = "") => {
  const category = String(value || "").toUpperCase();
  if (!Object.values(EXPENSE_CATEGORY).includes(category)) {
    throw new AppError("Expense category is required", 422, "BUSINESS_EXPENSE_CATEGORY_INVALID");
  }
  return category;
};

const normalizeExpensePaymentStatus = (value = EXPENSE_PAYMENT_STATUS.UNPAID) =>
  Object.values(EXPENSE_PAYMENT_STATUS).includes(String(value || "").toUpperCase())
    ? String(value || "").toUpperCase()
    : EXPENSE_PAYMENT_STATUS.UNPAID;

const assertBusinessIncomeNotBookingDuplicate = ({ incomeCategory = "", sourceModule = "" } = {}) => {
  const category = normalizeIncomeCategory(incomeCategory);
  const moduleName = normalizeToken(sourceModule || SOURCE_MODULE.BUSINESS_ACCOUNTING).toUpperCase();
  if (category === INCOME_CATEGORY.BOOKING_INCOME_LINK || moduleName === SOURCE_MODULE.BOOKING_ACCOUNTING) {
    throw new AppError(
      "Booking-related income must be linked through Booking Accounting contribution postings, not manually created as Business Income.",
      409,
      "BOOKING_INCOME_LINK_NOT_MANUAL"
    );
  }
};

const assertBusinessExpenseNotBookingDirectCost = ({
  accountingScope = ACCOUNTING_SCOPE.BUSINESS,
  sourceModule = "",
  bookingReference = "",
  bookingId = null
} = {}) => {
  const scope = normalizeToken(accountingScope || ACCOUNTING_SCOPE.BUSINESS).toUpperCase();
  const moduleName = normalizeToken(sourceModule || SOURCE_MODULE.BUSINESS_ACCOUNTING).toUpperCase();
  if (
    scope === ACCOUNTING_SCOPE.BOOKING ||
    moduleName === SOURCE_MODULE.BOOKING_ACCOUNTING ||
    normalizeToken(bookingReference) ||
    bookingId
  ) {
    throw new AppError(
      "Booking-specific direct costs must stay in Booking Accounting and cannot be entered as company operating expenses.",
      409,
      "BOOKING_DIRECT_COST_NOT_BUSINESS_EXPENSE"
    );
  }
  if (scope !== ACCOUNTING_SCOPE.BUSINESS) {
    throw new AppError("Business expense accounting scope is invalid", 422, "BUSINESS_EXPENSE_SCOPE_INVALID");
  }
};

const parseDateOrThrow = ({ value, fallback = null, code, message }) => {
  const candidate = value ?? fallback;
  if (!candidate) return null;
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(message, 422, code);
  }
  return parsed;
};

const buildBusinessIncomeValues = ({ input = {}, existing = null, auth = {}, nowDate = new Date() } = {}) => {
  const incomeCategory = normalizeIncomeCategory(input.incomeCategory ?? existing?.incomeCategory);
  const sourceModule = normalizeToken(input.sourceModule ?? existing?.sourceModule ?? SOURCE_MODULE.BUSINESS_ACCOUNTING).toUpperCase();
  assertBusinessIncomeNotBookingDuplicate({ incomeCategory, sourceModule });

  const amount = decimalString(input.amount ?? existing?.amount ?? 0, {
    allowNegative: false,
    field: "businessIncome.amount"
  });
  if (!toDecimal(amount).greaterThan(0)) {
    throw new AppError("Business income amount must be greater than zero", 422, "BUSINESS_INCOME_AMOUNT_INVALID");
  }

  const currency = requireCurrency(input.currency ?? existing?.currency ?? "USD");
  const baseCurrency = requireCurrency(input.baseCurrency ?? existing?.baseCurrency ?? currency);
  const exchangeRate = decimalString(input.exchangeRate ?? existing?.exchangeRate ?? 1, {
    allowNegative: false,
    field: "businessIncome.exchangeRate"
  });
  if (!toDecimal(exchangeRate).greaterThan(0)) {
    throw new AppError("Business income exchange rate must be greater than zero", 422, "BUSINESS_INCOME_EXCHANGE_RATE_INVALID");
  }
  const baseCurrencyAmount = multiply(amount, exchangeRate);
  const status = normalizeEntryStatus(input.status ?? existing?.status ?? FINANCIAL_ENTRY_STATUS.DRAFT);
  const sourceReference = normalizeToken(input.sourceReference ?? existing?.sourceReference ?? "");
  const reference = normalizeToken(input.reference ?? existing?.reference ?? "");
  const incomeReference = normalizeToken(existing?.incomeReference || input.incomeReference || buildBusinessIncomeReference(nowDate));
  const idempotencyKey = normalizeToken(
    existing?.idempotencyKey ||
      input.idempotencyKey ||
      (sourceReference
        ? `business-income:${sourceModule}:${sourceReference}:${incomeCategory}`
        : reference
          ? `business-income:reference:${reference}:${incomeCategory}`
          : `business-income:${incomeReference}`)
  );
  const transactionDate = new Date(input.transactionDate ?? existing?.transactionDate ?? nowDate);
  if (Number.isNaN(transactionDate.getTime())) {
    throw new AppError("Business income transaction date is invalid", 422, "BUSINESS_INCOME_DATE_INVALID");
  }
  const exchangeRateDate = input.exchangeRateDate ?? existing?.exchangeRateDate;

  return {
    incomeReference,
    idempotencyKey,
    accountingScope: ACCOUNTING_SCOPE.BUSINESS,
    businessUnit: normalizeBusinessUnit(input.businessUnit ?? existing?.businessUnit, BUSINESS_UNIT.GENERAL_COMPANY),
    incomeCategory,
    sourceModule,
    sourceReference,
    sourceRecordId: normalizeToken(input.sourceRecordId ?? existing?.sourceRecordId ?? ""),
    sourceRecordModel: normalizeToken(input.sourceRecordModel ?? existing?.sourceRecordModel ?? ""),
    description: normalizeToken(input.description ?? existing?.description ?? ""),
    amount,
    currency,
    exchangeRate,
    baseCurrency,
    baseCurrencyAmount,
    exchangeRateDate: exchangeRateDate ? new Date(exchangeRateDate) : null,
    transactionDate,
    paymentMethod: normalizeToken(input.paymentMethod ?? existing?.paymentMethod ?? ""),
    reference,
    customerOrCounterparty: {
      name: normalizeToken(input.customerOrCounterparty?.name ?? existing?.customerOrCounterparty?.name ?? ""),
      email: normalizeToken(input.customerOrCounterparty?.email ?? existing?.customerOrCounterparty?.email ?? "").toLowerCase(),
      phone: normalizeToken(input.customerOrCounterparty?.phone ?? existing?.customerOrCounterparty?.phone ?? ""),
      type: normalizeToken(input.customerOrCounterparty?.type ?? existing?.customerOrCounterparty?.type ?? "")
    },
    notes: normalizeToken(input.notes ?? existing?.notes ?? ""),
    createdBy: existing?.createdBy || auth?.id || normalizeToken(input.createdBy || ""),
    approvedBy: isCountedStatus(status)
      ? normalizeToken(input.approvedBy ?? existing?.approvedBy ?? auth?.id ?? "")
      : normalizeToken(input.approvedBy ?? existing?.approvedBy ?? ""),
    approvedAt: isCountedStatus(status)
      ? (existing?.approvedAt || (input.approvedAt ? new Date(input.approvedAt) : nowDate))
      : (input.approvedAt ? new Date(input.approvedAt) : existing?.approvedAt || null),
    status,
    metadata: input.metadata ?? existing?.metadata ?? {}
  };
};

const buildBusinessExpenseValues = ({ input = {}, existing = null, auth = {}, nowDate = new Date() } = {}) => {
  const category = normalizeExpenseCategory(input.category ?? existing?.category);
  const sourceModule = normalizeToken(input.sourceModule ?? existing?.sourceModule ?? SOURCE_MODULE.BUSINESS_ACCOUNTING).toUpperCase();
  const accountingScope = normalizeToken(input.accountingScope ?? existing?.accountingScope ?? ACCOUNTING_SCOPE.BUSINESS).toUpperCase();
  const bookingReference = normalizeToken(input.bookingReference ?? existing?.bookingReference ?? "");
  const bookingId = input.bookingId ?? existing?.bookingId ?? null;
  assertBusinessExpenseNotBookingDirectCost({ accountingScope, sourceModule, bookingReference, bookingId });

  const amount = decimalString(input.amount ?? existing?.amount ?? 0, {
    allowNegative: false,
    field: "businessExpense.amount"
  });
  if (!toDecimal(amount).greaterThan(0)) {
    throw new AppError("Business expense amount must be greater than zero", 422, "BUSINESS_EXPENSE_AMOUNT_INVALID");
  }

  const currency = requireCurrency(input.currency ?? existing?.currency ?? "USD");
  const baseCurrency = requireCurrency(input.baseCurrency ?? existing?.baseCurrency ?? currency);
  const exchangeRate = decimalString(input.exchangeRate ?? existing?.exchangeRate ?? 1, {
    allowNegative: false,
    field: "businessExpense.exchangeRate"
  });
  if (!toDecimal(exchangeRate).greaterThan(0)) {
    throw new AppError("Business expense exchange rate must be greater than zero", 422, "BUSINESS_EXPENSE_EXCHANGE_RATE_INVALID");
  }

  const baseCurrencyAmount = multiply(amount, exchangeRate);
  const status = normalizeEntryStatus(input.status ?? existing?.status ?? FINANCIAL_ENTRY_STATUS.DRAFT);
  const paymentStatus = normalizeExpensePaymentStatus(input.paymentStatus ?? existing?.paymentStatus ?? EXPENSE_PAYMENT_STATUS.UNPAID);
  const sourceReference = normalizeToken(input.sourceReference ?? existing?.sourceReference ?? "");
  const paymentReference = normalizeToken(input.paymentReference ?? existing?.paymentReference ?? "");
  const expenseReference = normalizeToken(existing?.expenseReference || input.expenseReference || buildBusinessExpenseReference(nowDate));
  const idempotencyKey = normalizeToken(
    existing?.idempotencyKey ||
      input.idempotencyKey ||
      (sourceReference
        ? `business-expense:${sourceModule}:${sourceReference}:${category}`
        : paymentReference
          ? `business-expense:payment:${paymentReference}:${category}`
          : `business-expense:${expenseReference}`)
  );
  const expenseDate = parseDateOrThrow({
    value: input.expenseDate,
    fallback: existing?.expenseDate || nowDate,
    code: "BUSINESS_EXPENSE_DATE_INVALID",
    message: "Business expense date is invalid"
  });
  const dueDate = parseDateOrThrow({
    value: input.dueDate,
    fallback: existing?.dueDate || null,
    code: "BUSINESS_EXPENSE_DUE_DATE_INVALID",
    message: "Business expense due date is invalid"
  });
  const exchangeRateDate = parseDateOrThrow({
    value: input.exchangeRateDate,
    fallback: existing?.exchangeRateDate || null,
    code: "BUSINESS_EXPENSE_EXCHANGE_RATE_DATE_INVALID",
    message: "Business expense exchange rate date is invalid"
  });

  return {
    expenseReference,
    idempotencyKey,
    accountingScope: ACCOUNTING_SCOPE.BUSINESS,
    businessUnit: normalizeBusinessUnit(input.businessUnit ?? existing?.businessUnit, BUSINESS_UNIT.GENERAL_COMPANY),
    category,
    sourceModule,
    sourceReference,
    sourceRecordId: normalizeToken(input.sourceRecordId ?? existing?.sourceRecordId ?? ""),
    sourceRecordModel: normalizeToken(input.sourceRecordModel ?? existing?.sourceRecordModel ?? ""),
    bookingReference: "",
    bookingId: null,
    description: normalizeToken(input.description ?? existing?.description ?? ""),
    supplier: {
      supplierId: normalizeToken(input.supplier?.supplierId ?? existing?.supplier?.supplierId ?? ""),
      name: normalizeToken(input.supplier?.name ?? existing?.supplier?.name ?? ""),
      type: normalizeToken(input.supplier?.type ?? existing?.supplier?.type ?? ""),
      contact: normalizeToken(input.supplier?.contact ?? existing?.supplier?.contact ?? "")
    },
    amount,
    currency,
    exchangeRate,
    baseCurrency,
    baseCurrencyAmount,
    exchangeRateDate,
    expenseDate,
    dueDate,
    paymentStatus,
    paymentMethod: normalizeToken(input.paymentMethod ?? existing?.paymentMethod ?? ""),
    paymentReference,
    receiptAttachment: {
      name: normalizeToken(input.receiptAttachment?.name ?? existing?.receiptAttachment?.name ?? ""),
      url: normalizeToken(input.receiptAttachment?.url ?? existing?.receiptAttachment?.url ?? ""),
      uploadedAt: parseDateOrThrow({
        value: input.receiptAttachment?.uploadedAt,
        fallback: existing?.receiptAttachment?.uploadedAt || null,
        code: "BUSINESS_EXPENSE_RECEIPT_DATE_INVALID",
        message: "Business expense receipt upload date is invalid"
      })
    },
    recurring: {
      active: Boolean(input.recurring?.active ?? existing?.recurring?.active ?? false),
      recurrenceRule: normalizeToken(input.recurring?.recurrenceRule ?? existing?.recurring?.recurrenceRule ?? ""),
      nextDueDate: parseDateOrThrow({
        value: input.recurring?.nextDueDate,
        fallback: existing?.recurring?.nextDueDate || null,
        code: "BUSINESS_EXPENSE_RECURRENCE_DATE_INVALID",
        message: "Business expense recurrence next due date is invalid"
      })
    },
    createdBy: existing?.createdBy || auth?.id || normalizeToken(input.createdBy || ""),
    approvedBy: isCountedStatus(status)
      ? normalizeToken(input.approvedBy ?? existing?.approvedBy ?? auth?.id ?? "")
      : normalizeToken(input.approvedBy ?? existing?.approvedBy ?? ""),
    approvedAt: isCountedStatus(status)
      ? (existing?.approvedAt || (input.approvedAt ? new Date(input.approvedAt) : nowDate))
      : (input.approvedAt ? new Date(input.approvedAt) : existing?.approvedAt || null),
    notes: normalizeToken(input.notes ?? existing?.notes ?? ""),
    status,
    metadata: input.metadata ?? existing?.metadata ?? {}
  };
};

const normalizeBusinessIncomeForApi = (income = {}) => {
  const row = income?.toObject ? income.toObject() : income || {};
  return {
    id: row._id || null,
    incomeReference: row.incomeReference,
    accountingScope: row.accountingScope,
    businessUnit: row.businessUnit,
    incomeCategory: row.incomeCategory,
    sourceModule: row.sourceModule,
    sourceReference: row.sourceReference,
    sourceRecordId: row.sourceRecordId,
    sourceRecordModel: row.sourceRecordModel,
    accountingPostingId: row.accountingPostingId || null,
    description: row.description,
    amount: decimalToApi(row.amount, row.amount || "0"),
    currency: row.currency,
    exchangeRate: decimalToApi(row.exchangeRate, row.exchangeRate || "1"),
    baseCurrency: row.baseCurrency,
    baseCurrencyAmount: decimalToApi(row.baseCurrencyAmount, row.baseCurrencyAmount || "0"),
    exchangeRateDate: row.exchangeRateDate || null,
    transactionDate: row.transactionDate,
    paymentMethod: row.paymentMethod || "",
    reference: row.reference || "",
    customerOrCounterparty: row.customerOrCounterparty || {},
    notes: row.notes || "",
    status: row.status,
    createdBy: row.createdBy || "",
    approvedBy: row.approvedBy || "",
    approvedAt: row.approvedAt || null,
    metadata: row.metadata || {}
  };
};

const normalizeBusinessExpenseForApi = (expense = {}) => {
  const row = expense?.toObject ? expense.toObject() : expense || {};
  return {
    id: row._id || null,
    expenseReference: row.expenseReference,
    accountingScope: row.accountingScope,
    businessUnit: row.businessUnit,
    category: row.category,
    sourceModule: row.sourceModule,
    sourceReference: row.sourceReference,
    sourceRecordId: row.sourceRecordId,
    sourceRecordModel: row.sourceRecordModel,
    accountingPostingId: row.accountingPostingId || null,
    bookingReference: row.bookingReference || "",
    bookingId: row.bookingId || null,
    description: row.description,
    supplier: row.supplier || {},
    amount: decimalToApi(row.amount, row.amount || "0"),
    currency: row.currency,
    exchangeRate: decimalToApi(row.exchangeRate, row.exchangeRate || "1"),
    baseCurrency: row.baseCurrency,
    baseCurrencyAmount: decimalToApi(row.baseCurrencyAmount, row.baseCurrencyAmount || "0"),
    exchangeRateDate: row.exchangeRateDate || null,
    expenseDate: row.expenseDate,
    dueDate: row.dueDate || null,
    paymentStatus: row.paymentStatus,
    paymentMethod: row.paymentMethod || "",
    paymentReference: row.paymentReference || "",
    receiptAttachment: row.receiptAttachment || {},
    recurring: row.recurring || {},
    notes: row.notes || "",
    status: row.status,
    createdBy: row.createdBy || "",
    approvedBy: row.approvedBy || "",
    approvedAt: row.approvedAt || null,
    metadata: row.metadata || {}
  };
};

const buildBusinessIncomePosting = ({ income, nowDate = new Date() } = {}) => {
  const row = income?.toObject ? income.toObject() : income || {};
  const sourceReference = normalizeToken(row.incomeReference);
  const accountingScope = ACCOUNTING_SCOPE.BUSINESS;
  const sourceModule = SOURCE_MODULE.BUSINESS_ACCOUNTING;
  const postingType = POSTING_TYPE.OTHER_BUSINESS_INCOME;
  const postingKey = buildPostingKey({ accountingScope, sourceModule, sourceReference, postingType });
  const amount = moneyOrZero(row.amount);
  const exchangeRate = moneyOrZero(row.exchangeRate || 1);
  const baseCurrencyAmount = moneyOrZero(row.baseCurrencyAmount || multiply(amount, exchangeRate));

  return {
    postingKey,
    idempotencyKey: postingKey,
    accountingScope,
    sourceModule,
    sourceReference,
    sourceRecordId: String(row._id || ""),
    sourceRecordModel: "BusinessIncome",
    postingType,
    direction: POSTING_DIRECTION.INCOME,
    businessUnit: normalizeBusinessUnit(row.businessUnit, BUSINESS_UNIT.GENERAL_COMPANY),
    bookingReference: "",
    bookingId: null,
    description: row.description || `Business income ${sourceReference}`,
    amount,
    currency: requireCurrency(row.currency),
    baseCurrency: requireCurrency(row.baseCurrency || row.currency),
    exchangeRate,
    baseCurrencyAmount,
    exchangeRateDate: row.exchangeRateDate || row.transactionDate || nowDate,
    transactionDate: row.transactionDate || nowDate,
    status: row.status,
    components: {
      bookedRevenue: "0",
      invoicedRevenue: "0",
      collectedRevenue: "0",
      refundedAmount: "0",
      providerFees: "0",
      channelCommission: "0",
      directBookingCosts: "0",
      bookingNetContribution: "0",
      otherBusinessIncome: baseCurrencyAmount,
      operatingExpenses: "0",
      payrollExpenses: "0",
      otherExpenses: "0"
    },
    sourceSnapshot: {
      incomeReference: sourceReference,
      incomeCategory: row.incomeCategory,
      externalSourceModule: row.sourceModule || "",
      externalSourceReference: row.sourceReference || "",
      reference: row.reference || "",
      counterparty: row.customerOrCounterparty || {}
    },
    metadata: {
      noDoubleCountingRule: "Non-booking company income is counted once through this BusinessIncome-linked posting.",
      generatedAt: nowDate.toISOString()
    }
  };
};

const buildBusinessExpensePosting = ({ expense, nowDate = new Date() } = {}) => {
  const row = expense?.toObject ? expense.toObject() : expense || {};
  const sourceReference = normalizeToken(row.expenseReference);
  const accountingScope = ACCOUNTING_SCOPE.BUSINESS;
  const sourceModule = SOURCE_MODULE.BUSINESS_ACCOUNTING;
  const postingType = POSTING_TYPE.OPERATING_EXPENSE;
  const postingKey = buildPostingKey({ accountingScope, sourceModule, sourceReference, postingType });
  const amount = moneyOrZero(row.amount);
  const exchangeRate = moneyOrZero(row.exchangeRate || 1);
  const baseCurrencyAmount = moneyOrZero(row.baseCurrencyAmount || multiply(amount, exchangeRate));

  return {
    postingKey,
    idempotencyKey: postingKey,
    accountingScope,
    sourceModule,
    sourceReference,
    sourceRecordId: String(row._id || ""),
    sourceRecordModel: "BusinessExpense",
    postingType,
    direction: POSTING_DIRECTION.EXPENSE,
    businessUnit: normalizeBusinessUnit(row.businessUnit, BUSINESS_UNIT.GENERAL_COMPANY),
    bookingReference: "",
    bookingId: null,
    description: row.description || `Business expense ${sourceReference}`,
    amount,
    currency: requireCurrency(row.currency),
    baseCurrency: requireCurrency(row.baseCurrency || row.currency),
    exchangeRate,
    baseCurrencyAmount,
    exchangeRateDate: row.exchangeRateDate || row.expenseDate || nowDate,
    transactionDate: row.expenseDate || nowDate,
    status: row.status,
    components: {
      bookedRevenue: "0",
      invoicedRevenue: "0",
      collectedRevenue: "0",
      refundedAmount: "0",
      providerFees: "0",
      channelCommission: "0",
      directBookingCosts: "0",
      bookingNetContribution: "0",
      otherBusinessIncome: "0",
      operatingExpenses: baseCurrencyAmount,
      payrollExpenses: "0",
      otherExpenses: "0"
    },
    sourceSnapshot: {
      expenseReference: sourceReference,
      category: row.category,
      externalSourceModule: row.sourceModule || "",
      externalSourceReference: row.sourceReference || "",
      paymentReference: row.paymentReference || "",
      paymentStatus: row.paymentStatus || "",
      supplier: row.supplier || {}
    },
    metadata: {
      noDoubleCountingRule: "Company overhead is counted once through this BusinessExpense-linked operating expense posting.",
      directBookingCostIncluded: false,
      generatedAt: nowDate.toISOString()
    }
  };
};

const extractRefundAmount = (refund = {}) =>
  moneyOrZero(refund.confirmedAccountingRefundedAmount ?? refund.confirmedRefundedAmount ?? refund.amount ?? 0);

const buildBookingContributionPosting = ({
  booking,
  invoice = null,
  payments = [],
  refunds = [],
  commissions = [],
  nowDate = new Date()
} = {}) => {
  if (!booking?.bookingReference) {
    throw new AppError("Booking reference is required for business accounting posting", 422, "BOOKING_REFERENCE_REQUIRED");
  }

  const paidPayments = dedupePaidPayments(payments);
  const currency = firstCurrency(
    paidPayments[0] ? paymentCurrency(paidPayments[0]) : "",
    invoice?.accountingCurrency,
    booking.currency,
    booking.pricingSnapshot?.currency,
    "USD"
  );
  assertSingleCurrency({ currency, payments: paidPayments, invoice, booking });
  const accountingCurrency = requireCurrency(currency);
  const bookedRevenue = moneyOrZero(booking.pricingSnapshot?.finalPayable ?? booking.amount ?? invoice?.total ?? 0);
  const invoicedRevenue = moneyOrZero(invoice?.totalAmount ?? invoice?.total ?? bookedRevenue);
  const collectedRevenue = sumMoney(paidPayments, paymentAccountingAmount);
  const confirmedRefunds = asArray(refunds).filter((refund) => FINAL_REFUND_STATUSES.has(String(refund.status || "").toLowerCase()));
  const refundedAmount = sumMoney(confirmedRefunds, extractRefundAmount);
  const providerFees = sumMoney(paidPayments, paymentProviderFeeAmount);
  const channelCommission = sumMoney(
    asArray(commissions).filter((commission) => commission.payoutStatus !== "rejected"),
    (commission) => moneyOrZero(commission.commissionAmount || 0)
  );
  const directBookingCosts = "0";
  const netAfterRefunds = subtract(collectedRevenue, refundedAmount);
  const netAfterProviderFees = subtract(netAfterRefunds, providerFees);
  const bookingNetContribution = subtract(subtract(netAfterProviderFees, channelCommission), directBookingCosts);
  const amount = bookingNetContribution;
  const exchangeRate = "1";
  const baseCurrencyAmount = multiply(amount, exchangeRate);
  const accountingScope = ACCOUNTING_SCOPE.BUSINESS;
  const sourceModule = SOURCE_MODULE.BOOKING_ACCOUNTING;
  const sourceReference = normalizeToken(booking.bookingReference);
  const postingType = POSTING_TYPE.BOOKING_NET_CONTRIBUTION;
  const postingKey = buildPostingKey({ accountingScope, sourceModule, sourceReference, postingType });

  return {
    postingKey,
    idempotencyKey: postingKey,
    accountingScope,
    sourceModule,
    sourceReference,
    sourceRecordId: String(booking._id || ""),
    sourceRecordModel: "Booking",
    postingType,
    direction: POSTING_DIRECTION.INCOME,
    businessUnit: resolveBusinessUnitForBooking(booking),
    bookingReference: sourceReference,
    bookingId: booking._id || null,
    description: `Booking Accounting net contribution for ${sourceReference}`,
    amount,
    currency: accountingCurrency,
    baseCurrency: accountingCurrency,
    exchangeRate,
    baseCurrencyAmount,
    exchangeRateDate: bookingDate(booking, invoice, paidPayments, nowDate),
    transactionDate: bookingDate(booking, invoice, paidPayments, nowDate),
    status: FINANCIAL_ENTRY_STATUS.APPROVED,
    components: {
      bookedRevenue,
      invoicedRevenue,
      collectedRevenue,
      refundedAmount,
      providerFees,
      channelCommission,
      directBookingCosts,
      bookingNetContribution,
      otherBusinessIncome: "0",
      operatingExpenses: "0",
      payrollExpenses: "0",
      otherExpenses: "0"
    },
    sourceSnapshot: {
      bookingReference: sourceReference,
      bookingStatus: booking.bookingStatus || "",
      paymentStatus: booking.paymentStatus || "",
      operationalSource: booking.operationalSource || "",
      salesChannel: booking.salesChannel || "",
      invoiceNumber: invoice?.invoiceNumber || "",
      paymentIds: paidPayments.map((payment) => String(payment._id || "")),
      refundIds: confirmedRefunds.map((refund) => String(refund._id || "")),
      commissionIds: asArray(commissions).map((commission) => String(commission._id || "")),
      sourceAccountingScope: ACCOUNTING_SCOPE.BOOKING
    },
    metadata: {
      noDoubleCountingRule: "Business Accounting consumes Booking Accounting contribution through this source-linked posting.",
      directBookingCostsIncluded: false,
      generatedAt: nowDate.toISOString()
    }
  };
};

const normalizePostingForApi = (posting = {}) => {
  const row = posting?.toObject ? posting.toObject() : posting || {};
  return {
    id: row._id || null,
    postingKey: row.postingKey,
    accountingScope: row.accountingScope,
    sourceModule: row.sourceModule,
    sourceReference: row.sourceReference,
    postingType: row.postingType,
    direction: row.direction,
    businessUnit: row.businessUnit,
    bookingReference: row.bookingReference,
    description: row.description,
    amount: decimalToApi(row.amount, row.amount || "0"),
    currency: row.currency,
    baseCurrency: row.baseCurrency,
    exchangeRate: decimalToApi(row.exchangeRate, row.exchangeRate || "1"),
    baseCurrencyAmount: decimalToApi(row.baseCurrencyAmount, row.baseCurrencyAmount || "0"),
    transactionDate: row.transactionDate,
    status: row.status,
    components: Object.entries(row.components || {}).reduce((components, [key, value]) => {
      components[key] = decimalToApi(value, value || "0");
      return components;
    }, {}),
    sourceSnapshot: row.sourceSnapshot || {},
    metadata: row.metadata || {}
  };
};

const comparablePosting = (posting = {}) => {
  const normalized = normalizePostingForApi(posting);
  return {
    amount: normalized.amount,
    currency: normalized.currency,
    baseCurrency: normalized.baseCurrency,
    baseCurrencyAmount: normalized.baseCurrencyAmount,
    status: normalized.status,
    components: normalized.components,
    transactionDate: normalized.transactionDate ? new Date(normalized.transactionDate).toISOString() : ""
  };
};

const samePosting = (left = {}, right = {}) =>
  JSON.stringify(comparablePosting(left)) === JSON.stringify(comparablePosting(right));

const buildDateRangeQuery = ({ fromDate = "", toDate = "", field = "transactionDate" } = {}) => {
  const range = {};
  if (fromDate) {
    const from = new Date(fromDate);
    if (!Number.isNaN(from.getTime())) range.$gte = from;
  }
  if (toDate) {
    const to = new Date(toDate);
    if (!Number.isNaN(to.getTime())) range.$lte = to;
  }
  return Object.keys(range).length ? { [field]: range } : {};
};

const createBusinessAccountingService = ({
  AccountingPostingModel = AccountingPosting,
  AuditLogModel = AuditLog,
  BookingModel = Booking,
  BusinessExpenseModel = BusinessExpense,
  BusinessIncomeModel = BusinessIncome,
  CommissionRecordModel = CommissionRecord,
  InvoiceModel = Invoice,
  PaymentModel = Payment,
  RefundModel = Refund,
  now = () => new Date()
} = {}) => {
  const recordAudit = async ({ action, posting, auth = {}, requestId = "", reason = "", before = null, after = null, metadata = {} }) => {
    if (!AuditLogModel?.create) return null;
    return AuditLogModel.create({
      actorId: auth?.id || null,
      actorRole: auth?.role || "system",
      action,
      entityType: "AccountingPosting",
      entityId: String(posting?._id || posting?.postingKey || ""),
      reason,
      requestId,
      before,
      after,
      metadata
    });
  };

  const recordIncomeAudit = async ({ action, income, auth = {}, requestId = "", reason = "", before = null, after = null, metadata = {} }) => {
    if (!AuditLogModel?.create) return null;
    return AuditLogModel.create({
      actorId: auth?.id || null,
      actorRole: auth?.role || "system",
      action,
      entityType: "BusinessIncome",
      entityId: String(income?._id || income?.incomeReference || ""),
      reason,
      requestId,
      before,
      after,
      metadata
    });
  };

  const recordExpenseAudit = async ({ action, expense, auth = {}, requestId = "", reason = "", before = null, after = null, metadata = {} }) => {
    if (!AuditLogModel?.create) return null;
    return AuditLogModel.create({
      actorId: auth?.id || null,
      actorRole: auth?.role || "system",
      action,
      entityType: "BusinessExpense",
      entityId: String(expense?._id || expense?.expenseReference || ""),
      reason,
      requestId,
      before,
      after,
      metadata
    });
  };

  const serializeBusinessIncomeValues = (values = {}) => ({
    ...values,
    amount: decimalOrNull(values.amount),
    exchangeRate: decimalOrNull(values.exchangeRate),
    baseCurrencyAmount: decimalOrNull(values.baseCurrencyAmount)
  });

  const serializeBusinessExpenseValues = (values = {}) => ({
    ...values,
    amount: decimalOrNull(values.amount),
    exchangeRate: decimalOrNull(values.exchangeRate),
    baseCurrencyAmount: decimalOrNull(values.baseCurrencyAmount)
  });

  const serializePostingValues = (payload = {}) => ({
    ...payload,
    amount: decimalOrNull(payload.amount),
    exchangeRate: decimalOrNull(payload.exchangeRate),
    baseCurrencyAmount: decimalOrNull(payload.baseCurrencyAmount),
    components: Object.entries(payload.components || {}).reduce((components, [key, value]) => {
      components[key] = decimalOrNull(value);
      return components;
    }, {})
  });

  const syncBusinessIncomePosting = async ({ income, auth = {}, requestId = "", reason = "Business income posting synchronized" } = {}) => {
    const row = income?.toObject ? income.toObject() : income || {};
    if (!row.incomeReference) return null;

    const payload = buildBusinessIncomePosting({ income: row, nowDate: now() });
    const existing = await leanMaybe(AccountingPostingModel.findOne({ postingKey: payload.postingKey }));

    if (!isCountedStatus(row.status) && !existing) {
      return null;
    }

    if (!existing) {
      const created = await AccountingPostingModel.create({
        ...serializePostingValues(payload),
        createdBy: auth?.id || row.createdBy || "",
        approvedBy: row.approvedBy || auth?.id || "",
        approvedAt: row.approvedAt || now()
      });
      await BusinessIncomeModel.findOneAndUpdate(
        { incomeReference: row.incomeReference },
        { $set: { accountingPostingId: created._id || null } },
        { new: true }
      );
      await recordAudit({
        action: "business_income_posting_created",
        posting: created,
        auth,
        requestId,
        reason,
        after: normalizePostingForApi(created),
        metadata: { incomeReference: row.incomeReference, incomeCategory: row.incomeCategory }
      });
      return created;
    }

    const before = normalizePostingForApi(existing);
    const updated = await AccountingPostingModel.findOneAndUpdate(
      { postingKey: payload.postingKey },
      {
        $set: {
          ...serializePostingValues(payload),
          metadata: {
            ...(payload.metadata || {}),
            refreshedAt: now().toISOString()
          }
        }
      },
      { new: true }
    );
    await recordAudit({
      action: isCountedStatus(row.status) ? "business_income_posting_refreshed" : "business_income_posting_deactivated",
      posting: updated,
      auth,
      requestId,
      reason,
      before,
      after: normalizePostingForApi(updated),
      metadata: { incomeReference: row.incomeReference, incomeCategory: row.incomeCategory }
    });
    return updated;
  };

  const createBusinessIncome = async ({ input = {}, auth = {}, requestId = "" } = {}) => {
    const nowDate = now();
    const values = buildBusinessIncomeValues({ input, auth, nowDate });
    if (!values.description) {
      throw new AppError("Business income description is required", 422, "BUSINESS_INCOME_DESCRIPTION_REQUIRED");
    }

    const existing = await leanMaybe(BusinessIncomeModel.findOne({ idempotencyKey: values.idempotencyKey }));
    if (existing) {
      return {
        action: "unchanged",
        income: normalizeBusinessIncomeForApi(existing)
      };
    }

    const created = await BusinessIncomeModel.create(serializeBusinessIncomeValues(values));
    const posting = await syncBusinessIncomePosting({
      income: created,
      auth,
      requestId,
      reason: "Business income created"
    });
    const refreshed = posting
      ? await leanMaybe(BusinessIncomeModel.findOne({ incomeReference: values.incomeReference }))
      : created;

    await recordIncomeAudit({
      action: "business_income_created",
      income: refreshed,
      auth,
      requestId,
      reason: "Business income created",
      after: normalizeBusinessIncomeForApi(refreshed),
      metadata: { postingCreated: Boolean(posting) }
    });

    return {
      action: "created",
      income: normalizeBusinessIncomeForApi(refreshed),
      posting: posting ? normalizePostingForApi(posting) : null
    };
  };

  const listBusinessIncome = async ({ status = "", incomeCategory = "", businessUnit = "", fromDate = "", toDate = "", limit = 100 } = {}) => {
    const query = { accountingScope: ACCOUNTING_SCOPE.BUSINESS };
    const normalizedStatus = status ? normalizeEntryStatus(status) : "";
    if (normalizedStatus) query.status = normalizedStatus;
    if (incomeCategory) query.incomeCategory = normalizeIncomeCategory(incomeCategory);
    if (businessUnit) query.businessUnit = normalizeBusinessUnit(businessUnit, BUSINESS_UNIT.UNALLOCATED);
    Object.assign(query, buildDateRangeQuery({ fromDate, toDate }));
    const safeLimit = Math.max(1, Math.min(500, Number(limit || 100)));
    const result = BusinessIncomeModel.find(query);
    const rows = result && typeof result.sort === "function" && typeof result.limit === "function"
      ? await leanMaybe(result.sort({ transactionDate: -1, createdAt: -1 }).limit(safeLimit))
      : asArray(await leanMaybe(result))
          .sort((left, right) => new Date(right.transactionDate || right.createdAt || 0) - new Date(left.transactionDate || left.createdAt || 0))
          .slice(0, safeLimit);
    const items = asArray(rows).map(normalizeBusinessIncomeForApi);
    return {
      items,
      count: items.length
    };
  };

  const updateBusinessIncome = async ({ incomeId, input = {}, auth = {}, requestId = "" } = {}) => {
    const existing = await leanMaybe(BusinessIncomeModel.findById(incomeId));
    if (!existing) {
      throw new AppError("Business income not found", 404, "BUSINESS_INCOME_NOT_FOUND");
    }
    const before = normalizeBusinessIncomeForApi(existing);
    const values = buildBusinessIncomeValues({ input, existing, auth, nowDate: now() });
    if (!values.description) {
      throw new AppError("Business income description is required", 422, "BUSINESS_INCOME_DESCRIPTION_REQUIRED");
    }

    const updated = await BusinessIncomeModel.findByIdAndUpdate(
      incomeId,
      { $set: serializeBusinessIncomeValues(values) },
      { new: true }
    );
    const posting = await syncBusinessIncomePosting({
      income: updated,
      auth,
      requestId,
      reason: "Business income updated"
    });
    const refreshed = await leanMaybe(BusinessIncomeModel.findById(incomeId));

    await recordIncomeAudit({
      action: "business_income_updated",
      income: refreshed,
      auth,
      requestId,
      reason: "Business income updated",
      before,
      after: normalizeBusinessIncomeForApi(refreshed),
      metadata: { postingSynchronized: Boolean(posting) }
    });

    return {
      action: "updated",
      income: normalizeBusinessIncomeForApi(refreshed),
      posting: posting ? normalizePostingForApi(posting) : null
    };
  };

  const syncBusinessExpensePosting = async ({ expense, auth = {}, requestId = "", reason = "Business expense posting synchronized" } = {}) => {
    const row = expense?.toObject ? expense.toObject() : expense || {};
    if (!row.expenseReference) return null;

    const payload = buildBusinessExpensePosting({ expense: row, nowDate: now() });
    const existing = await leanMaybe(AccountingPostingModel.findOne({ postingKey: payload.postingKey }));

    if (!isCountedStatus(row.status) && !existing) {
      return null;
    }

    if (!existing) {
      const created = await AccountingPostingModel.create({
        ...serializePostingValues(payload),
        createdBy: auth?.id || row.createdBy || "",
        approvedBy: row.approvedBy || auth?.id || "",
        approvedAt: row.approvedAt || now()
      });
      await BusinessExpenseModel.findOneAndUpdate(
        { expenseReference: row.expenseReference },
        { $set: { accountingPostingId: created._id || null } },
        { new: true }
      );
      await recordAudit({
        action: "business_expense_posting_created",
        posting: created,
        auth,
        requestId,
        reason,
        after: normalizePostingForApi(created),
        metadata: { expenseReference: row.expenseReference, category: row.category }
      });
      return created;
    }

    const before = normalizePostingForApi(existing);
    const updated = await AccountingPostingModel.findOneAndUpdate(
      { postingKey: payload.postingKey },
      {
        $set: {
          ...serializePostingValues(payload),
          metadata: {
            ...(payload.metadata || {}),
            refreshedAt: now().toISOString()
          }
        }
      },
      { new: true }
    );
    await recordAudit({
      action: isCountedStatus(row.status) ? "business_expense_posting_refreshed" : "business_expense_posting_deactivated",
      posting: updated,
      auth,
      requestId,
      reason,
      before,
      after: normalizePostingForApi(updated),
      metadata: { expenseReference: row.expenseReference, category: row.category }
    });
    return updated;
  };

  const createBusinessExpense = async ({ input = {}, auth = {}, requestId = "" } = {}) => {
    const nowDate = now();
    const values = buildBusinessExpenseValues({ input, auth, nowDate });
    if (!values.description) {
      throw new AppError("Business expense description is required", 422, "BUSINESS_EXPENSE_DESCRIPTION_REQUIRED");
    }

    const existing = await leanMaybe(BusinessExpenseModel.findOne({ idempotencyKey: values.idempotencyKey }));
    if (existing) {
      return {
        action: "unchanged",
        expense: normalizeBusinessExpenseForApi(existing)
      };
    }

    const created = await BusinessExpenseModel.create(serializeBusinessExpenseValues(values));
    const posting = await syncBusinessExpensePosting({
      expense: created,
      auth,
      requestId,
      reason: "Business expense created"
    });
    const refreshed = posting
      ? await leanMaybe(BusinessExpenseModel.findOne({ expenseReference: values.expenseReference }))
      : created;

    await recordExpenseAudit({
      action: "business_expense_created",
      expense: refreshed,
      auth,
      requestId,
      reason: "Business expense created",
      after: normalizeBusinessExpenseForApi(refreshed),
      metadata: { postingCreated: Boolean(posting) }
    });

    return {
      action: "created",
      expense: normalizeBusinessExpenseForApi(refreshed),
      posting: posting ? normalizePostingForApi(posting) : null
    };
  };

  const listBusinessExpenses = async ({ status = "", category = "", businessUnit = "", paymentStatus = "", fromDate = "", toDate = "", limit = 100 } = {}) => {
    const query = { accountingScope: ACCOUNTING_SCOPE.BUSINESS };
    const normalizedStatus = status ? normalizeEntryStatus(status) : "";
    if (normalizedStatus) query.status = normalizedStatus;
    if (category) query.category = normalizeExpenseCategory(category);
    if (businessUnit) query.businessUnit = normalizeBusinessUnit(businessUnit, BUSINESS_UNIT.UNALLOCATED);
    if (paymentStatus) query.paymentStatus = normalizeExpensePaymentStatus(paymentStatus);
    Object.assign(query, buildDateRangeQuery({ fromDate, toDate, field: "expenseDate" }));
    const safeLimit = Math.max(1, Math.min(500, Number(limit || 100)));
    const result = BusinessExpenseModel.find(query);
    const rows = result && typeof result.sort === "function" && typeof result.limit === "function"
      ? await leanMaybe(result.sort({ expenseDate: -1, createdAt: -1 }).limit(safeLimit))
      : asArray(await leanMaybe(result))
          .sort((left, right) => new Date(right.expenseDate || right.createdAt || 0) - new Date(left.expenseDate || left.createdAt || 0))
          .slice(0, safeLimit);
    const items = asArray(rows).map(normalizeBusinessExpenseForApi);
    return {
      items,
      count: items.length
    };
  };

  const updateBusinessExpense = async ({ expenseId, input = {}, auth = {}, requestId = "" } = {}) => {
    const existing = await leanMaybe(BusinessExpenseModel.findById(expenseId));
    if (!existing) {
      throw new AppError("Business expense not found", 404, "BUSINESS_EXPENSE_NOT_FOUND");
    }
    const before = normalizeBusinessExpenseForApi(existing);
    const values = buildBusinessExpenseValues({ input, existing, auth, nowDate: now() });
    if (!values.description) {
      throw new AppError("Business expense description is required", 422, "BUSINESS_EXPENSE_DESCRIPTION_REQUIRED");
    }

    const updated = await BusinessExpenseModel.findByIdAndUpdate(
      expenseId,
      { $set: serializeBusinessExpenseValues(values) },
      { new: true }
    );
    const posting = await syncBusinessExpensePosting({
      expense: updated,
      auth,
      requestId,
      reason: "Business expense updated"
    });
    const refreshed = await leanMaybe(BusinessExpenseModel.findById(expenseId));

    await recordExpenseAudit({
      action: "business_expense_updated",
      expense: refreshed,
      auth,
      requestId,
      reason: "Business expense updated",
      before,
      after: normalizeBusinessExpenseForApi(refreshed),
      metadata: { postingSynchronized: Boolean(posting) }
    });

    return {
      action: "updated",
      expense: normalizeBusinessExpenseForApi(refreshed),
      posting: posting ? normalizePostingForApi(posting) : null
    };
  };

  const loadBookingAccountingContext = async (bookingReference = "") => {
    const reference = normalizeToken(bookingReference);
    if (!reference) {
      throw new AppError("Booking reference is required", 422, "BOOKING_REFERENCE_REQUIRED");
    }

    const booking = await leanMaybe(BookingModel.findOne({ bookingReference: reference }));
    if (!booking) {
      throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
    }

    const [invoice, payments, refunds, commissions] = await Promise.all([
      leanMaybe(InvoiceModel.findOne({ bookingReference: reference })),
      leanMaybe(PaymentModel.find({ bookingReference: reference })),
      leanMaybe(RefundModel.find({ bookingId: booking._id })),
      leanMaybe(CommissionRecordModel.find({ bookingReference: reference }))
    ]);

    return {
      booking,
      invoice,
      payments: asArray(payments),
      refunds: asArray(refunds),
      commissions: asArray(commissions)
    };
  };

  const postBookingContribution = async ({
    bookingReference,
    dryRun = false,
    auth = {},
    requestId = "",
    reason = "Booking Accounting contribution linked into Business Accounting"
  } = {}) => {
    const context = await loadBookingAccountingContext(bookingReference);
    const nowDate = now();
    const payload = buildBookingContributionPosting({ ...context, nowDate });
    const existing = await leanMaybe(AccountingPostingModel.findOne({ postingKey: payload.postingKey }));
    const changed = existing ? !samePosting(existing, payload) : true;

    if (dryRun) {
      return {
        action: existing ? (changed ? "would_update" : "unchanged") : "would_create",
        dryRun: true,
        posting: normalizePostingForApi(payload),
        existing: existing ? normalizePostingForApi(existing) : null
      };
    }

    if (!existing) {
      const created = await AccountingPostingModel.create({
        ...payload,
        amount: decimalOrNull(payload.amount),
        exchangeRate: decimalOrNull(payload.exchangeRate),
        baseCurrencyAmount: decimalOrNull(payload.baseCurrencyAmount),
        components: Object.entries(payload.components).reduce((components, [key, value]) => {
          components[key] = decimalOrNull(value);
          return components;
        }, {}),
        createdBy: auth?.id || "",
        approvedBy: auth?.id || "",
        approvedAt: nowDate
      });
      await recordAudit({
        action: "business_accounting_booking_contribution_posted",
        posting: created,
        auth,
        requestId,
        reason,
        after: normalizePostingForApi(created),
        metadata: { sourceModule: payload.sourceModule, sourceReference: payload.sourceReference }
      });
      return { action: "created", posting: normalizePostingForApi(created) };
    }

    if (!changed) {
      return { action: "unchanged", posting: normalizePostingForApi(existing) };
    }

    const before = normalizePostingForApi(existing);
    const updated = await AccountingPostingModel.findOneAndUpdate(
      { postingKey: payload.postingKey },
      {
        $set: {
          ...payload,
          amount: decimalOrNull(payload.amount),
          exchangeRate: decimalOrNull(payload.exchangeRate),
          baseCurrencyAmount: decimalOrNull(payload.baseCurrencyAmount),
          components: Object.entries(payload.components).reduce((components, [key, value]) => {
            components[key] = decimalOrNull(value);
            return components;
          }, {}),
          metadata: {
            ...(payload.metadata || {}),
            refreshedAt: nowDate.toISOString()
          },
          approvedBy: existing.approvedBy || auth?.id || "",
          approvedAt: existing.approvedAt || nowDate
        }
      },
      { new: true }
    );
    await recordAudit({
      action: "business_accounting_booking_contribution_refreshed",
      posting: updated,
      auth,
      requestId,
      reason,
      before,
      after: normalizePostingForApi(updated),
      metadata: { sourceModule: payload.sourceModule, sourceReference: payload.sourceReference }
    });
    return { action: "updated", posting: normalizePostingForApi(updated) };
  };

  const getFoundationSummary = async ({ fromDate = "", toDate = "" } = {}) => {
    const query = {
      accountingScope: ACCOUNTING_SCOPE.BUSINESS,
      status: { $in: COUNTED_FINANCIAL_STATUSES },
      ...buildDateRangeQuery({ fromDate, toDate })
    };
    const postings = asArray(await leanMaybe(AccountingPostingModel.find(query)));
    const bookingContributionRows = postings.filter((posting) => posting.postingType === POSTING_TYPE.BOOKING_NET_CONTRIBUTION);
    const otherIncomeRows = postings.filter((posting) => posting.postingType === POSTING_TYPE.OTHER_BUSINESS_INCOME);
    const expenseRows = postings.filter((posting) =>
      [POSTING_TYPE.OPERATING_EXPENSE, POSTING_TYPE.PAYROLL_EXPENSE, POSTING_TYPE.OTHER_COMPANY_EXPENSE].includes(posting.postingType)
    );
    const bookingContribution = sumMoney(bookingContributionRows, (posting) => moneyOrZero(posting.baseCurrencyAmount ?? posting.amount));
    const otherBusinessIncome = sumMoney(otherIncomeRows, (posting) => moneyOrZero(posting.baseCurrencyAmount ?? posting.amount));
    const companyExpenses = sumMoney(expenseRows, (posting) => moneyOrZero(posting.baseCurrencyAmount ?? posting.amount));
    const companyContributionRevenue = add(bookingContribution, otherBusinessIncome);
    const companyNetProfit = subtract(companyContributionRevenue, companyExpenses);

    return {
      reportLabel: "Management Business Accounting Foundation",
      accountingScopes: Object.values(ACCOUNTING_SCOPE),
      businessUnits: Object.values(BUSINESS_UNIT),
      sourceLinkStrategy: {
        bookingAccountingFeedsBusinessAccounting: true,
        bookingRevenueIsNotDuplicated: true,
        countedStatuses: COUNTED_FINANCIAL_STATUSES
      },
      totals: {
        bookingNetContribution: toApiMoney(bookingContribution),
        otherBusinessIncome: toApiMoney(otherBusinessIncome),
        companyContributionRevenue: toApiMoney(companyContributionRevenue),
        companyExpenses: toApiMoney(companyExpenses),
        companyNetProfit: toApiMoney(companyNetProfit)
      },
      postingCount: postings.length,
      bookingContributionPostingCount: bookingContributionRows.length
    };
  };

  return {
    createBusinessExpense,
    createBusinessIncome,
    getFoundationSummary,
    listBusinessExpenses,
    listBusinessIncome,
    updateBusinessExpense,
    updateBusinessIncome,
    postBookingContribution
  };
};

const service = createBusinessAccountingService();

module.exports = {
  ...service,
  createBusinessAccountingService,
  __testables: {
    buildBookingContributionPosting,
    buildBusinessExpensePosting,
    buildBusinessExpenseValues,
    buildBusinessIncomePosting,
    buildBusinessIncomeValues,
    buildPostingKey,
    comparablePosting,
    dedupePaidPayments,
    normalizeBusinessExpenseForApi,
    normalizeBusinessIncomeForApi,
    normalizePostingForApi,
    paymentAccountingAmount,
    paymentIsCountable,
    samePosting,
    sumMoney
  }
};
