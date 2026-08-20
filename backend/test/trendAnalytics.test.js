process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/trend-analytics-test";
process.env.JWT_SECRET ||= "trend-analytics-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ACCOUNTING_SCOPE,
  BUSINESS_UNIT,
  FINANCIAL_ENTRY_STATUS,
  POSTING_DIRECTION,
  POSTING_TYPE,
  SOURCE_MODULE
} = require("../src/accounting/constants");
const {
  ANALYTICS_COMPARE_MODE,
  ANALYTICS_DATE_DIMENSION,
  ANALYTICS_GRANULARITY,
  ANALYTICS_PERIOD
} = require("../src/analytics/constants");
const {
  createTrendAnalyticsService
} = require("../src/analytics/trendAnalyticsService");

const clone = (value) => JSON.parse(JSON.stringify(value));

const getPath = (row, path) =>
  path.split(".").reduce((value, key) => (value === undefined || value === null ? undefined : value[key]), row);

const matches = (row, query = {}) =>
  Object.entries(query).every(([key, expected]) => {
    const actual = getPath(row, key);
    if (expected && typeof expected === "object" && expected.$in) return expected.$in.includes(actual);
    if (expected && typeof expected === "object" && (expected.$gte || expected.$lt)) {
      const actualDate = new Date(actual);
      if (expected.$gte && actualDate < expected.$gte) return false;
      if (expected.$lt && actualDate >= expected.$lt) return false;
      return true;
    }
    return String(actual || "") === String(expected || "");
  });

const booking = ({
  bookingReference,
  bookingStatus = "confirmed",
  salesChannel = "DIRECT_WEBSITE",
  bokunProductId = "PROD-1",
  productTitle = "Stone Town Tour",
  amount = 100,
  participants = 2,
  bokunCreatedAt,
  travelDate
}) => ({
  bookingReference,
  bokunBookingId: `BOK-${bookingReference}`,
  bookingStatus,
  salesChannel,
  bokunProductId,
  productTitle,
  optionTitle: "Standard",
  paxSummary: { total: participants },
  pricingSnapshot: {
    finalPayable: amount,
    currency: "USD"
  },
  amount,
  currency: "USD",
  createdAt: bokunCreatedAt,
  travelDate: travelDate?.slice(0, 10) || "",
  bokunOperationalDates: {
    bookingCreatedAtBokun: {
      normalizedAt: bokunCreatedAt,
      localDate: bokunCreatedAt ? bokunCreatedAt.slice(0, 10) : ""
    },
    travelDate: {
      normalizedAt: travelDate,
      localDate: travelDate ? travelDate.slice(0, 10) : ""
    }
  }
});

const bookingPosting = ({
  bookingReference,
  transactionDate,
  bookedRevenue,
  collectedRevenue,
  refunds = 0,
  providerFees = 0,
  channelCommission = 0,
  directCosts = 0,
  netContribution,
  businessUnit = BUSINESS_UNIT.TOURS,
  directBookingCostsIncluded = true
}) => ({
  accountingScope: ACCOUNTING_SCOPE.BUSINESS,
  sourceModule: SOURCE_MODULE.BOOKING_ACCOUNTING,
  sourceReference: bookingReference,
  bookingReference,
  postingType: POSTING_TYPE.BOOKING_NET_CONTRIBUTION,
  direction: POSTING_DIRECTION.INCOME,
  businessUnit,
  status: FINANCIAL_ENTRY_STATUS.APPROVED,
  amount: String(netContribution),
  baseCurrencyAmount: String(netContribution),
  currency: "USD",
  baseCurrency: "USD",
  transactionDate,
  components: {
    bookedRevenue: String(bookedRevenue),
    invoicedRevenue: String(bookedRevenue),
    collectedRevenue: String(collectedRevenue),
    refundedAmount: String(refunds),
    providerFees: String(providerFees),
    channelCommission: String(channelCommission),
    directBookingCosts: String(directCosts),
    bookingNetContribution: String(netContribution),
    otherBusinessIncome: "0",
    operatingExpenses: "0",
    payrollExpenses: "0",
    otherExpenses: "0"
  },
  metadata: { directBookingCostsIncluded }
});

const otherIncomePosting = ({ transactionDate, amount }) => ({
  accountingScope: ACCOUNTING_SCOPE.BUSINESS,
  sourceModule: SOURCE_MODULE.BUSINESS_ACCOUNTING,
  sourceReference: `OTHER-${transactionDate}`,
  postingType: POSTING_TYPE.OTHER_BUSINESS_INCOME,
  direction: POSTING_DIRECTION.INCOME,
  businessUnit: BUSINESS_UNIT.OTHER,
  status: FINANCIAL_ENTRY_STATUS.APPROVED,
  amount: String(amount),
  baseCurrencyAmount: String(amount),
  currency: "USD",
  baseCurrency: "USD",
  transactionDate,
  components: {
    otherBusinessIncome: String(amount)
  }
});

const expensePosting = ({ transactionDate, amount, businessUnit = BUSINESS_UNIT.GENERAL_COMPANY }) => ({
  accountingScope: ACCOUNTING_SCOPE.BUSINESS,
  sourceModule: SOURCE_MODULE.BUSINESS_ACCOUNTING,
  sourceReference: `EXPENSE-${transactionDate}`,
  postingType: POSTING_TYPE.OPERATING_EXPENSE,
  direction: POSTING_DIRECTION.EXPENSE,
  businessUnit,
  status: FINANCIAL_ENTRY_STATUS.APPROVED,
  amount: String(amount),
  baseCurrencyAmount: String(amount),
  currency: "USD",
  baseCurrency: "USD",
  transactionDate,
  components: {
    operatingExpenses: String(amount)
  }
});

const sampleBookings = () => [
  booking({
    bookingReference: "TR-DIRECT-1",
    salesChannel: "DIRECT_WEBSITE",
    bokunProductId: "PROD-DIRECT",
    productTitle: "Stone Town",
    amount: 100,
    participants: 2,
    bokunCreatedAt: "2026-08-05T08:00:00.000Z",
    travelDate: "2026-09-05T00:00:00.000Z"
  }),
  booking({
    bookingReference: "TR-VIATOR-1",
    salesChannel: "VIATOR",
    bokunProductId: "PROD-VIATOR",
    productTitle: "Safari Blue",
    amount: 500,
    participants: 3,
    bokunCreatedAt: "2026-08-20T08:00:00.000Z",
    travelDate: "2026-08-25T00:00:00.000Z"
  }),
  booking({
    bookingReference: "TR-GYG-CANCEL",
    bookingStatus: "cancelled",
    salesChannel: "GETYOURGUIDE",
    bokunProductId: "PROD-GYG",
    productTitle: "Prison Island",
    amount: 300,
    participants: 2,
    bokunCreatedAt: "2026-08-22T08:00:00.000Z",
    travelDate: "2026-08-28T00:00:00.000Z"
  }),
  booking({
    bookingReference: "TR-OTHER-1",
    salesChannel: "OTHER",
    bokunProductId: "PROD-OTHER",
    productTitle: "Unknown Source",
    amount: 80,
    participants: 0,
    bokunCreatedAt: "2026-08-23T08:00:00.000Z",
    travelDate: "2026-08-29T00:00:00.000Z"
  }),
  booking({
    bookingReference: "TR-VIATOR-OLD",
    salesChannel: "VIATOR",
    bokunProductId: "PROD-VIATOR",
    productTitle: "Safari Blue",
    amount: 200,
    participants: 2,
    bokunCreatedAt: "2026-07-10T08:00:00.000Z",
    travelDate: "2026-07-24T00:00:00.000Z"
  }),
  booking({
    bookingReference: "TR-2025",
    salesChannel: "DIRECT_WEBSITE",
    bokunProductId: "PROD-DIRECT",
    productTitle: "Stone Town",
    amount: 50,
    participants: 1,
    bokunCreatedAt: "2025-08-10T08:00:00.000Z",
    travelDate: "2025-08-20T00:00:00.000Z"
  })
];

const samplePostings = () => [
  bookingPosting({
    bookingReference: "TR-DIRECT-1",
    transactionDate: "2026-08-06T09:00:00.000Z",
    bookedRevenue: 100,
    collectedRevenue: 90,
    providerFees: 5,
    directCosts: 30,
    netContribution: 55,
    businessUnit: BUSINESS_UNIT.UNALLOCATED,
    directBookingCostsIncluded: false
  }),
  bookingPosting({
    bookingReference: "TR-VIATOR-1",
    transactionDate: "2026-08-21T09:00:00.000Z",
    bookedRevenue: 500,
    collectedRevenue: 500,
    refunds: 50,
    providerFees: 10,
    channelCommission: 120,
    directCosts: 100,
    netContribution: 220
  }),
  otherIncomePosting({
    transactionDate: "2026-08-15T09:00:00.000Z",
    amount: 40
  }),
  expensePosting({
    transactionDate: "2026-08-28T09:00:00.000Z",
    amount: 60
  }),
  bookingPosting({
    bookingReference: "TR-VIATOR-OLD",
    transactionDate: "2026-07-15T09:00:00.000Z",
    bookedRevenue: 200,
    collectedRevenue: 200,
    providerFees: 10,
    channelCommission: 40,
    directCosts: 50,
    netContribution: 100
  }),
  bookingPosting({
    bookingReference: "TR-2025",
    transactionDate: "2025-08-15T09:00:00.000Z",
    bookedRevenue: 50,
    collectedRevenue: 50,
    directCosts: 20,
    netContribution: 30
  })
];

const createHarness = ({ bookings = sampleBookings(), postings = samplePostings() } = {}) => {
  const state = {
    bookings: clone(bookings),
    postings: clone(postings)
  };
  const BookingModel = {
    find: async (query) => state.bookings.filter((row) => matches(row, query)).map(clone)
  };
  const AccountingPostingModel = {
    find: async (query) => state.postings.filter((row) => matches(row, query)).map(clone)
  };
  const service = createTrendAnalyticsService({
    AccountingPostingModel,
    BookingModel,
    now: () => new Date("2026-08-15T10:30:00.000Z")
  });

  return { service, state };
};

test("trend analytics separates operational booking trend from financial accounting trend", async () => {
  const harness = createHarness();

  const result = await harness.service.getTrendAnalytics({
    period: ANALYTICS_PERIOD.THIS_MONTH,
    compare: ANALYTICS_COMPARE_MODE.PREVIOUS_PERIOD,
    granularity: ANALYTICS_GRANULARITY.MONTH
  });

  assert.equal(result.report, "TREND_ANALYTICS");
  assert.equal(result.dateDimensions.operational.key, ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE);
  assert.equal(result.dateDimensions.financial.key, ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE);
  assert.equal(result.totals.operational.confirmedBookings, 3);
  assert.equal(result.totals.operational.cancelledBookings, 1);
  assert.equal(result.totals.operational.bookedRevenue, 680);
  assert.equal(result.totals.financial.collectedRevenue, 590);
  assert.equal(result.totals.financial.refundedAmount, 50);
  assert.equal(result.totals.financial.operatingExpenses, 60);
  assert.equal(result.totals.financial.netProfit, 255);
  assert.equal(result.kpis.bookingGrowth.percentageChange, 200);
  assert.equal(result.kpis.bookedRevenueGrowth.percentageChange, 240);
  assert.equal(result.kpis.netProfitGrowth.percentageChange, 155);
  assert.equal(result.trends.combined[0].bucket, "2026-08");
});

test("trend analytics uses the selected operational date dimension without changing financial date truth", async () => {
  const harness = createHarness();

  const result = await harness.service.getTrendAnalytics({
    period: ANALYTICS_PERIOD.THIS_MONTH,
    operationalDateDimension: ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE
  });

  assert.equal(result.totals.operational.confirmedBookings, 2);
  assert.equal(result.totals.operational.bookedRevenue, 580);
  assert.equal(result.totals.financial.netProfit, 255);
  assert.equal(result.dateDimensions.operational.key, ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE);
});

test("trend analytics scopes channel filters to booking contribution postings only", async () => {
  const harness = createHarness();

  const result = await harness.service.getTrendAnalytics({
    period: ANALYTICS_PERIOD.THIS_MONTH,
    channel: "VIATOR"
  });
  const warningCodes = result.dataQuality.warnings.map((warning) => warning.code);

  assert.equal(result.filters.channel, "VIATOR");
  assert.equal(result.totals.operational.confirmedBookings, 1);
  assert.equal(result.totals.financial.bookedRevenue, 500);
  assert.equal(result.totals.financial.channelCommission, 120);
  assert.equal(result.totals.financial.operatingExpenses, 0);
  assert.equal(result.totals.financial.netProfit, 220);
  assert.equal(result.dataQuality.scopedFinancials, true);
  assert.ok(warningCodes.includes("SCOPED_FINANCIALS_EXCLUDE_UNALLOCATED_COMPANY_POSTINGS"));
});

test("trend analytics reports data-quality warnings for incomplete trend evidence", async () => {
  const harness = createHarness();

  const result = await harness.service.getTrendAnalytics({
    period: ANALYTICS_PERIOD.THIS_MONTH
  });
  const warningCodes = result.dataQuality.warnings.map((warning) => warning.code);

  assert.ok(warningCodes.includes("DIRECT_BOOKING_COSTS_INCOMPLETE"));
  assert.ok(warningCodes.includes("UNALLOCATED_BUSINESS_UNITS"));
  assert.ok(warningCodes.includes("UNKNOWN_SALES_CHANNELS"));
  assert.ok(warningCodes.includes("MISSING_PARTICIPANT_COUNTS"));
  assert.equal(result.dataQuality.missingCostRecords, 1);
  assert.equal(result.dataQuality.unallocatedBusinessUnits, 1);
});

test("trend analytics supports multi-year reporting with yearly buckets", async () => {
  const harness = createHarness();

  const result = await harness.service.getTrendAnalytics({
    period: ANALYTICS_PERIOD.MULTI_YEAR,
    from: "2025-01-01",
    to: "2026-12-31",
    granularity: ANALYTICS_GRANULARITY.YEAR,
    compare: ANALYTICS_COMPARE_MODE.NONE
  });

  assert.deepEqual(result.trends.operational.map((row) => row.bucket), ["2025", "2026"]);
  assert.deepEqual(result.trends.financial.map((row) => row.bucket), ["2025", "2026"]);
  assert.equal(result.totals.operational.confirmedBookings, 5);
  assert.equal(result.totals.financial.netProfit, 385);
});

test("trend analytics rejects unsupported date dimensions for each trend source", async () => {
  const harness = createHarness();

  await assert.rejects(
    () => harness.service.getTrendAnalytics({
      period: ANALYTICS_PERIOD.THIS_MONTH,
      financialDateDimension: ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE
    }),
    (error) => error.code === "ANALYTICS_DATE_DIMENSION_NOT_ALLOWED"
  );
  await assert.rejects(
    () => harness.service.getTrendAnalytics({
      period: ANALYTICS_PERIOD.THIS_MONTH,
      operationalDateDimension: ANALYTICS_DATE_DIMENSION.PAYMENT_DATE
    }),
    (error) => error.code === "ANALYTICS_DATE_DIMENSION_NOT_ALLOWED"
  );
});
