process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/sales-analytics-test";
process.env.JWT_SECRET ||= "sales-analytics-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ACCOUNTING_SCOPE,
  FINANCIAL_ENTRY_STATUS,
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
  createSalesAnalyticsService
} = require("../src/analytics/salesAnalyticsService");

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
  travelDate,
  createdAt
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
  createdAt: createdAt || bokunCreatedAt,
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

const posting = ({ bookingReference, collectedRevenue, status = FINANCIAL_ENTRY_STATUS.APPROVED }) => ({
  accountingScope: ACCOUNTING_SCOPE.BUSINESS,
  sourceModule: SOURCE_MODULE.BOOKING_ACCOUNTING,
  sourceReference: bookingReference,
  postingType: POSTING_TYPE.BOOKING_NET_CONTRIBUTION,
  amount: collectedRevenue,
  baseCurrencyAmount: collectedRevenue,
  currency: "USD",
  baseCurrency: "USD",
  status,
  transactionDate: "2026-08-10T09:00:00.000Z",
  components: {
    bookedRevenue: "0",
    invoicedRevenue: "0",
    collectedRevenue: String(collectedRevenue),
    refundedAmount: "0",
    providerFees: "0",
    channelCommission: "0",
    directBookingCosts: "0",
    bookingNetContribution: String(collectedRevenue),
    otherBusinessIncome: "0",
    operatingExpenses: "0",
    payrollExpenses: "0",
    otherExpenses: "0"
  }
});

const sampleBookings = () => [
  booking({
    bookingReference: "ZNZ-SALES-1",
    salesChannel: "DIRECT_WEBSITE",
    amount: 100,
    participants: 2,
    bokunCreatedAt: "2026-08-05T08:00:00.000Z",
    travelDate: "2026-09-12T00:00:00.000Z"
  }),
  booking({
    bookingReference: "ZNZ-SALES-2",
    salesChannel: "VIATOR",
    bokunProductId: "PROD-2",
    productTitle: "Safari Blue",
    amount: 200,
    participants: 4,
    bokunCreatedAt: "2026-08-07T08:00:00.000Z",
    travelDate: "2026-08-20T00:00:00.000Z"
  }),
  booking({
    bookingReference: "ZNZ-SALES-3",
    bookingStatus: "pending",
    salesChannel: "GETYOURGUIDE",
    amount: 300,
    participants: 1,
    bokunCreatedAt: "2026-08-08T08:00:00.000Z",
    travelDate: "2026-08-22T00:00:00.000Z"
  }),
  booking({
    bookingReference: "ZNZ-SALES-4",
    salesChannel: "OTHER",
    amount: 80,
    participants: 0,
    bokunCreatedAt: "2026-08-09T08:00:00.000Z",
    travelDate: "2026-08-25T00:00:00.000Z"
  }),
  booking({
    bookingReference: "ZNZ-SALES-OLD",
    salesChannel: "DIRECT_WEBSITE",
    amount: 50,
    participants: 1,
    bokunCreatedAt: "2026-07-10T08:00:00.000Z",
    travelDate: "2026-07-18T00:00:00.000Z"
  })
];

const samplePostings = () => [
  posting({ bookingReference: "ZNZ-SALES-1", collectedRevenue: 90 }),
  posting({ bookingReference: "ZNZ-SALES-2", collectedRevenue: 150 }),
  posting({ bookingReference: "ZNZ-SALES-OLD", collectedRevenue: 50 }),
  posting({ bookingReference: "ZNZ-SALES-VOID", collectedRevenue: 999, status: FINANCIAL_ENTRY_STATUS.VOID })
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
  const service = createSalesAnalyticsService({
    AccountingPostingModel,
    BookingModel,
    now: () => new Date("2026-08-15T10:30:00.000Z")
  });

  return { service, state };
};

test("sales analytics calculates booking, participant, booked revenue and collected revenue KPIs", async () => {
  const harness = createHarness();

  const result = await harness.service.getSalesAnalytics({
    period: ANALYTICS_PERIOD.THIS_MONTH,
    compare: ANALYTICS_COMPARE_MODE.PREVIOUS_PERIOD,
    dateDimension: ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE,
    granularity: ANALYTICS_GRANULARITY.MONTH
  });

  assert.equal(result.report, "SALES_ANALYTICS");
  assert.equal(result.kpis.totalBookings.value, 4);
  assert.equal(result.kpis.confirmedBookings.value, 3);
  assert.equal(result.kpis.participants.value, 6);
  assert.equal(result.kpis.bookedRevenue.value, 380);
  assert.equal(result.kpis.collectedRevenue.value, 240);
  assert.equal(result.kpis.averageBookingValue.value, 126.67);
  assert.equal(result.kpis.averageParticipantsPerBooking.value, 2);
  assert.equal(result.kpis.confirmedBookings.comparison.previous, 1);
  assert.equal(result.kpis.confirmedBookings.comparison.percentageChange, 200);
  assert.equal(result.charts.bookingsOverTime[0].bucket, "2026-08");
  assert.equal(result.charts.revenueOverTime[0].bookedRevenue, 380);
});

test("sales analytics keeps collected revenue tied to booking accounting postings", async () => {
  const harness = createHarness();

  const result = await harness.service.getSalesAnalytics({
    period: ANALYTICS_PERIOD.THIS_MONTH
  });

  assert.equal(result.sourceOfTruth.collectedRevenue, "Business Accounting / AccountingPosting booking contribution rows");
  assert.equal(result.dataQuality.missingAccountingPostings, 1);
  assert.ok(result.dataQuality.warnings.some((warning) => warning.code === "MISSING_BOOKING_ACCOUNTING_POSTINGS"));
  assert.ok(result.limitations.some((item) => item.includes("Collected revenue")));
});

test("sales analytics supports channel filtering without mixing channels", async () => {
  const harness = createHarness();

  const result = await harness.service.getSalesAnalytics({
    period: ANALYTICS_PERIOD.THIS_MONTH,
    channel: "DIRECT_WEBSITE"
  });

  assert.equal(result.filters.channel, "DIRECT_WEBSITE");
  assert.equal(result.kpis.totalBookings.value, 1);
  assert.equal(result.kpis.confirmedBookings.value, 1);
  assert.equal(result.kpis.bookedRevenue.value, 100);
  assert.equal(result.kpis.collectedRevenue.value, 90);
});

test("sales analytics date dimensions produce different operational slices", async () => {
  const harness = createHarness();

  const createdDate = await harness.service.getSalesAnalytics({
    period: ANALYTICS_PERIOD.THIS_MONTH,
    dateDimension: ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE
  });
  const travelDate = await harness.service.getSalesAnalytics({
    period: ANALYTICS_PERIOD.THIS_MONTH,
    dateDimension: ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE
  });

  assert.equal(createdDate.kpis.confirmedBookings.value, 3);
  assert.equal(travelDate.kpis.confirmedBookings.value, 2);
  assert.equal(travelDate.kpis.bookedRevenue.value, 280);
  assert.equal(travelDate.dateDimension.key, ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE);
});

test("sales analytics product filter narrows the operational data set", async () => {
  const harness = createHarness();

  const result = await harness.service.getSalesAnalytics({
    period: ANALYTICS_PERIOD.THIS_MONTH,
    productId: "PROD-2"
  });

  assert.equal(result.filters.productId, "PROD-2");
  assert.equal(result.kpis.totalBookings.value, 1);
  assert.equal(result.kpis.confirmedBookings.value, 1);
  assert.equal(result.kpis.bookedRevenue.value, 200);
});

test("sales analytics rejects financial date dimensions for sales reporting", async () => {
  const harness = createHarness();

  await assert.rejects(
    () => harness.service.getSalesAnalytics({
      period: ANALYTICS_PERIOD.THIS_MONTH,
      dateDimension: ANALYTICS_DATE_DIMENSION.PAYMENT_DATE
    }),
    (error) => error.code === "ANALYTICS_DATE_DIMENSION_NOT_ALLOWED"
  );
});
