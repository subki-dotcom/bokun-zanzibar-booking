process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/business-accounting-foundation-test";
process.env.JWT_SECRET ||= "business-accounting-foundation-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ACCOUNTING_SCOPE,
  BUSINESS_UNIT,
  EXPENSE_CATEGORY,
  EXPENSE_PAYMENT_STATUS,
  FINANCIAL_ENTRY_STATUS,
  INCOME_CATEGORY,
  POSTING_TYPE,
  SOURCE_MODULE
} = require("../src/accounting/constants");
const {
  createBusinessAccountingService,
  __testables
} = require("../src/services/businessAccounting");

const clone = (value) => JSON.parse(JSON.stringify(value));

const baseBooking = () => ({
  _id: "64f000000000000000000001",
  bookingReference: "ZNZ-BA-1001",
  bookingStatus: "confirmed",
  paymentStatus: "paid",
  operationalSource: "BOKUN",
  salesChannel: "VIATOR",
  bokunProductId: "PROD-1",
  productTitle: "Stone Town Tour",
  currency: "USD",
  pricingSnapshot: {
    finalPayable: 100,
    currency: "USD"
  },
  directBookingCosts: [{ amount: 45, currency: "USD" }],
  bokunOperationalDates: {
    bookingConfirmedAtBokun: {
      normalizedAt: "2026-08-08T08:00:00.000Z"
    }
  },
  createdAt: "2026-08-08T07:00:00.000Z"
});

const baseInvoice = () => ({
  _id: "64f000000000000000000101",
  invoiceNumber: "INV-BA-1001",
  bookingReference: "ZNZ-BA-1001",
  total: 100,
  amountPaid: 100,
  accountingCurrency: "USD",
  issueDate: "2026-08-08T08:05:00.000Z"
});

const basePayments = () => [
  {
    _id: "64f000000000000000000201",
    bookingReference: "ZNZ-BA-1001",
    intentId: "pay-1",
    status: "paid",
    verificationStatus: "verified",
    accountingAllocationStatus: "applied",
    accountingAmount: "100",
    accountingCurrency: "USD",
    providerFeeAmount: "3",
    providerFeeCurrency: "USD",
    paidAt: "2026-08-08T08:10:00.000Z"
  },
  {
    _id: "64f000000000000000000202",
    bookingReference: "ZNZ-BA-1001",
    intentId: "pay-1",
    status: "paid",
    verificationStatus: "verified",
    accountingAllocationStatus: "applied",
    accountingAmount: "100",
    accountingCurrency: "USD",
    providerFeeAmount: "3",
    providerFeeCurrency: "USD",
    paidAt: "2026-08-08T08:10:00.000Z"
  }
];

const baseRefunds = () => [
  {
    _id: "64f000000000000000000301",
    bookingId: "64f000000000000000000001",
    status: "refunded",
    confirmedRefundedAmount: 20,
    currency: "USD"
  }
];

const baseCommissions = () => [
  {
    _id: "64f000000000000000000401",
    bookingReference: "ZNZ-BA-1001",
    commissionAmount: 10,
    payoutStatus: "unpaid"
  }
];

const createFakeModels = ({
  booking = baseBooking(),
  invoice = baseInvoice(),
  payments = basePayments(),
  refunds = baseRefunds(),
  commissions = baseCommissions()
} = {}) => {
  const state = {
    booking: clone(booking),
    invoice: clone(invoice),
    payments: clone(payments),
    refunds: clone(refunds),
    commissions: clone(commissions),
    businessExpenses: [],
    businessIncomes: [],
    postings: [],
    audits: []
  };

  const matches = (row, query = {}) =>
    Object.entries(query).every(([key, value]) => {
      if (key === "status" && value?.$in) return value.$in.includes(row.status);
      if (value && typeof value === "object" && (value.$gte || value.$lte)) {
        const date = new Date(row[key]);
        if (value.$gte && date < value.$gte) return false;
        if (value.$lte && date > value.$lte) return false;
        return true;
      }
      return String(row[key] || "") === String(value || "");
    });

  const AccountingPostingModel = {
    findOne: async (query) => {
      const found = state.postings.find((posting) => matches(posting, query));
      return found ? clone(found) : null;
    },
    find: async (query) => state.postings.filter((posting) => matches(posting, query)).map(clone),
    create: async (payload) => {
      const row = {
        _id: `posting-${state.postings.length + 1}`,
        ...clone(payload)
      };
      state.postings.push(row);
      return clone(row);
    },
    findOneAndUpdate: async (query, update) => {
      const index = state.postings.findIndex((posting) => matches(posting, query));
      if (index < 0) return null;
      state.postings[index] = {
        ...state.postings[index],
        ...clone(update.$set || {})
      };
      return clone(state.postings[index]);
    }
  };

  const BusinessExpenseModel = {
    findOne: async (query) => {
      const found = state.businessExpenses.find((expense) => matches(expense, query));
      return found ? clone(found) : null;
    },
    find: async (query) => state.businessExpenses.filter((expense) => matches(expense, query)).map(clone),
    findById: async (id) => {
      const found = state.businessExpenses.find((expense) => String(expense._id) === String(id));
      return found ? clone(found) : null;
    },
    create: async (payload) => {
      const row = {
        _id: `64f00000000000000000e${String(state.businessExpenses.length + 1).padStart(2, "0")}`,
        ...clone(payload)
      };
      state.businessExpenses.push(row);
      return clone(row);
    },
    findByIdAndUpdate: async (id, update) => {
      const index = state.businessExpenses.findIndex((expense) => String(expense._id) === String(id));
      if (index < 0) return null;
      state.businessExpenses[index] = {
        ...state.businessExpenses[index],
        ...clone(update.$set || {})
      };
      return clone(state.businessExpenses[index]);
    },
    findOneAndUpdate: async (query, update) => {
      const index = state.businessExpenses.findIndex((expense) => matches(expense, query));
      if (index < 0) return null;
      state.businessExpenses[index] = {
        ...state.businessExpenses[index],
        ...clone(update.$set || {})
      };
      return clone(state.businessExpenses[index]);
    }
  };

  const BusinessIncomeModel = {
    findOne: async (query) => {
      const found = state.businessIncomes.find((income) => matches(income, query));
      return found ? clone(found) : null;
    },
    find: async (query) => state.businessIncomes.filter((income) => matches(income, query)).map(clone),
    findById: async (id) => {
      const found = state.businessIncomes.find((income) => String(income._id) === String(id));
      return found ? clone(found) : null;
    },
    create: async (payload) => {
      const row = {
        _id: `64f00000000000000000b${String(state.businessIncomes.length + 1).padStart(2, "0")}`,
        ...clone(payload)
      };
      state.businessIncomes.push(row);
      return clone(row);
    },
    findByIdAndUpdate: async (id, update) => {
      const index = state.businessIncomes.findIndex((income) => String(income._id) === String(id));
      if (index < 0) return null;
      state.businessIncomes[index] = {
        ...state.businessIncomes[index],
        ...clone(update.$set || {})
      };
      return clone(state.businessIncomes[index]);
    },
    findOneAndUpdate: async (query, update) => {
      const index = state.businessIncomes.findIndex((income) => matches(income, query));
      if (index < 0) return null;
      state.businessIncomes[index] = {
        ...state.businessIncomes[index],
        ...clone(update.$set || {})
      };
      return clone(state.businessIncomes[index]);
    }
  };

  const AuditLogModel = {
    create: async (payload) => {
      state.audits.push(clone(payload));
      return payload;
    }
  };

  const BookingModel = {
    findOne: async ({ bookingReference }) =>
      state.booking.bookingReference === bookingReference ? clone(state.booking) : null
  };
  const InvoiceModel = {
    findOne: async ({ bookingReference }) =>
      state.invoice.bookingReference === bookingReference ? clone(state.invoice) : null
  };
  const PaymentModel = {
    find: async ({ bookingReference }) =>
      state.payments.filter((payment) => payment.bookingReference === bookingReference).map(clone)
  };
  const RefundModel = {
    find: async ({ bookingId }) =>
      state.refunds.filter((refund) => String(refund.bookingId) === String(bookingId)).map(clone)
  };
  const CommissionRecordModel = {
    find: async ({ bookingReference }) =>
      state.commissions.filter((commission) => commission.bookingReference === bookingReference).map(clone)
  };

  const service = createBusinessAccountingService({
    AccountingPostingModel,
    AuditLogModel,
    BusinessExpenseModel,
    BusinessIncomeModel,
    BookingModel,
    InvoiceModel,
    PaymentModel,
    RefundModel,
    CommissionRecordModel,
    now: () => new Date("2026-08-08T09:00:00.000Z")
  });

  return { state, service };
};

test("builds one source-linked booking contribution without duplicating booking revenue as other income", () => {
  const posting = __testables.buildBookingContributionPosting({
    booking: baseBooking(),
    invoice: baseInvoice(),
    payments: basePayments(),
    refunds: baseRefunds(),
    commissions: baseCommissions(),
    nowDate: new Date("2026-08-08T09:00:00.000Z")
  });

  assert.equal(posting.accountingScope, ACCOUNTING_SCOPE.BUSINESS);
  assert.equal(posting.sourceModule, SOURCE_MODULE.BOOKING_ACCOUNTING);
  assert.equal(posting.postingType, POSTING_TYPE.BOOKING_NET_CONTRIBUTION);
  assert.equal(posting.sourceReference, "ZNZ-BA-1001");
  assert.equal(posting.components.collectedRevenue, "100");
  assert.equal(posting.components.refundedAmount, "20");
  assert.equal(posting.components.providerFees, "3");
  assert.equal(posting.components.channelCommission, "10");
  assert.equal(posting.components.directBookingCosts, "0");
  assert.equal(posting.components.otherBusinessIncome, "0");
  assert.equal(posting.components.operatingExpenses, "0");
  assert.equal(posting.amount, "67");
});

test("dry-run builds a booking contribution plan without writing postings or audits", async () => {
  const harness = createFakeModels();

  const result = await harness.service.postBookingContribution({
    bookingReference: "ZNZ-BA-1001",
    dryRun: true
  });

  assert.equal(result.action, "would_create");
  assert.equal(result.dryRun, true);
  assert.equal(harness.state.postings.length, 0);
  assert.equal(harness.state.audits.length, 0);
});

test("repeated booking contribution posting is idempotent and counted once in company totals", async () => {
  const harness = createFakeModels();

  const first = await harness.service.postBookingContribution({
    bookingReference: "ZNZ-BA-1001",
    auth: { id: "admin-1", role: "admin" },
    requestId: "step3a-1"
  });
  const second = await harness.service.postBookingContribution({
    bookingReference: "ZNZ-BA-1001",
    auth: { id: "admin-1", role: "admin" },
    requestId: "step3a-2"
  });
  const summary = await harness.service.getFoundationSummary();

  assert.equal(first.action, "created");
  assert.equal(second.action, "unchanged");
  assert.equal(harness.state.postings.length, 1);
  assert.equal(harness.state.audits.length, 1);
  assert.equal(summary.totals.bookingNetContribution, 67);
  assert.equal(summary.bookingContributionPostingCount, 1);
});

test("booking contribution refresh updates the existing source-linked posting without creating a duplicate", async () => {
  const harness = createFakeModels();

  await harness.service.postBookingContribution({ bookingReference: "ZNZ-BA-1001" });
  harness.state.refunds[0].confirmedRefundedAmount = 30;

  const refreshed = await harness.service.postBookingContribution({
    bookingReference: "ZNZ-BA-1001",
    auth: { id: "admin-1", role: "admin" },
    requestId: "step3a-refresh"
  });
  const summary = await harness.service.getFoundationSummary();

  assert.equal(refreshed.action, "updated");
  assert.equal(harness.state.postings.length, 1);
  assert.equal(harness.state.audits.length, 2);
  assert.equal(refreshed.posting.amount, "57");
  assert.equal(summary.totals.bookingNetContribution, 57);
});

test("approved other business income feeds company totals once through a source-linked posting", async () => {
  const harness = createFakeModels();

  const created = await harness.service.createBusinessIncome({
    input: {
      incomeCategory: INCOME_CATEGORY.SERVICE_INCOME,
      businessUnit: BUSINESS_UNIT.GENERAL_COMPANY,
      description: "Consulting service income",
      amount: "250",
      currency: "USD",
      status: FINANCIAL_ENTRY_STATUS.APPROVED,
      sourceReference: "CONSULT-001",
      reference: "RCPT-001",
      transactionDate: "2026-08-08T09:00:00.000Z"
    },
    auth: { id: "admin-1", role: "admin" },
    requestId: "income-create"
  });
  const repeated = await harness.service.createBusinessIncome({
    input: {
      incomeCategory: INCOME_CATEGORY.SERVICE_INCOME,
      businessUnit: BUSINESS_UNIT.GENERAL_COMPANY,
      description: "Consulting service income duplicate",
      amount: "250",
      currency: "USD",
      status: FINANCIAL_ENTRY_STATUS.APPROVED,
      sourceReference: "CONSULT-001"
    }
  });
  const summary = await harness.service.getFoundationSummary();

  assert.equal(created.action, "created");
  assert.equal(repeated.action, "unchanged");
  assert.equal(harness.state.businessIncomes.length, 1);
  assert.equal(harness.state.postings.length, 1);
  assert.equal(harness.state.postings[0].postingType, POSTING_TYPE.OTHER_BUSINESS_INCOME);
  assert.equal(summary.totals.otherBusinessIncome, 250);
  assert.equal(summary.totals.companyContributionRevenue, 250);
  assert.equal(summary.totals.companyNetProfit, 250);
});

test("draft business income is stored but not counted until approved", async () => {
  const harness = createFakeModels();

  const draft = await harness.service.createBusinessIncome({
    input: {
      incomeCategory: INCOME_CATEGORY.RENTAL_INCOME,
      description: "Vehicle rental deposit",
      amount: "80",
      currency: "USD",
      status: FINANCIAL_ENTRY_STATUS.DRAFT
    }
  });
  const beforeApproval = await harness.service.getFoundationSummary();
  const approved = await harness.service.updateBusinessIncome({
    incomeId: draft.income.id,
    input: { status: FINANCIAL_ENTRY_STATUS.APPROVED },
    auth: { id: "admin-1", role: "admin" }
  });
  const afterApproval = await harness.service.getFoundationSummary();

  assert.equal(beforeApproval.totals.otherBusinessIncome, 0);
  assert.equal(harness.state.postings.length, 1);
  assert.equal(approved.posting.postingType, POSTING_TYPE.OTHER_BUSINESS_INCOME);
  assert.equal(afterApproval.totals.otherBusinessIncome, 80);
});

test("manual booking income link is rejected to prevent duplicate booking revenue", async () => {
  const harness = createFakeModels();

  await assert.rejects(
    () => harness.service.createBusinessIncome({
      input: {
        incomeCategory: INCOME_CATEGORY.BOOKING_INCOME_LINK,
        sourceModule: SOURCE_MODULE.BOOKING_ACCOUNTING,
        sourceReference: "ZNZ-BA-1001",
        description: "Manual booking revenue duplicate",
        amount: "100",
        currency: "USD",
        status: FINANCIAL_ENTRY_STATUS.APPROVED
      }
    }),
    (error) => error.code === "BOOKING_INCOME_LINK_NOT_MANUAL"
  );

  assert.equal(harness.state.businessIncomes.length, 0);
  assert.equal(harness.state.postings.length, 0);
});

test("approved operating expense decreases company net profit through one expense posting", async () => {
  const harness = createFakeModels();

  const created = await harness.service.createBusinessExpense({
    input: {
      category: EXPENSE_CATEGORY.OFFICE_RENT,
      businessUnit: BUSINESS_UNIT.GENERAL_COMPANY,
      description: "Office rent August",
      supplier: { name: "Stone Town Office" },
      amount: "75",
      currency: "USD",
      status: FINANCIAL_ENTRY_STATUS.APPROVED,
      paymentStatus: EXPENSE_PAYMENT_STATUS.UNPAID,
      sourceReference: "RENT-2026-08",
      expenseDate: "2026-08-08T09:00:00.000Z"
    },
    auth: { id: "admin-1", role: "admin" },
    requestId: "expense-create"
  });
  const summary = await harness.service.getFoundationSummary();

  assert.equal(created.action, "created");
  assert.equal(harness.state.businessExpenses.length, 1);
  assert.equal(harness.state.postings.length, 1);
  assert.equal(harness.state.postings[0].postingType, POSTING_TYPE.OPERATING_EXPENSE);
  assert.equal(harness.state.postings[0].components.operatingExpenses.$numberDecimal, "75");
  assert.equal(summary.totals.companyExpenses, 75);
  assert.equal(summary.totals.companyNetProfit, -75);
});

test("draft operating expense is stored but not counted until approved", async () => {
  const harness = createFakeModels();

  const draft = await harness.service.createBusinessExpense({
    input: {
      category: EXPENSE_CATEGORY.SOFTWARE,
      description: "Accounting software subscription",
      amount: "40",
      currency: "USD",
      status: FINANCIAL_ENTRY_STATUS.DRAFT,
      expenseDate: "2026-08-08T09:00:00.000Z"
    }
  });
  const beforeApproval = await harness.service.getFoundationSummary();
  const approved = await harness.service.updateBusinessExpense({
    expenseId: draft.expense.id,
    input: { status: FINANCIAL_ENTRY_STATUS.APPROVED },
    auth: { id: "admin-1", role: "admin" }
  });
  const afterApproval = await harness.service.getFoundationSummary();

  assert.equal(beforeApproval.totals.companyExpenses, 0);
  assert.equal(harness.state.postings.length, 1);
  assert.equal(approved.posting.postingType, POSTING_TYPE.OPERATING_EXPENSE);
  assert.equal(afterApproval.totals.companyExpenses, 40);
  assert.equal(afterApproval.totals.companyNetProfit, -40);
});

test("booking direct cost source is rejected as a business operating expense", async () => {
  const harness = createFakeModels();

  await assert.rejects(
    () => harness.service.createBusinessExpense({
      input: {
        accountingScope: ACCOUNTING_SCOPE.BOOKING,
        category: EXPENSE_CATEGORY.OTHER_OPERATING_EXPENSE,
        sourceModule: SOURCE_MODULE.BOOKING_ACCOUNTING,
        bookingReference: "ZNZ-BA-1001",
        description: "Direct guide fee for one booking",
        amount: "25",
        currency: "USD",
        status: FINANCIAL_ENTRY_STATUS.APPROVED
      }
    }),
    (error) => error.code === "BOOKING_DIRECT_COST_NOT_BUSINESS_EXPENSE"
  );

  assert.equal(harness.state.businessExpenses.length, 0);
  assert.equal(harness.state.postings.length, 0);
});

test("repeated operating expense source is idempotent and does not duplicate postings", async () => {
  const harness = createFakeModels();

  const first = await harness.service.createBusinessExpense({
    input: {
      category: EXPENSE_CATEGORY.INTERNET,
      description: "Office internet",
      amount: "55",
      currency: "USD",
      status: FINANCIAL_ENTRY_STATUS.APPROVED,
      sourceReference: "ISP-2026-08"
    }
  });
  const repeated = await harness.service.createBusinessExpense({
    input: {
      category: EXPENSE_CATEGORY.INTERNET,
      description: "Office internet duplicate",
      amount: "55",
      currency: "USD",
      status: FINANCIAL_ENTRY_STATUS.APPROVED,
      sourceReference: "ISP-2026-08"
    }
  });
  const summary = await harness.service.getFoundationSummary();

  assert.equal(first.action, "created");
  assert.equal(repeated.action, "unchanged");
  assert.equal(harness.state.businessExpenses.length, 1);
  assert.equal(harness.state.postings.length, 1);
  assert.equal(summary.totals.companyExpenses, 55);
});

test("voided operating expense keeps history but stops counting in company totals", async () => {
  const harness = createFakeModels();

  const created = await harness.service.createBusinessExpense({
    input: {
      category: EXPENSE_CATEGORY.MARKETING,
      description: "Campaign budget",
      amount: "120",
      currency: "USD",
      status: FINANCIAL_ENTRY_STATUS.APPROVED,
      sourceReference: "MKT-2026-08"
    }
  });
  const beforeVoid = await harness.service.getFoundationSummary();
  const voided = await harness.service.updateBusinessExpense({
    expenseId: created.expense.id,
    input: { status: FINANCIAL_ENTRY_STATUS.VOID },
    auth: { id: "admin-1", role: "admin" }
  });
  const afterVoid = await harness.service.getFoundationSummary();

  assert.equal(beforeVoid.totals.companyExpenses, 120);
  assert.equal(voided.expense.status, FINANCIAL_ENTRY_STATUS.VOID);
  assert.equal(harness.state.postings.length, 1);
  assert.equal(harness.state.postings[0].status, FINANCIAL_ENTRY_STATUS.VOID);
  assert.equal(afterVoid.totals.companyExpenses, 0);
});

test("management accounting dashboard snapshot uses counted postings without duplicating booking revenue", async () => {
  const harness = createFakeModels();

  await harness.service.postBookingContribution({ bookingReference: "ZNZ-BA-1001" });
  await harness.service.createBusinessIncome({
    input: {
      incomeCategory: INCOME_CATEGORY.COMMISSION_INCOME,
      description: "Partner commission",
      amount: "250",
      currency: "USD",
      status: FINANCIAL_ENTRY_STATUS.APPROVED,
      sourceReference: "COMM-2026-08",
      transactionDate: "2026-08-12T09:00:00.000Z"
    }
  });
  await harness.service.createBusinessExpense({
    input: {
      category: EXPENSE_CATEGORY.SALARIES,
      description: "Guide payroll",
      amount: "80",
      currency: "USD",
      status: FINANCIAL_ENTRY_STATUS.PAID,
      paymentStatus: EXPENSE_PAYMENT_STATUS.PAID,
      sourceReference: "PAY-2026-08",
      expenseDate: "2026-08-15T09:00:00.000Z"
    }
  });
  await harness.service.createBusinessIncome({
    input: {
      incomeCategory: INCOME_CATEGORY.SERVICE_INCOME,
      description: "Prior period service",
      amount: "100",
      currency: "USD",
      status: FINANCIAL_ENTRY_STATUS.APPROVED,
      sourceReference: "SVC-2026-07",
      transactionDate: "2026-07-12T09:00:00.000Z"
    }
  });
  await harness.service.createBusinessExpense({
    input: {
      category: EXPENSE_CATEGORY.INTERNET,
      description: "Prior period internet",
      amount: "20",
      currency: "USD",
      status: FINANCIAL_ENTRY_STATUS.APPROVED,
      sourceReference: "NET-2026-07",
      expenseDate: "2026-07-14T09:00:00.000Z"
    }
  });

  const summary = await harness.service.getFoundationSummary({ dateRange: "this_month" });

  assert.equal(summary.period.label, "This Month");
  assert.equal(summary.totals.bookingNetContribution, 67);
  assert.equal(summary.totals.otherBusinessIncome, 250);
  assert.equal(summary.totals.companyContributionRevenue, 317);
  assert.equal(summary.totals.companyExpenses, 80);
  assert.equal(summary.totals.companyNetProfit, 237);
  assert.equal(summary.previousTotals.otherBusinessIncome, 100);
  assert.equal(summary.previousTotals.companyExpenses, 20);
  assert.equal(summary.kpis.companyNetProfit.value, 237);
  assert.equal(summary.formulas.duplicateBookingRevenueProtection.includes("BOOKING_NET_CONTRIBUTION"), true);
  assert.deepEqual(
    summary.incomeBreakdown.map((row) => row.label),
    ["Other Income", "Booking Contribution"]
  );
  assert.equal(summary.expenseBreakdown[0].label, "Salaries & Wages");
  assert.match(summary.recentIncome[0].reference, /^BI-20260808-/);
  assert.equal(summary.recentIncome[0].description, "Partner commission");
  assert.match(summary.recentExpenses[0].reference, /^BE-20260808-/);
  assert.equal(summary.recentExpenses[0].description, "Guide payroll");
  assert.ok(summary.incomeVsExpenses.some((point) => point.income > 0));
  assert.equal(summary.sourceStrategy.revenueDuplicationProtection.label, "Revenue Duplication Protection");
});

test("management accounting dashboard custom date filters all widgets", async () => {
  const harness = createFakeModels();

  await harness.service.createBusinessIncome({
    input: {
      incomeCategory: INCOME_CATEGORY.RENTAL_INCOME,
      description: "August car rental",
      amount: "70",
      currency: "USD",
      status: FINANCIAL_ENTRY_STATUS.APPROVED,
      sourceReference: "RENT-2026-08",
      transactionDate: "2026-08-20T09:00:00.000Z"
    }
  });

  const august = await harness.service.getFoundationSummary({
    fromDate: "2026-08-01",
    toDate: "2026-08-31"
  });
  const september = await harness.service.getFoundationSummary({
    fromDate: "2026-09-01",
    toDate: "2026-09-30"
  });

  assert.equal(august.totals.otherBusinessIncome, 70);
  assert.equal(august.recentIncome.length, 1);
  assert.equal(september.totals.otherBusinessIncome, 0);
  assert.equal(september.recentIncome.length, 0);
  assert.equal(september.incomeBreakdown.length, 0);
});
