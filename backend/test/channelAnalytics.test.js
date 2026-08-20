process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/channel-analytics-test";
process.env.JWT_SECRET ||= "channel-analytics-test-secret";

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
  ANALYTICS_PERIOD
} = require("../src/analytics/constants");
const {
  CHANNEL_CLASSIFICATION,
  CHANNEL_RANKING,
  createChannelAnalyticsService
} = require("../src/analytics/channelAnalyticsService");

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

const posting = ({
  bookingReference,
  collectedRevenue,
  refunds = 0,
  providerFees = 0,
  channelCommission = 0,
  directCosts = 0,
  netContribution,
  status = FINANCIAL_ENTRY_STATUS.APPROVED,
  directBookingCostsIncluded = true
}) => ({
  accountingScope: ACCOUNTING_SCOPE.BUSINESS,
  sourceModule: SOURCE_MODULE.BOOKING_ACCOUNTING,
  sourceReference: bookingReference,
  postingType: POSTING_TYPE.BOOKING_NET_CONTRIBUTION,
  status,
  amount: String(netContribution),
  baseCurrencyAmount: String(netContribution),
  currency: "USD",
  baseCurrency: "USD",
  transactionDate: "2026-08-10T09:00:00.000Z",
  components: {
    bookedRevenue: "0",
    invoicedRevenue: "0",
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

const sampleBookings = () => [
  booking({
    bookingReference: "CH-DIRECT-1",
    salesChannel: "DIRECT_WEBSITE",
    bokunProductId: "PROD-DIRECT",
    productTitle: "Private Safari Blue",
    amount: 1000,
    participants: 4,
    bokunCreatedAt: "2026-08-05T08:00:00.000Z",
    travelDate: "2026-08-20T00:00:00.000Z"
  }),
  booking({
    bookingReference: "CH-DIRECT-CANCEL",
    bookingStatus: "cancelled",
    salesChannel: "DIRECT_WEBSITE",
    bokunProductId: "PROD-DIRECT",
    productTitle: "Private Safari Blue",
    amount: 1000,
    participants: 4,
    bokunCreatedAt: "2026-08-06T08:00:00.000Z",
    travelDate: "2026-08-21T00:00:00.000Z"
  }),
  booking({
    bookingReference: "CH-VIATOR-1",
    salesChannel: "VIATOR",
    bokunProductId: "PROD-VIATOR",
    productTitle: "Mnemba Shared Tour",
    amount: 600,
    participants: 3,
    bokunCreatedAt: "2026-08-07T08:00:00.000Z",
    travelDate: "2026-08-22T00:00:00.000Z"
  }),
  booking({
    bookingReference: "CH-GYG-1",
    salesChannel: "GETYOURGUIDE",
    bokunProductId: "PROD-GYG",
    productTitle: "Prison Island",
    amount: 300,
    participants: 2,
    bokunCreatedAt: "2026-08-08T08:00:00.000Z",
    travelDate: "2026-08-23T00:00:00.000Z"
  }),
  booking({
    bookingReference: "CH-OTHER-1",
    salesChannel: "OTHER",
    bokunProductId: "PROD-OTHER",
    productTitle: "Unknown Channel Booking",
    amount: 80,
    participants: 1,
    bokunCreatedAt: "2026-08-09T08:00:00.000Z",
    travelDate: "2026-08-24T00:00:00.000Z"
  }),
  booking({
    bookingReference: "CH-VIATOR-OLD",
    salesChannel: "VIATOR",
    bokunProductId: "PROD-VIATOR",
    productTitle: "Mnemba Shared Tour",
    amount: 300,
    participants: 2,
    bokunCreatedAt: "2026-07-10T08:00:00.000Z",
    travelDate: "2026-07-24T00:00:00.000Z"
  })
];

const samplePostings = () => [
  posting({
    bookingReference: "CH-DIRECT-1",
    collectedRevenue: 1000,
    providerFees: 50,
    directCosts: 850,
    netContribution: 100
  }),
  posting({
    bookingReference: "CH-VIATOR-1",
    collectedRevenue: 600,
    providerFees: 20,
    channelCommission: 120,
    directCosts: 100,
    netContribution: 360
  }),
  posting({
    bookingReference: "CH-GYG-1",
    collectedRevenue: 300,
    refunds: 100,
    providerFees: 10,
    channelCommission: 60,
    directCosts: 80,
    netContribution: 50,
    directBookingCostsIncluded: false
  }),
  posting({
    bookingReference: "CH-VIATOR-OLD",
    collectedRevenue: 300,
    providerFees: 10,
    channelCommission: 60,
    directCosts: 80,
    netContribution: 150
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
  const service = createChannelAnalyticsService({
    AccountingPostingModel,
    BookingModel,
    now: () => new Date("2026-08-15T10:30:00.000Z")
  });

  return { service, state };
};

test("channel analytics ranks highest sales separately from highest net profit", async () => {
  const harness = createHarness();

  const result = await harness.service.getChannelAnalytics({
    period: ANALYTICS_PERIOD.THIS_MONTH,
    compare: ANALYTICS_COMPARE_MODE.PREVIOUS_PERIOD
  });

  assert.equal(result.report, "CHANNEL_ANALYTICS");
  assert.equal(result.totals.channelsCount, 4);
  assert.equal(result.totals.confirmedBookings, 4);
  assert.equal(result.totals.bookedRevenue, 1980);
  assert.equal(result.totals.netProfit, 510);
  assert.equal(result.rankings[CHANNEL_RANKING.HIGHEST_BOOKED_REVENUE][0].channel, "DIRECT_WEBSITE");
  assert.equal(result.rankings[CHANNEL_RANKING.HIGHEST_NET_PROFIT][0].channel, "VIATOR");
  assert.equal(result.answers.highestSalesChannel.channel, "DIRECT_WEBSITE");
  assert.equal(result.answers.mostNetProfitableChannel.channel, "VIATOR");
});

test("channel analytics applies refunds, commission, fees and costs before net profit", async () => {
  const harness = createHarness();

  const result = await harness.service.getChannelAnalytics({
    period: ANALYTICS_PERIOD.THIS_MONTH
  });
  const direct = result.channels.find((row) => row.channel === "DIRECT_WEBSITE");
  const viator = result.channels.find((row) => row.channel === "VIATOR");
  const getYourGuide = result.channels.find((row) => row.channel === "GETYOURGUIDE");

  assert.equal(direct.bookedRevenue, 1000);
  assert.equal(direct.netProfit, 100);
  assert.equal(direct.classification.code, CHANNEL_CLASSIFICATION.HIGH_VOLUME_LOW_MARGIN);
  assert.equal(viator.bookedRevenue, 600);
  assert.equal(viator.channelCommission, 120);
  assert.equal(viator.netProfit, 360);
  assert.equal(getYourGuide.refunds, 100);
  assert.equal(getYourGuide.refundRate, 33.3);
  assert.equal(getYourGuide.netProfit, 50);
});

test("channel analytics includes per-channel growth from the comparison period", async () => {
  const harness = createHarness();

  const result = await harness.service.getChannelAnalytics({
    period: ANALYTICS_PERIOD.THIS_MONTH,
    compare: ANALYTICS_COMPARE_MODE.PREVIOUS_PERIOD
  });
  const viator = result.channels.find((row) => row.channel === "VIATOR");

  assert.equal(viator.growth.bookedRevenue.previous, 300);
  assert.equal(viator.growth.bookedRevenue.current, 600);
  assert.equal(viator.growth.bookedRevenue.percentageChange, 100);
  assert.equal(viator.growth.netProfit.previous, 150);
  assert.equal(viator.growth.netProfit.current, 360);
  assert.equal(viator.growth.netProfit.percentageChange, 140);
});

test("channel analytics supports channel and product filtering", async () => {
  const harness = createHarness();

  const channelResult = await harness.service.getChannelAnalytics({
    period: ANALYTICS_PERIOD.THIS_MONTH,
    channel: "DIRECT_WEBSITE"
  });
  const productResult = await harness.service.getChannelAnalytics({
    period: ANALYTICS_PERIOD.THIS_MONTH,
    productId: "PROD-VIATOR"
  });

  assert.equal(channelResult.filters.channel, "DIRECT_WEBSITE");
  assert.equal(channelResult.channels.length, 1);
  assert.equal(channelResult.channels[0].bookingsCount, 2);
  assert.equal(channelResult.channels[0].cancelledBookings, 1);
  assert.equal(productResult.filters.productId, "PROD-VIATOR");
  assert.equal(productResult.channels.length, 1);
  assert.equal(productResult.channels[0].channel, "VIATOR");
});

test("channel analytics reports data-quality warnings for unknown channels and incomplete accounting", async () => {
  const harness = createHarness();

  const result = await harness.service.getChannelAnalytics({
    period: ANALYTICS_PERIOD.THIS_MONTH
  });
  const warningCodes = result.dataQuality.warnings.map((warning) => warning.code);

  assert.ok(warningCodes.includes("MISSING_BOOKING_ACCOUNTING_POSTINGS"));
  assert.ok(warningCodes.includes("DIRECT_CHANNEL_COSTS_INCOMPLETE"));
  assert.ok(warningCodes.includes("UNKNOWN_SALES_CHANNELS"));
  assert.equal(result.dataQuality.missingAccountingPostings, 1);
  assert.equal(result.dataQuality.missingCostRecords, 1);
  assert.equal(result.dataQuality.unknownChannels, 1);
});

test("channel analytics rejects financial date dimensions for channel reporting", async () => {
  const harness = createHarness();

  await assert.rejects(
    () => harness.service.getChannelAnalytics({
      period: ANALYTICS_PERIOD.THIS_MONTH,
      dateDimension: ANALYTICS_DATE_DIMENSION.PAYMENT_DATE
    }),
    (error) => error.code === "ANALYTICS_DATE_DIMENSION_NOT_ALLOWED"
  );
});
