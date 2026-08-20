const {
  EXPENSE_CATEGORY,
  EXPENSE_PAYMENT_STATUS,
  FINANCIAL_ENTRY_STATUS
} = require("../accounting/constants");
const { PAYMENT_STATUS } = require("../config/constants");
const { decimalToApi, subtract, toDecimal } = require("../utils/money");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const asArray = (value) => (Array.isArray(value) ? value : []);

const normalizeToken = (value = "") => String(value || "").trim();

const toNumber = (value = 0) => {
  if (value === null || value === undefined || value === "") return 0;
  const normalized = decimalToApi(value, null);
  try {
    return Number(toDecimal(normalized ?? value).toFixed(2));
  } catch (error) {
    return 0;
  }
};

const sum = (rows = [], mapper = (row) => row) =>
  Number(rows.reduce((total, row) => total + toNumber(mapper(row)), 0).toFixed(2));

const leanMaybe = async (value) => {
  const awaited = await value;
  if (awaited && typeof awaited.lean === "function") return awaited.lean();
  return awaited;
};

const findRows = async ({ model, query = {}, sort = {}, limit = 500 } = {}) => {
  if (!model?.find) return [];
  const result = model.find(query);
  if (Array.isArray(result)) return result.slice(0, limit);
  if (result && typeof result.sort === "function" && typeof result.limit === "function") {
    const sorted = result.sort(sort);
    const limited = sorted.limit(limit);
    return asArray(await leanMaybe(limited));
  }
  return asArray(await leanMaybe(result)).slice(0, limit);
};

const isCountedEntry = (status = "") =>
  [FINANCIAL_ENTRY_STATUS.APPROVED, FINANCIAL_ENTRY_STATUS.PAID].includes(String(status || "").toUpperCase());

const buildDateQuery = ({ range, field }) => {
  const bounds = {};
  if (range?.from) bounds.$gte = range.from;
  if (range?.to) bounds.$lt = range.to;
  return Object.keys(bounds).length ? { [field]: bounds } : {};
};

const groupBy = (rows = [], keyFn, amountFn) =>
  rows.reduce((result, row) => {
    const key = normalizeToken(keyFn(row) || "UNALLOCATED");
    if (!result[key]) result[key] = { key, count: 0, amount: 0 };
    result[key].count += 1;
    result[key].amount = Number((result[key].amount + toNumber(amountFn(row))).toFixed(2));
    return result;
  }, {});

const sortedGroups = (groups = {}) =>
  Object.values(groups).sort((left, right) => right.amount - left.amount || left.key.localeCompare(right.key));

const amountFromInvoice = (invoice = {}) =>
  toNumber(
    invoice.balanceDueAmount ??
      invoice.balanceDue ??
      subtract(
        String(invoice.totalAmount ?? invoice.total ?? 0),
        String(invoice.paidAccountingAmount ?? invoice.amountPaid ?? 0)
      )
  );

const invoiceTotal = (invoice = {}) => toNumber(invoice.totalAmount ?? invoice.total ?? invoice.totalAmount ?? 0);
const invoicePaid = (invoice = {}) => toNumber(invoice.paidAccountingAmount ?? invoice.amountPaid ?? 0);

const dueDateForInvoice = (invoice = {}) => invoice.dueDate || invoice.issueDate || invoice.createdAt || null;

const ageBucket = ({ asOf = new Date(), date = null }) => {
  const parsed = date ? new Date(date) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return "UNKNOWN";
  const days = Math.floor((asOf.getTime() - parsed.getTime()) / MS_PER_DAY);
  if (days <= 0) return "CURRENT";
  if (days <= 30) return "1_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "90_PLUS";
};

const emptyAging = () => ({
  CURRENT: { bucket: "CURRENT", amount: 0, count: 0 },
  "1_30": { bucket: "1_30", amount: 0, count: 0 },
  "31_60": { bucket: "31_60", amount: 0, count: 0 },
  "61_90": { bucket: "61_90", amount: 0, count: 0 },
  "90_PLUS": { bucket: "90_PLUS", amount: 0, count: 0 },
  UNKNOWN: { bucket: "UNKNOWN", amount: 0, count: 0 }
});

const buildAging = ({ rows = [], amountFn, dateFn, asOf = new Date() }) => {
  const aging = emptyAging();
  rows.forEach((row) => {
    const bucket = ageBucket({ asOf, date: dateFn(row) });
    aging[bucket].amount = Number((aging[bucket].amount + toNumber(amountFn(row))).toFixed(2));
    aging[bucket].count += 1;
  });
  return Object.values(aging);
};

const paidPaymentAmount = (payment = {}) =>
  toNumber(payment.accountingAmount ?? payment.amountPaid ?? payment.paidAmount ?? payment.amount ?? 0);

const paidPaymentFee = (payment = {}) => toNumber(payment.providerFeeAmount ?? 0);

const expenseAmount = (expense = {}) => toNumber(expense.baseCurrencyAmount ?? expense.amount ?? 0);
const incomeAmount = (income = {}) => toNumber(income.baseCurrencyAmount ?? income.amount ?? 0);

const buildManagementProfitLoss = async ({ services, periodRange }) => {
  const foundation = await services.businessAccountingService.getFoundationSummary({
    fromDate: periodRange?.fromIso || "",
    toDate: periodRange?.toIso || ""
  });

  return {
    report: "MANAGEMENT_PROFIT_LOSS_REPORT",
    statutoryReport: false,
    foundation,
    totals: foundation.totals || {},
    sourceOfTruth: {
      managementAccounting: "Business Accounting / AccountingPosting",
      noSecondAccountingTruth: true
    },
    limitations: [
      "This is a management P&L summary, not a statutory profit and loss statement.",
      "It uses Business Accounting foundation totals and does not duplicate posting formulas."
    ]
  };
};

const buildIncomeReport = async ({ services, filters, periodRange }) => {
  const result = await services.businessAccountingService.listBusinessIncome({
    status: filters.status || "",
    incomeCategory: filters.incomeCategory || "",
    businessUnit: filters.businessUnit || "",
    fromDate: periodRange?.fromIso || "",
    toDate: periodRange?.toIso || "",
    limit: 500
  });
  const items = asArray(result.items);

  return {
    report: "INCOME_REPORT",
    items,
    count: items.length,
    totals: {
      amount: sum(items, incomeAmount),
      countedAmount: sum(items.filter((item) => isCountedEntry(item.status)), incomeAmount)
    },
    byCategory: sortedGroups(groupBy(items, (item) => item.incomeCategory, incomeAmount)),
    byBusinessUnit: sortedGroups(groupBy(items, (item) => item.businessUnit, incomeAmount)),
    sourceOfTruth: {
      income: "BusinessIncome records normalized by Business Accounting service",
      noSecondAccountingTruth: true
    }
  };
};

const buildExpenseReport = async ({ services, filters, periodRange, category = "" }) => {
  const result = await services.businessAccountingService.listBusinessExpenses({
    status: filters.status || "",
    category: category || filters.expenseCategory || "",
    businessUnit: filters.businessUnit || "",
    paymentStatus: filters.expensePaymentStatus || filters.paymentStatus || "",
    fromDate: periodRange?.fromIso || "",
    toDate: periodRange?.toIso || "",
    limit: 500
  });
  const items = asArray(result.items);

  return {
    report: category === EXPENSE_CATEGORY.SALARIES ? "PAYROLL_SUMMARY" : "OPERATING_EXPENSE_REPORT",
    items,
    count: items.length,
    totals: {
      amount: sum(items, expenseAmount),
      countedAmount: sum(items.filter((item) => isCountedEntry(item.status)), expenseAmount)
    },
    byCategory: sortedGroups(groupBy(items, (item) => item.category, expenseAmount)),
    byPaymentStatus: sortedGroups(groupBy(items, (item) => item.paymentStatus, expenseAmount)),
    byBusinessUnit: sortedGroups(groupBy(items, (item) => item.businessUnit, expenseAmount)),
    sourceOfTruth: {
      expenses: "BusinessExpense records normalized by Business Accounting service",
      noSecondAccountingTruth: true
    }
  };
};

const buildSupplierExpenseReport = async ({ services, filters, periodRange }) => {
  const expenses = await buildExpenseReport({ services, filters, periodRange });
  return {
    ...expenses,
    report: "SUPPLIER_EXPENSE_REPORT",
    bySupplier: sortedGroups(groupBy(expenses.items, (item) => item.supplier?.name || item.supplier?.supplierId, expenseAmount)),
    limitations: [
      "Supplier expense reporting uses BusinessExpense.supplier evidence; supplier payable settlement models are handled separately."
    ]
  };
};

const buildCashFlowReport = async ({ services, periodRange }) => {
  const [payments, incomeResult, expenseResult] = await Promise.all([
    findRows({
      model: services.PaymentModel,
      query: {
        status: PAYMENT_STATUS.PAID,
        ...buildDateQuery({ range: periodRange, field: "paidAt" })
      },
      sort: { paidAt: -1, createdAt: -1 }
    }),
    services.businessAccountingService.listBusinessIncome({
      status: FINANCIAL_ENTRY_STATUS.PAID,
      fromDate: periodRange?.fromIso || "",
      toDate: periodRange?.toIso || "",
      limit: 500
    }),
    services.businessAccountingService.listBusinessExpenses({
      status: FINANCIAL_ENTRY_STATUS.PAID,
      paymentStatus: EXPENSE_PAYMENT_STATUS.PAID,
      fromDate: periodRange?.fromIso || "",
      toDate: periodRange?.toIso || "",
      limit: 500
    })
  ]);
  const otherIncome = asArray(incomeResult.items);
  const paidExpenses = asArray(expenseResult.items);
  const customerPayments = sum(payments, paidPaymentAmount);
  const providerFees = sum(payments, paidPaymentFee);
  const otherCashIn = sum(otherIncome, incomeAmount);
  const supplierAndOperatingCashOut = sum(paidExpenses, expenseAmount);
  const cashIn = Number((customerPayments + otherCashIn).toFixed(2));
  const cashOut = Number((supplierAndOperatingCashOut + providerFees).toFixed(2));

  return {
    report: "MANAGEMENT_CASH_FLOW_REPORT",
    statutoryReport: false,
    openingBalance: {
      value: null,
      supported: false,
      reason: "No dedicated cash account ledger exists yet."
    },
    closingBalance: {
      value: null,
      supported: false,
      reason: "No dedicated cash account ledger exists yet."
    },
    cashIn,
    cashOut,
    netMovement: Number((cashIn - cashOut).toFixed(2)),
    breakdown: {
      customerPayments,
      otherBusinessIncome: otherCashIn,
      providerFees,
      paidBusinessExpenses: supplierAndOperatingCashOut
    },
    evidence: {
      customerPaymentCount: payments.length,
      businessIncomeCount: otherIncome.length,
      paidExpenseCount: paidExpenses.length
    },
    sourceOfTruth: {
      customerPayments: "Payment.status=paid by paidAt",
      otherIncome: "BusinessIncome status=PAID",
      paidExpenses: "BusinessExpense status=PAID and paymentStatus=PAID",
      noSecondAccountingTruth: true
    },
    limitations: [
      "This is a management cash movement report, not a bank ledger or audited cash flow statement.",
      "Opening and closing balances are not shown until dedicated cash account accounting exists.",
      "Provider fees are shown separately from customer cash-in to avoid hiding gross payment evidence."
    ]
  };
};

const buildReceivablesReport = async ({ services, periodRange, now }) => {
  const invoices = await findRows({
    model: services.InvoiceModel,
    query: {
      paymentStatus: { $nin: [PAYMENT_STATUS.PAID, PAYMENT_STATUS.REFUNDED] },
      ...buildDateQuery({ range: periodRange, field: "issueDate" })
    },
    sort: { issueDate: -1, createdAt: -1 }
  });
  const rows = invoices
    .map((invoice) => {
      const outstanding = Math.max(amountFromInvoice(invoice), 0);
      return {
        invoiceNumber: invoice.invoiceNumber || "",
        bookingReference: invoice.bookingReference || "",
        counterparty: invoice.clientName || invoice.clientEmail || "Customer",
        source: "INVOICE",
        currency: invoice.accountingCurrency || "USD",
        amountDue: invoiceTotal(invoice),
        amountReceived: invoicePaid(invoice),
        outstanding,
        dueDate: dueDateForInvoice(invoice),
        paymentStatus: invoice.paymentStatus || "",
        agingBucket: ageBucket({ asOf: now(), date: dueDateForInvoice(invoice) })
      };
    })
    .filter((row) => row.outstanding > 0);

  return {
    report: "RECEIVABLES_AGING_REPORT",
    statutoryReport: false,
    rows,
    totals: {
      outstanding: sum(rows, (row) => row.outstanding),
      amountDue: sum(rows, (row) => row.amountDue),
      amountReceived: sum(rows, (row) => row.amountReceived)
    },
    aging: buildAging({
      rows,
      amountFn: (row) => row.outstanding,
      dateFn: (row) => row.dueDate,
      asOf: now()
    }),
    sourceOfTruth: {
      receivables: "Invoice balance snapshots",
      noSecondAccountingTruth: true
    },
    limitations: [
      "This is a management receivables aging report from invoice snapshots, not a statutory AR sub-ledger.",
      "Invoice due dates are limited; issueDate is used when no dedicated due date exists."
    ]
  };
};

const buildPayablesReport = async ({ services, periodRange, now }) => {
  const expenses = await findRows({
    model: services.BusinessExpenseModel,
    query: {
      paymentStatus: {
        $in: [
          EXPENSE_PAYMENT_STATUS.UNPAID,
          EXPENSE_PAYMENT_STATUS.PARTIALLY_PAID,
          EXPENSE_PAYMENT_STATUS.OVERDUE
        ]
      },
      status: { $in: [FINANCIAL_ENTRY_STATUS.SUBMITTED, FINANCIAL_ENTRY_STATUS.APPROVED, FINANCIAL_ENTRY_STATUS.PAID] },
      ...buildDateQuery({ range: periodRange, field: "dueDate" })
    },
    sort: { dueDate: 1, expenseDate: -1 }
  });
  const rows = expenses.map((expense) => ({
    expenseReference: expense.expenseReference || "",
    payee: expense.supplier?.name || expense.supplier?.supplierId || "Unassigned supplier",
    type: expense.category || "",
    source: "BUSINESS_EXPENSE",
    currency: expense.baseCurrency || expense.currency || "USD",
    amountDue: expenseAmount(expense),
    paid: expense.paymentStatus === EXPENSE_PAYMENT_STATUS.PAID ? expenseAmount(expense) : 0,
    outstanding: expense.paymentStatus === EXPENSE_PAYMENT_STATUS.PAID ? 0 : expenseAmount(expense),
    dueDate: expense.dueDate || expense.expenseDate || expense.createdAt || null,
    paymentStatus: expense.paymentStatus || "",
    agingBucket: ageBucket({ asOf: now(), date: expense.dueDate || expense.expenseDate || expense.createdAt })
  }));

  return {
    report: "PAYABLES_AGING_REPORT",
    statutoryReport: false,
    rows,
    totals: {
      outstanding: sum(rows, (row) => row.outstanding),
      amountDue: sum(rows, (row) => row.amountDue),
      paid: sum(rows, (row) => row.paid)
    },
    aging: buildAging({
      rows,
      amountFn: (row) => row.outstanding,
      dateFn: (row) => row.dueDate,
      asOf: now()
    }),
    sourceOfTruth: {
      payables: "BusinessExpense payment status and due date evidence",
      noSecondAccountingTruth: true
    },
    limitations: [
      "This is a management payables aging report from BusinessExpense records, not a statutory AP sub-ledger.",
      "Partial payment outstanding is not reduced unless explicit paid amount fields are added to expenses."
    ]
  };
};

const buildAssetRegister = () => ({
  report: "ASSET_REGISTER",
  supported: false,
  rows: [],
  totals: {},
  sourceOfTruth: {
    assets: "No dedicated fixed asset model exists yet",
    noSecondAccountingTruth: true
  },
  limitations: [
    "Asset register reporting is not enabled until a dedicated asset model and depreciation policy exist.",
    "No fake asset values are generated from expenses."
  ]
});

const buildAccountingReportView = async ({ definition, filters = {}, periodRange = null, services, now = () => new Date() }) => {
  const kind = definition.reportView?.kind || "";

  if (kind === "MANAGEMENT_PROFIT_LOSS") return buildManagementProfitLoss({ services, periodRange });
  if (kind === "INCOME") return buildIncomeReport({ services, filters, periodRange });
  if (kind === "OPERATING_EXPENSE") return buildExpenseReport({ services, filters, periodRange });
  if (kind === "PAYROLL") {
    return buildExpenseReport({ services, filters, periodRange, category: EXPENSE_CATEGORY.SALARIES });
  }
  if (kind === "SUPPLIER_EXPENSE") return buildSupplierExpenseReport({ services, filters, periodRange });
  if (kind === "CASH_FLOW") return buildCashFlowReport({ services, periodRange });
  if (kind === "RECEIVABLES") return buildReceivablesReport({ services, periodRange, now });
  if (kind === "PAYABLES") return buildPayablesReport({ services, periodRange, now });
  if (kind === "ASSET_REGISTER") return buildAssetRegister();

  return {
    report: "ACCOUNTING_REPORT_VIEW",
    supported: false,
    rows: [],
    limitations: ["This accounting report view is not implemented."]
  };
};

module.exports = {
  buildAccountingReportView,
  __testables: {
    ageBucket,
    amountFromInvoice,
    buildAging,
    buildCashFlowReport,
    buildPayablesReport,
    buildReceivablesReport,
    toNumber
  }
};
