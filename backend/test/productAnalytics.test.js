process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/product-analytics-test";
process.env.JWT_SECRET ||= "product-analytics-test-secret";

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
  createProductAnalyticsService,
  PRODUCT_CLASSIFICATION,
  PRODUCT_RANKING
} = require("../src/analytics/productAnalyticsService");

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
  bokunProductId,
  productTitle,
  bookingStatus = "confirmed",
  amount,
  participants,
  salesChannel = "DIRECT_WEBSITE",
  bokunCreatedAt,
  travelDate
}) => ({
  bookingReference,
  bokunBookingId: `BOK-${bookingReference}`,
  bokunProductId,
  productTitle,
  optionTitle: "Standard",
  bookingStatus,
  salesChannel,
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
    bookingReference: "P1-A",
    bokunProductId: "PROD-1",
    productTitle: "High Revenue Low Margin",
    amount: 500,
    participants: 2,
    bokunCreatedAt: "2026-08-05T08:00:00.000Z",
    travelDate: "2026-08-20T00:00:00.000Z"
  }),
  booking({
    bookingReference: "P1-B",
    bokunProductId: "PROD-1",
    productTitle: "High Revenue Low Margin",
    amount: 500,
    participants: 2,
    bokunCreatedAt: "2026-08-06T08:00:00.000Z",
    travelDate: "2026-08-21T00:00:00.000Z"
  }),
  booking({
    bookingReference: "P1-CANCEL",
    bokunProductId: "PROD-1",
    productTitle: "High Revenue Low Margin",
    bookingStatus: "cancelled",
    amount: 500,
    participants: 2,
    bokunCreatedAt: "2026-08-07T08:00:00.000Z",
    travelDate: "2026-08-22T00:00:00.000Z"
  }),
  booking({
    bookingReference: "P2-A",
    bokunProductId: "PROD-2",
    productTitle: "Lower Revenue High Profit",
    amount: 400,
    participants: 3,
    salesChannel: "VIATOR",
    bokunCreatedAt: "2026-08-09T08:00:00.000Z",
    travelDate: "2026-08-23T00:00:00.000Z"
  }),
  booking({
    bookingReference: "P3-A",
    bokunProductId: "PROD-3",
    productTitle: "Loss Maker",
    amount: 200,
    participants: 1,
    salesChannel: "GETYOURGUIDE",
    bokunCreatedAt: "2026-08-10T08:00:00.000Z",
    travelDate: "2026-08-24T00:00:00.000Z"
  }),
  booking({
    bookingReference: "P2-OLD",
    bokunProductId: "PROD-2",
    productTitle: "Lower Revenue High Profit",
    amount: 200,
    participants: 1,
    salesChannel: "VIATOR",
    bokunCreatedAt: "2026-07-10T08:00:00.000Z",
    travelDate: "2026-07-24T00:00:00.000Z"
  })
];

const samplePostings = () => [
  posting({
    bookingReference: "P1-A",
    collectedRevenue: 500,
    providerFees: 20,
    channelCommission: 320,
    directCosts: 100,
    netContribution: 60
  }),
  posting({
    bookingReference: "P1-B",
    collectedRevenue: 500,
    providerFees: 20,
    channelCommission: 320,
    directCosts: 100,
    netContribution: 60
  }),
  posting({
    bookingReference: "P2-A",
    collectedRevenue: 400,
    providerFees: 10,
    directCosts: 50,
    netContribution: 340
  }),
  posting({
    bookingReference: "P3-A",
    collectedRevenue: 200,
    refunds: 150,
    providerFees: 5,
    channelCommission: 20,
    directCosts: 100,
    netContribution: -75
  }),
  posting({
    bookingReference: "P2-OLD",
    collectedRevenue: 200,
    directCosts: 100,
    netContribution: 100
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
  const service = createProductAnalyticsService({
    AccountingPostingModel,
    BookingModel,
    now: () => new Date("2026-08-15T10:30:00.000Z")
  });

  return { service, state };
};

test("product analytics ranks high revenue separately from high profit and high margin", async () => {
  const harness = createHarness();

  const result = await harness.service.getProductAnalytics({
    period: ANALYTICS_PERIOD.THIS_MONTH,
    compare: ANALYTICS_COMPARE_MODE.PREVIOUS_PERIOD
  });

  assert.equal(result.totals.productsCount, 3);
  assert.equal(result.totals.confirmedBookings, 4);
  assert.equal(result.totals.bookedRevenue, 1600);
  assert.equal(result.totals.netContribution, 385);
  assert.equal(result.rankings[PRODUCT_RANKING.HIGHEST_REVENUE][0].productId, "PROD-1");
  assert.equal(result.rankings[PRODUCT_RANKING.HIGHEST_NET_PROFIT][0].productId, "PROD-2");
  assert.equal(result.rankings[PRODUCT_RANKING.HIGHEST_MARGIN][0].productId, "PROD-2");
  assert.equal(result.rankings[PRODUCT_RANKING.LOSS_MAKING][0].productId, "PROD-3");
});

test("product performance matrix distinguishes margin problems from growth opportunities", async () => {
  const harness = createHarness();

  const result = await harness.service.getProductAnalytics({
    period: ANALYTICS_PERIOD.THIS_MONTH
  });
  const productOne = result.products.find((product) => product.productId === "PROD-1");
  const productTwo = result.products.find((product) => product.productId === "PROD-2");

  assert.equal(productOne.classification.code, PRODUCT_CLASSIFICATION.MARGIN_PROBLEM);
  assert.equal(productOne.profitMargin, 12);
  assert.equal(productTwo.classification.code, PRODUCT_CLASSIFICATION.GROWTH_OPPORTUNITY);
  assert.equal(productTwo.profitMargin, 85);
});

test("product analytics calculates refund and cancellation rates from supported evidence", async () => {
  const harness = createHarness();

  const result = await harness.service.getProductAnalytics({
    period: ANALYTICS_PERIOD.THIS_MONTH
  });
  const productOne = result.products.find((product) => product.productId === "PROD-1");
  const productThree = result.products.find((product) => product.productId === "PROD-3");

  assert.equal(productOne.bookingsCount, 3);
  assert.equal(productOne.cancelledBookings, 1);
  assert.equal(productOne.cancellationRate, 33.3);
  assert.equal(productThree.refunds, 150);
  assert.equal(productThree.refundRate, 75);
});

test("product analytics includes per-product growth from the comparison period", async () => {
  const harness = createHarness();

  const result = await harness.service.getProductAnalytics({
    period: ANALYTICS_PERIOD.THIS_MONTH,
    compare: ANALYTICS_COMPARE_MODE.PREVIOUS_PERIOD
  });
  const productTwo = result.products.find((product) => product.productId === "PROD-2");

  assert.equal(productTwo.growth.revenue.previous, 200);
  assert.equal(productTwo.growth.revenue.current, 400);
  assert.equal(productTwo.growth.revenue.percentageChange, 100);
  assert.equal(productTwo.growth.netContribution.percentageChange, 240);
});

test("product analytics supports product and channel filtering", async () => {
  const harness = createHarness();

  const productResult = await harness.service.getProductAnalytics({
    period: ANALYTICS_PERIOD.THIS_MONTH,
    productId: "PROD-2"
  });
  const channelResult = await harness.service.getProductAnalytics({
    period: ANALYTICS_PERIOD.THIS_MONTH,
    channel: "GETYOURGUIDE"
  });

  assert.equal(productResult.products.length, 1);
  assert.equal(productResult.products[0].productId, "PROD-2");
  assert.equal(productResult.totals.bookedRevenue, 400);
  assert.equal(channelResult.products.length, 1);
  assert.equal(channelResult.products[0].productId, "PROD-3");
});

test("product analytics reports data-quality warnings for missing postings and missing direct costs", async () => {
  const harness = createHarness({
    bookings: [
      ...sampleBookings(),
      booking({
        bookingReference: "P4-A",
        bokunProductId: "PROD-4",
        productTitle: "Missing Accounting",
        amount: 100,
        participants: 1,
        bokunCreatedAt: "2026-08-11T08:00:00.000Z",
        travelDate: "2026-08-25T00:00:00.000Z"
      })
    ],
    postings: samplePostings().map((row) =>
      row.sourceReference === "P2-A"
        ? {
            ...row,
            components: {
              ...row.components,
              directBookingCosts: "0",
              bookingNetContribution: "390"
            },
            metadata: { directBookingCostsIncluded: false }
          }
        : row
    )
  });

  const result = await harness.service.getProductAnalytics({
    period: ANALYTICS_PERIOD.THIS_MONTH
  });
  const warningCodes = result.dataQuality.warnings.map((warning) => warning.code);

  assert.ok(warningCodes.includes("MISSING_BOOKING_ACCOUNTING_POSTINGS"));
  assert.ok(warningCodes.includes("DIRECT_PRODUCT_COSTS_INCOMPLETE"));
  assert.equal(result.dataQuality.missingAccountingPostings, 1);
  assert.equal(result.dataQuality.missingCostRecords, 1);
});

test("product analytics rejects financial date dimensions for product reporting", async () => {
  const harness = createHarness();

  await assert.rejects(
    () => harness.service.getProductAnalytics({
      period: ANALYTICS_PERIOD.THIS_MONTH,
      dateDimension: ANALYTICS_DATE_DIMENSION.PAYMENT_DATE
    }),
    (error) => error.code === "ANALYTICS_DATE_DIMENSION_NOT_ALLOWED"
  );
});
