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

const createModel = (records = []) => ({
  find: (query = {}) => records.filter((record) => matchesQuery(record, query)).map(clone),
  countDocuments: async (query = {}) => records.filter((record) => matchesQuery(record, query)).length
});

const createService = () =>
  createBookingAccountingService({
    BookingModel: createModel([
      {
        _id: "booking-1",
        bookingReference: "ZNZ-BA-1",
        productTitle: "Stone Town Tour",
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
    ])
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

test("booking accounting cost template endpoint is explicit when no template model exists", async () => {
  const service = createService();

  const result = await service.getCostTemplates();

  assert.equal(result.configured, false);
  assert.ok(result.costBasisTypes.includes("per_participant"));
  assert.ok(result.controlledExpenseCategories.includes("OTHER_OPERATING_EXPENSE"));
});
