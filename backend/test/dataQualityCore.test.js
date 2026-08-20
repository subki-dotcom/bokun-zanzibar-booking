process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/data-quality-core-test";
process.env.JWT_SECRET ||= "data-quality-core-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const { BUSINESS_UNIT } = require("../src/accounting/constants");
const { SALES_CHANNEL } = require("../src/integrations/bokun/salesChannel.adapter");
const {
  createDataQualityService,
  DATA_QUALITY_ISSUE,
  DATA_QUALITY_SEVERITY,
  __testables
} = require("../src/services/dataQuality");

const fixedNow = new Date("2026-08-16T12:00:00.000Z");
const clone = (value) => JSON.parse(JSON.stringify(value));

const createModel = (records = []) => ({
  find: () => records.map(clone)
});

const createService = (overrides = {}) =>
  createDataQualityService({
    models: {
      BookingModel: createModel([
        {
          _id: "booking-1",
          bookingReference: "ZNZ-DQ-1",
          bookingStatus: "confirmed",
          paymentStatus: "paid",
          operationalSource: "BOKUN",
          salesChannel: SALES_CHANNEL.OTHER,
          rawChannelSource: "Unknown OTA",
          bokunBookingId: "BOKUN-1",
          bokunStatus: { normalized: "confirmed" },
          bokunOperationalDates: {},
          pricingSnapshot: { finalPayable: 100 },
          amount: 100,
          createdAt: "2026-08-15T09:00:00.000Z"
        },
        {
          _id: "booking-2",
          bookingReference: "ZNZ-DQ-2",
          bookingStatus: "confirmed",
          paymentStatus: "paid",
          operationalSource: "BOKUN",
          salesChannel: SALES_CHANNEL.VIATOR,
          bokunBookingId: "BOKUN-1",
          bokunStatus: { normalized: "confirmed" },
          bokunOperationalDates: {
            travelDate: { normalizedAt: "2026-08-20T06:00:00.000Z" }
          },
          pricingSnapshot: { finalPayable: 80 },
          amount: 80,
          createdAt: "2026-08-15T10:00:00.000Z"
        }
      ]),
      InvoiceModel: createModel([
        {
          _id: "invoice-1",
          invoiceNumber: "INV-DQ-1",
          bookingReference: "ZNZ-DQ-1",
          paymentStatus: "paid",
          total: 100,
          amountPaid: 90,
          amountRefunded: 0,
          balanceDue: 20,
          issueDate: "2026-08-15T09:10:00.000Z"
        }
      ]),
      PaymentModel: createModel([
        {
          _id: "payment-1",
          bookingReference: "ZNZ-DQ-1",
          provider: "pesapal",
          status: "paid",
          verificationStatus: "verified",
          providerTransactionId: "TX-1",
          orderTrackingId: "OT-1",
          chargedCurrency: "TZS",
          accountingCurrency: "USD",
          fxRate: null,
          createdAt: "2026-08-15T09:15:00.000Z"
        },
        {
          _id: "payment-2",
          bookingReference: "ZNZ-DQ-1",
          provider: "pesapal",
          status: "paid",
          verificationStatus: "amount_mismatch",
          providerTransactionId: "TX-1",
          orderTrackingId: "OT-1",
          chargedCurrency: "USD",
          accountingCurrency: "USD",
          anomaly: { flagged: true, code: "AMOUNT_MISMATCH" },
          createdAt: "2026-08-15T09:16:00.000Z"
        }
      ]),
      RefundModel: createModel([
        {
          _id: "refund-1",
          refundReference: "REF-DQ-1",
          bookingId: "booking-1",
          provider: "paypal",
          status: "refunded",
          confirmedRefundedAmount: 10,
          createdAt: "2026-08-15T09:20:00.000Z"
        }
      ]),
      BusinessExpenseModel: createModel([
        {
          _id: "expense-1",
          expenseReference: "EXP-DQ-1",
          category: "UNKNOWN",
          businessUnit: BUSINESS_UNIT.UNALLOCATED,
          supplier: {},
          amount: "20",
          currency: "TZS",
          baseCurrency: "USD",
          exchangeRate: null,
          expenseDate: "2026-08-15T09:25:00.000Z"
        }
      ]),
      BusinessIncomeModel: createModel([
        {
          _id: "income-1",
          incomeReference: "INC-DQ-1",
          businessUnit: BUSINESS_UNIT.UNALLOCATED,
          amount: "40",
          currency: "USD",
          baseCurrency: "USD",
          transactionDate: "2026-08-15T09:30:00.000Z"
        }
      ]),
      AccountingPostingModel: createModel([
        {
          _id: "posting-1",
          postingKey: "POST-DQ-1",
          bookingReference: "ZNZ-DQ-1",
          sourceReference: "ZNZ-DQ-1",
          businessUnit: BUSINESS_UNIT.UNALLOCATED,
          amount: "70",
          currency: "USD",
          baseCurrency: "USD",
          components: {},
          createdAt: "2026-08-15T09:35:00.000Z"
        }
      ]),
      ...overrides
    },
    now: () => fixedNow
  });

test("data quality summary detects canonical booking, payment, expense and refund gaps", async () => {
  const service = createService();

  const result = await service.getSummary({ limit: 100 });

  assert.equal(result.generatedAt, "2026-08-16T12:00:00.000Z");
  assert.equal(result.scan.boundedScan, true);
  assert.equal(result.summary.totalRecords, 9);
  assert.equal(result.summary.incompleteRecords, 9);
  assert.equal(result.summary.issueCountsByCode[DATA_QUALITY_ISSUE.MISSING_SALES_CHANNEL], 1);
  assert.equal(result.summary.issueCountsByCode[DATA_QUALITY_ISSUE.MISSING_BOKUN_DATE], 1);
  assert.equal(result.summary.issueCountsByCode[DATA_QUALITY_ISSUE.MISSING_ACTUAL_COST], 2);
  assert.equal(result.summary.issueCountsByCode[DATA_QUALITY_ISSUE.MISSING_INVOICE], 1);
  assert.equal(result.summary.issueCountsByCode[DATA_QUALITY_ISSUE.MISSING_FX], 2);
  assert.equal(result.summary.issueCountsByCode[DATA_QUALITY_ISSUE.DUPLICATE_SUSPICION], 6);
  assert.equal(result.summary.issueCountsByCode[DATA_QUALITY_ISSUE.RECONCILIATION_MISMATCH], 2);
  assert.equal(result.summary.issueCountsByCode[DATA_QUALITY_ISSUE.MISSING_SUPPLIER], 1);
  assert.equal(result.summary.issueCountsByCode[DATA_QUALITY_ISSUE.UNKNOWN_EXPENSE_CATEGORY], 1);
  assert.equal(result.summary.issueCountsByCode[DATA_QUALITY_ISSUE.REFUND_EVIDENCE_MISSING], 1);
  assert.equal(result.summary.severityCounts[DATA_QUALITY_SEVERITY.CRITICAL], 6);
  assert.equal(result.byEntityType.Booking.totalRecords, 2);
  assert.equal(result.byEntityType.Booking.incompleteRecords, 2);
  assert.ok(result.topIssues.some((issue) => issue.code === DATA_QUALITY_ISSUE.DUPLICATE_SUSPICION));
});

test("data quality issue list filters by severity, code and reference", async () => {
  const service = createService();

  const critical = await service.listIssues({
    severity: DATA_QUALITY_SEVERITY.CRITICAL,
    reference: "ZNZ-DQ-1",
    issueLimit: 20
  });
  const missingBokunDate = await service.listIssues({
    code: DATA_QUALITY_ISSUE.MISSING_BOKUN_DATE,
    issueLimit: 20
  });

  assert.equal(critical.items.every((issue) => issue.severity === DATA_QUALITY_SEVERITY.CRITICAL), true);
  assert.equal(critical.items.every((issue) => issue.reference.includes("ZNZ-DQ-1")), true);
  assert.equal(missingBokunDate.items.length, 1);
  assert.equal(missingBokunDate.items[0].entityType, "Booking");
  assert.equal(missingBokunDate.items[0].reference, "ZNZ-DQ-1");
  assert.equal(missingBokunDate.items[0].evidence.travelDate, "");
});

test("data quality helper detects invoice balance and cross-currency FX gaps", () => {
  assert.equal(
    __testables.hasInvoiceBalanceMismatch({
      total: 100,
      amountPaid: 90,
      amountRefunded: 0,
      balanceDue: 10
    }),
    false
  );
  assert.equal(
    __testables.hasInvoiceBalanceMismatch({
      total: 100,
      amountPaid: 90,
      amountRefunded: 0,
      balanceDue: 20
    }),
    true
  );
  assert.equal(
    __testables.hasCrossCurrencyMissingFx({
      currency: "TZS",
      baseCurrency: "USD",
      exchangeRate: null
    }),
    true
  );
  assert.equal(
    __testables.hasCrossCurrencyMissingFx({
      currency: "USD",
      baseCurrency: "USD",
      exchangeRate: null
    }),
    false
  );
});
