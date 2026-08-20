process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/executive-analytics-test";
process.env.JWT_SECRET ||= "executive-analytics-test-secret";

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
  ANALYTICS_PERIOD
} = require("../src/analytics/constants");
const {
  createExecutiveAnalyticsService
} = require("../src/analytics/executiveAnalyticsService");

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

const posting = ({
  postingType,
  transactionDate,
  status = FINANCIAL_ENTRY_STATUS.APPROVED,
  businessUnit = BUSINESS_UNIT.TOURS,
  amount = "0",
  components = {},
  metadata = {}
}) => ({
  accountingScope: ACCOUNTING_SCOPE.BUSINESS,
  sourceModule: SOURCE_MODULE.BUSINESS_ACCOUNTING,
  sourceReference: `${postingType}-${transactionDate}`,
  postingType,
  direction: postingType === POSTING_TYPE.OPERATING_EXPENSE ? POSTING_DIRECTION.EXPENSE : POSTING_DIRECTION.INCOME,
  businessUnit,
  amount,
  baseCurrencyAmount: amount,
  currency: "USD",
  baseCurrency: "USD",
  transactionDate,
  status,
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
    operatingExpenses: "0",
    payrollExpenses: "0",
    otherExpenses: "0",
    ...components
  },
  metadata
});

const createHarness = ({ postings = [], bookings = [] } = {}) => {
  const state = {
    postings: clone(postings),
    bookings: clone(bookings)
  };

  const AccountingPostingModel = {
    find: async (query) => state.postings.filter((row) => matches(row, query)).map(clone)
  };

  const BookingModel = {
    find: async (query) => state.bookings.filter((row) => matches(row, query)).map(clone)
  };

  const service = createExecutiveAnalyticsService({
    AccountingPostingModel,
    BookingModel,
    now: () => new Date("2026-08-15T10:30:00.000Z")
  });

  return { service, state };
};

const samplePostings = () => [
  posting({
    postingType: POSTING_TYPE.BOOKING_NET_CONTRIBUTION,
    transactionDate: "2026-08-08T09:00:00.000Z",
    amount: "100",
    components: {
      bookedRevenue: "200",
      invoicedRevenue: "200",
      collectedRevenue: "180",
      refundedAmount: "20",
      providerFees: "5",
      channelCommission: "30",
      directBookingCosts: "25",
      bookingNetContribution: "100"
    },
    metadata: { directBookingCostsIncluded: true }
  }),
  posting({
    postingType: POSTING_TYPE.OTHER_BUSINESS_INCOME,
    transactionDate: "2026-08-10T09:00:00.000Z",
    amount: "50",
    components: { otherBusinessIncome: "50" }
  }),
  posting({
    postingType: POSTING_TYPE.OPERATING_EXPENSE,
    transactionDate: "2026-08-11T09:00:00.000Z",
    amount: "40",
    components: { operatingExpenses: "40" }
  }),
  posting({
    postingType: POSTING_TYPE.BOOKING_NET_CONTRIBUTION,
    transactionDate: "2026-08-12T09:00:00.000Z",
    status: FINANCIAL_ENTRY_STATUS.DRAFT,
    amount: "999",
    components: { bookedRevenue: "999", bookingNetContribution: "999" }
  }),
  posting({
    postingType: POSTING_TYPE.OPERATING_EXPENSE,
    transactionDate: "2026-08-13T09:00:00.000Z",
    status: FINANCIAL_ENTRY_STATUS.VOID,
    amount: "999",
    components: { operatingExpenses: "999" }
  })
];

const sampleBookings = () => [
  {
    bookingReference: "ZNZ-EX-1",
    bokunBookingId: "BOK-1",
    productTitle: "Stone Town Tour",
    salesChannel: "DIRECT_WEBSITE",
    bookingStatus: "confirmed",
    paxSummary: { total: 3 },
    travelDate: "2026-08-20",
    bokunOperationalDates: {
      travelDate: {
        normalizedAt: "2026-08-20T00:00:00.000Z",
        localDate: "2026-08-20"
      },
      bookingCreatedAtBokun: {
        normalizedAt: "2026-08-01T08:00:00.000Z"
      }
    }
  },
  {
    bookingReference: "ZNZ-EX-2",
    bokunBookingId: "BOK-2",
    productTitle: "Safari Blue",
    salesChannel: "OTHER",
    bookingStatus: "confirmed",
    paxSummary: { total: 0 },
    travelDate: "2026-08-21",
    bokunOperationalDates: {
      travelDate: {
        normalizedAt: "2026-08-21T00:00:00.000Z",
        localDate: "2026-08-21"
      },
      bookingCreatedAtBokun: {
        normalizedAt: "2026-08-02T08:00:00.000Z"
      }
    }
  },
  {
    bookingReference: "ZNZ-EX-OLD",
    salesChannel: "VIATOR",
    bookingStatus: "confirmed",
    paxSummary: { total: 9 },
    bokunOperationalDates: {
      travelDate: {
        normalizedAt: "2026-07-21T00:00:00.000Z"
      }
    }
  }
];

test("executive analytics calculates financial KPIs from counted AccountingPosting rows only", async () => {
  const harness = createHarness({
    postings: samplePostings(),
    bookings: sampleBookings()
  });

  const result = await harness.service.getExecutiveDashboard({
    period: ANALYTICS_PERIOD.THIS_MONTH,
    compare: ANALYTICS_COMPARE_MODE.PREVIOUS_PERIOD
  });

  assert.equal(result.sourceOfTruth.financial, "Business Accounting / AccountingPosting");
  assert.equal(result.kpis.revenue.value, 250);
  assert.equal(result.kpis.collectedRevenue.value, 180);
  assert.equal(result.kpis.refundedAmount.value, 20);
  assert.equal(result.kpis.operatingExpenses.value, 40);
  assert.equal(result.kpis.grossProfit.value, 150);
  assert.equal(result.kpis.netProfit.value, 110);
  assert.equal(result.kpis.profitMargin.value, 44);
  assert.equal(result.financialBreakdown.postingCount, 3);
  assert.equal(result.kpis.totalConfirmedBookings.value, 2);
  assert.equal(result.kpis.totalParticipants.value, 3);
});

test("executive comparison handles zero previous period without infinity", async () => {
  const harness = createHarness({
    postings: samplePostings(),
    bookings: sampleBookings()
  });

  const result = await harness.service.getExecutiveDashboard({
    period: ANALYTICS_PERIOD.THIS_MONTH,
    compare: ANALYTICS_COMPARE_MODE.PREVIOUS_PERIOD
  });

  assert.equal(result.kpis.revenue.comparison.previous, 0);
  assert.equal(result.kpis.revenue.comparison.percentageChange, null);
  assert.equal(result.kpis.revenue.comparison.reason, "ZERO_PREVIOUS_VALUE");
});

test("executive analytics exposes explicit financial and operational date dimensions", async () => {
  const harness = createHarness({
    postings: samplePostings(),
    bookings: sampleBookings()
  });

  const result = await harness.service.getExecutiveDashboard({
    period: ANALYTICS_PERIOD.THIS_MONTH,
    dateDimension: ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE,
    operationalDateDimension: ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE
  });

  assert.equal(result.dateDimensions.financial.key, ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE);
  assert.equal(result.dateDimensions.operational.key, ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE);
  assert.equal(result.drillDown.accountingPostings.filters.dateDimension, ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE);
  assert.equal(result.drillDown.confirmedBookings.filters.dateDimension, ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE);
});

test("executive analytics does not fabricate unsupported cash, receivable or payable KPIs", async () => {
  const harness = createHarness({
    postings: samplePostings(),
    bookings: sampleBookings()
  });

  const result = await harness.service.getExecutiveDashboard({
    period: ANALYTICS_PERIOD.THIS_MONTH
  });

  assert.equal(result.kpis.cashPosition.value, null);
  assert.equal(result.kpis.cashPosition.supported, false);
  assert.equal(result.kpis.accountsReceivable.reason, "RECEIVABLE_MODEL_NOT_AVAILABLE");
  assert.equal(result.kpis.accountsPayable.reason, "PAYABLE_MODEL_NOT_AVAILABLE");
  assert.ok(result.limitations.some((item) => item.includes("Cash position")));
});

test("executive analytics reports data quality warnings for missing costs and unknown channels", async () => {
  const harness = createHarness({
    postings: [
      ...samplePostings(),
      posting({
        postingType: POSTING_TYPE.BOOKING_NET_CONTRIBUTION,
        transactionDate: "2026-08-14T09:00:00.000Z",
        businessUnit: BUSINESS_UNIT.UNALLOCATED,
        amount: "10",
        components: {
          bookedRevenue: "10",
          collectedRevenue: "10",
          bookingNetContribution: "10"
        },
        metadata: { directBookingCostsIncluded: false }
      })
    ],
    bookings: sampleBookings()
  });

  const result = await harness.service.getExecutiveDashboard({
    period: ANALYTICS_PERIOD.THIS_MONTH
  });
  const warningCodes = result.dataQuality.warnings.map((warning) => warning.code);

  assert.ok(warningCodes.includes("DIRECT_BOOKING_COSTS_INCOMPLETE"));
  assert.ok(warningCodes.includes("UNALLOCATED_BUSINESS_UNITS"));
  assert.ok(warningCodes.includes("UNKNOWN_SALES_CHANNELS"));
  assert.ok(warningCodes.includes("MISSING_PARTICIPANT_COUNTS"));
});

test("executive financial analytics rejects non-accounting date dimensions", async () => {
  const harness = createHarness({
    postings: samplePostings(),
    bookings: sampleBookings()
  });

  await assert.rejects(
    () => harness.service.getExecutiveDashboard({
      period: ANALYTICS_PERIOD.THIS_MONTH,
      dateDimension: ANALYTICS_DATE_DIMENSION.PAYMENT_DATE
    }),
    (error) => error.code === "ANALYTICS_DATE_DIMENSION_NOT_ALLOWED"
  );
});
