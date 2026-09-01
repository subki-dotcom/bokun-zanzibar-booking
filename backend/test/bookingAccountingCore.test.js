process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/booking-accounting-core-test";
process.env.JWT_SECRET ||= "booking-accounting-core-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createBookingAccountingService } = require("../src/services/bookingAccounting");

const clone = (value) => JSON.parse(JSON.stringify(value));

const getPath = (record = {}, path = "") =>
  path.split(".").reduce((current, key) => (current === undefined || current === null ? undefined : current[key]), record);

const matchesQuery = (record = {}, query = {}) => {
  if (!query || Object.keys(query).length === 0) return true;

  return Object.entries(query).every(([key, expected]) => {
    if (key === "$or") return expected.some((branch) => matchesQuery(record, branch));
    if (key === "$and") return expected.every((branch) => matchesQuery(record, branch));
    const actual = getPath(record, key);

    if (expected instanceof RegExp) return expected.test(String(actual || ""));
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if (expected.$in) return expected.$in.map(String).includes(String(actual || ""));
      if (Object.prototype.hasOwnProperty.call(expected, "$exists")) {
        const exists = actual !== undefined && actual !== null;
        if (Boolean(expected.$exists) !== exists) return false;
      }
      if (Object.prototype.hasOwnProperty.call(expected, "$ne") && String(actual || "") === String(expected.$ne || "")) {
        return false;
      }
      if (expected.$gte || expected.$lte) {
        const date = new Date(actual || 0);
        if (expected.$gte && date < expected.$gte) return false;
        if (expected.$lte && date > expected.$lte) return false;
      }
      return true;
    }

    return String(actual || "") === String(expected || "");
  });
};

const createModel = (records = [], name = "record") => {
  const store = records.map(clone);
  const assignUpdate = (record, update = {}) => {
    const patch = update.$set || update;
    Object.entries(patch).forEach(([key, value]) => {
      record[key] = clone(value);
    });
    record.updatedAt = record.updatedAt || "2026-08-15T00:00:00.000Z";
    return record;
  };
  return {
    __store: store,
    find: (query = {}) => store.filter((record) => matchesQuery(record, query)).map(clone),
    findOne: (query = {}) => clone(store.find((record) => matchesQuery(record, query)) || null),
    findById: (id) => clone(store.find((record) => String(record._id) === String(id)) || null),
    findByIdAndUpdate: (id, update = {}) => {
      const record = store.find((row) => String(row._id) === String(id));
      return record ? clone(assignUpdate(record, update)) : null;
    },
    create: async (payload = {}) => {
      const record = {
        _id: `${name}-${store.length + 1}`,
        createdAt: "2026-08-15T00:00:00.000Z",
        updatedAt: "2026-08-15T00:00:00.000Z",
        ...clone(payload)
      };
      store.push(record);
      return clone(record);
    },
    countDocuments: async (query = {}) => store.filter((record) => matchesQuery(record, query)).length
  };
};

const productSnapshots = [
  {
    _id: "snapshot-1",
    bokunProductId: "PROD-1",
    title: "Mnemba Snorkeling Tour",
    slug: "mnemba-snorkeling-tour",
    currency: "USD",
    status: "active",
    images: ["https://example.test/mnemba.jpg"],
    options: [
      { bokunOptionId: "OPT-PRIVATE", name: "Private Tour (1-6 Pax)", active: true },
      { bokunOptionId: "OPT-SHARED", name: "Shared Tour", active: true }
    ],
    rawBokunProduct: {
      pricingCategories: [
        { id: "adult", title: "Adult", ticketCategory: "ADULT" },
        { id: "child", title: "Child", ticketCategory: "CHILD" }
      ]
    },
    lastSyncedAt: "2026-08-14T08:00:00.000Z"
  }
];

const existingCostTemplates = [
  {
    _id: "template-1",
    bokunProductId: "PROD-1",
    bokunProductTitle: "Mnemba Snorkeling Tour",
    bokunOptionId: "OPT-PRIVATE",
    bokunOptionTitle: "Private Tour (1-6 Pax)",
    pricingCategoryId: "",
    currency: "USD",
    name: "Mnemba Private Cost",
    status: "active",
    version: 1,
    validFrom: "2026-01-01T00:00:00.000Z",
    validTo: null,
    costLines: [
      { lineId: "boat", category: "Boat", basis: "fixed_per_booking", amount: 70 },
      { lineId: "guide", category: "Guide", basis: "fixed_per_booking", amount: 20 },
      { lineId: "water", category: "Water", basis: "per_participant", amount: 2 }
    ],
    updatedAt: "2026-08-14T08:00:00.000Z"
  }
];

const createService = ({
  ProductCostTemplateModel = createModel(existingCostTemplates, "template"),
  ToursService = { syncProducts: async () => ({ syncedCount: 0, syncLogId: null }) }
} = {}) =>
  createBookingAccountingService({
    AuditLogModel: createModel([], "audit"),
    BookingModel: createModel([
      {
        _id: "booking-1",
        bookingReference: "ZNZ-BA-1",
        bokunProductId: "PROD-1",
        bokunOptionId: "OPT-PRIVATE",
        productTitle: "Stone Town Tour",
        optionTitle: "Standard",
        salesChannel: "DIRECT_WEBSITE",
        bookingStatus: "cancelled",
        paymentStatus: "paid",
        amountRefunded: 0,
        currency: "USD"
      }
    ]),
    InvoiceModel: createModel([
      {
        _id: "invoice-1",
        invoiceNumber: "INV-BA-1",
        bookingReference: "ZNZ-BA-1",
        tourName: "Stone Town Tour",
        paymentStatus: "paid",
        total: 100,
        amountPaid: 100,
        amountRefunded: 0,
        balanceDue: 0,
        accountingCurrency: "USD",
        issueDate: "2026-08-01T10:00:00.000Z"
      }
    ]),
    PaymentModel: createModel([
      {
        _id: "payment-1",
        bookingReference: "ZNZ-BA-1",
        provider: "pesapal",
        status: "paid",
        amountPaid: 100,
        refundedAmount: 0,
        providerFeeAmount: "2",
        accountingCurrency: "USD"
      }
    ]),
    RefundModel: createModel([
      {
        _id: "refund-awaiting",
        refundReference: "REF-BA-WAIT",
        bookingId: "booking-1",
        paymentId: "payment-1",
        invoiceId: "invoice-1",
        provider: "pesapal",
        status: "awaiting_merchant_approval",
        amount: 30,
        requestedAmount: 30,
        confirmedRefundedAmount: 0,
        currency: "USD",
        providerRefundRequestReference: "TRANSACTION_REFUND_REQUEST-26607935178085",
        createdAt: "2026-08-02T10:00:00.000Z"
      },
      {
        _id: "refund-completed",
        refundReference: "REF-BA-DONE",
        bookingId: "booking-1",
        paymentId: "payment-1",
        invoiceId: "invoice-1",
        provider: "pesapal",
        status: "partially_refunded",
        amount: 30,
        requestedAmount: 30,
        confirmedRefundedAmount: 30,
        currency: "USD",
        providerRefundRequestReference: "TRANSACTION_REFUND_REQUEST-26607935178085",
        originalTransactionReference: "26607935178085",
        completedAt: "2026-08-03T10:00:00.000Z"
      },
      {
        _id: "refund-bad",
        refundReference: "REF-BA-ZERO",
        bookingId: "booking-1",
        paymentId: "payment-1",
        invoiceId: "invoice-1",
        provider: "paypal",
        status: "refunded",
        amount: 10,
        requestedAmount: 10,
        confirmedRefundedAmount: 0,
        currency: "USD"
      }
    ]),
    BusinessExpenseModel: createModel([
      {
        _id: "expense-1",
        expenseReference: "EXP-BA-1",
        bookingReference: "ZNZ-BA-1",
        category: "OTHER_OPERATING_EXPENSE",
        description: "Guide cost",
        supplier: { name: "Guide A" },
        amount: "20",
        currency: "USD",
        baseCurrencyAmount: "20",
        baseCurrency: "USD",
        status: "PAID",
        expenseDate: "2026-08-01T12:00:00.000Z"
      },
      {
        _id: "expense-2",
        expenseReference: "EXP-GENERAL-1",
        bookingReference: "",
        category: "OFFICE_RENT",
        description: "General office rent",
        supplier: { name: "Landlord" },
        amount: "200",
        currency: "USD",
        baseCurrencyAmount: "200",
        baseCurrency: "USD",
        status: "PAID",
        sourceModule: "BUSINESS_ACCOUNTING",
        expenseDate: "2026-08-01T12:00:00.000Z"
      }
    ]),
    ProductCostTemplateModel,
    ProductSnapshotModel: createModel(productSnapshots, "product"),
    ToursService
  });

test("booking accounting refund list keeps Pesapal request acceptance separate from confirmed refund", async () => {
  const service = createService();

  const result = await service.listRefunds({ status: "awaiting_merchant_approval" });

  assert.equal(result.count, 1);
  assert.equal(result.items[0].status, "awaiting_merchant_approval");
  assert.equal(result.items[0].bookingReference, "ZNZ-BA-1");
  assert.equal(result.items[0].provider, "pesapal");
  assert.equal(result.items[0].requestedAmount, 30);
  assert.equal(result.items[0].confirmedRefundedAmount, 0);
  assert.equal(result.items[0].providerRefundReference, "");
  assert.equal(result.items[0].providerRefundRequestReference, "TRANSACTION_REFUND_REQUEST-26607935178085");
});

test("booking accounting profitability uses only confirmed refund amounts", async () => {
  const service = createService();

  const result = await service.getProfitability({ limit: 20 });
  const row = result.items.find((item) => item.bookingReference === "ZNZ-BA-1");

  assert.equal(row.collectedRevenue, 100);
  assert.equal(row.refundedAmount, 30);
  assert.equal(row.paymentProviderFees, 2);
  assert.equal(row.actualDirectCost, 20);
  assert.equal(row.netRevenue, 68);
  assert.equal(row.grossProfit, 48);
  assert.equal(row.profitMargin, 70.59);
});

test("booking accounting reconciliation flags completed refund with zero confirmed amount", async () => {
  const service = createService();

  const result = await service.getReconciliation({ limit: 20 });

  assert.ok(result.items.some((issue) => issue.code === "REFUND_CONFIRMED_AMOUNT_ZERO"));
});

test("booking accounting expenses stay scoped to booking-linked records when searching", async () => {
  const service = createService();

  const result = await service.listExpenses({ search: "general" });

  assert.equal(result.count, 0);
});

test("booking accounting cost template dashboard joins Bokun options with active templates", async () => {
  const service = createService();

  const result = await service.getCostTemplates();

  assert.equal(result.configured, true);
  assert.equal(result.summary.totalBokunProducts, 1);
  assert.equal(result.summary.totalBokunOptions, 2);
  assert.equal(result.summary.costedOptions, 1);
  assert.equal(result.summary.missingCost, 1);
  assert.equal(result.items.find((item) => item.bokunOptionId === "OPT-PRIVATE").costStatus, "costed");
  assert.equal(result.items.find((item) => item.bokunOptionId === "OPT-SHARED").costStatus, "missing_cost");
  assert.ok(result.costBasisTypes.includes("per_participant"));
  assert.ok(result.controlledExpenseCategories.includes("OTHER_OPERATING_EXPENSE"));
});

test("booking accounting cost template Bokun sync returns current catalog and prevents duplicate in-flight sync", async () => {
  let calls = 0;
  let releaseSync;
  const syncHold = new Promise((resolve) => {
    releaseSync = resolve;
  });
  const service = createService({
    ToursService: {
      syncProducts: async () => {
        calls += 1;
        await syncHold;
        return { syncedCount: 38, syncLogId: "sync-log-1" };
      }
    }
  });

  const first = await service.startCostTemplateBokunProductSync({
    auth: { id: "admin-1", role: "admin" },
    requestId: "req-1"
  });
  const second = await service.startCostTemplateBokunProductSync({
    auth: { id: "admin-1", role: "admin" },
    requestId: "req-2"
  });

  assert.equal(first.syncStatus, "started");
  assert.equal(first.syncInProgress, true);
  assert.equal(first.currentCatalog.summary.totalBokunProducts, 1);
  assert.equal(second.syncStatus, "already_running");
  assert.equal(second.syncInProgress, true);
  assert.equal(second.currentCatalog.summary.totalBokunOptions, 2);
  assert.equal(calls, 1);

  releaseSync();
  await new Promise((resolve) => setImmediate(resolve));
});

test("booking accounting cost template calculation supports core cost bases", async () => {
  const service = createService();

  const result = service.calculateEstimatedBookingCost({
    template: { currency: "USD" },
    costLines: [
      { category: "Boat", basis: "fixed_per_booking", amount: 70 },
      { category: "Water", basis: "per_participant", amount: 2 },
      { category: "Transport", basis: "per_vehicle", amount: 25 },
      { category: "Commission", basis: "percentage", percentage: 10 },
      { category: "Guide", basis: "tiered", tiers: [{ min: 1, max: 4, amount: 15 }] }
    ],
    context: { adults: 2, children: 0, participants: 2, vehicles: 1, sellingAmount: 100 }
  });

  assert.equal(result.totalEstimatedCost, 124);
  assert.equal(result.breakdown.length, 5);
});

test("booking accounting cost template creation validates real Bokun product options", async () => {
  const service = createService({ ProductCostTemplateModel: createModel([], "template") });

  await assert.rejects(
    service.createCostTemplate({
      payload: {
        bokunProductId: "PROD-404",
        bokunOptionId: "OPT-404",
        currency: "USD",
        name: "Invalid Option",
        status: "active",
        validFrom: "2026-08-01",
        costLines: [{ category: "Guide", basis: "fixed_per_booking", amount: 10 }]
      }
    }),
    /Select a Bókun product option/
  );
});

test("booking accounting cost template creation prevents overlapping active templates", async () => {
  const service = createService();

  await assert.rejects(
    service.createCostTemplate({
      payload: {
        bokunProductId: "PROD-1",
        bokunOptionId: "OPT-PRIVATE",
        currency: "USD",
        name: "Duplicate Active",
        status: "active",
        validFrom: "2026-08-01",
        validTo: "2026-09-01",
        costLines: [{ category: "Guide", basis: "fixed_per_booking", amount: 10 }]
      }
    }),
    (error) => error.code === "COST_TEMPLATE_ACTIVE_OVERLAP"
  );
});

test("booking accounting resolves effective active template for a booking", async () => {
  const service = createService();

  const result = await service.resolveCostTemplate({
    booking: {
      bokunProductId: "PROD-1",
      bokunOptionId: "OPT-PRIVATE",
      paxSummary: { adults: 2, children: 0, total: 2 },
      pricingSnapshot: { finalPayable: 100 },
      currency: "USD"
    },
    asOfDate: "2026-08-10T00:00:00.000Z"
  });

  assert.equal(result.template.id, "template-1");
  assert.equal(result.calculation.totalEstimatedCost, 94);
});
