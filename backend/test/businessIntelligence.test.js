process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/bi-test';
process.env.JWT_SECRET ||= 'bi-test-secret';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBusinessIntelligenceService, __testables: { summarize, granularityFor } } = require('../src/analytics/businessIntelligenceService');
const { resolveAnalyticsPeriod } = require('../src/analytics/periods');
const { POSTING_TYPE } = require('../src/accounting/constants');
const grouped = (type, values = {}) => ({ _id: { type }, count: 1, missingCosts: 0, ...values });

test('BI financial totals preserve executive collection basis and count source-linked revenue only once', () => {
  const totals = summarize([
    grouped(POSTING_TYPE.BOOKING_NET_CONTRIBUTION, { bookedRevenue: 1000, collectedRevenue: 800, refundedAmount: 50, providerFees: 20, channelCommission: 30, directBookingCosts: 100, bookingNetContribution: 600 }),
    grouped(POSTING_TYPE.OTHER_BUSINESS_INCOME, { otherBusinessIncome: 200 }),
    grouped(POSTING_TYPE.OPERATING_EXPENSE, { amount: 150 })
  ]);
  assert.equal(totals.revenue, 1200);
  assert.equal(totals.grossProfit, 800);
  assert.equal(totals.netProfit, 650);
  assert.equal(totals.totalCost, 300);
  assert.equal(totals.profitMargin.value, 54.2);
  assert.equal(totals.postingCount, 3);
});

test('BI resolves hourly, daily and monthly buckets from the selected bounded period', () => {
  const now = new Date('2026-09-09T08:00:00Z');
  assert.equal(granularityFor(resolveAnalyticsPeriod({ period: 'TODAY', now })), 'hour');
  assert.equal(granularityFor(resolveAnalyticsPeriod({ period: 'THIS_MONTH', now })), 'day');
  assert.equal(granularityFor(resolveAnalyticsPeriod({ period: 'THIS_YEAR', now })), 'month');
});

test('financial endpoint reports currency exclusions and incomplete costs without writing or inventing profit', async () => {
  const queries = [];
  const posting = grouped(POSTING_TYPE.BOOKING_NET_CONTRIBUTION, { bookedRevenue: 100, collectedRevenue: 80, missingCosts: 1 });
  const service = createBusinessIntelligenceService({ currency: 'EUR', now: () => new Date('2026-09-09T08:00:00Z'), AccountingPostingModel: { aggregate: async (pipeline) => {
    queries.push(pipeline);
    return [{ excludedCurrency: [{ count: 2 }], totals: [posting], products: [{ ...posting, _id: { type: POSTING_TYPE.BOOKING_NET_CONTRIBUTION, dimension: { productId: '7', productTitle: 'Tour' } } }], trend: [], channels: [] }];
  } } });
  const result = await service.getBusinessIntelligence({ section: 'financial' });
  assert.equal(result.currency, 'EUR');
  assert.equal(result.financialSummary.revenue, 100);
  assert.equal(result.financialSummary.costsIncomplete, true);
  assert.equal(result.products[0].grossProfit, null);
  assert.equal(result.products[0].actualDirectCost, null);
  assert.ok(result.warnings.some((row) => row.code === 'OTHER_BASE_CURRENCY_EXCLUDED' && row.count === 2));
  assert.equal(queries.length, 2);
  assert.equal(queries[0][1].$facet.totals[0].$match.baseCurrency, 'EUR');
  assert.equal(JSON.stringify(queries[0]).match(/\$facet/g).length, 1);
  assert.equal(queries[0][0].$match.accountingScope, 'BUSINESS_ACCOUNTING');
  assert.ok(queries[1][0].$match.transactionDate.$lt <= queries[0][0].$match.transactionDate.$gte);
});

test('operations endpoint reports distinct identified customers and bounded recent rows', async () => {
  const pipelines = [];
  const service = createBusinessIntelligenceService({ currency: 'USD', now: () => new Date('2026-09-09T08:00:00Z'), ProductModel: { countDocuments: async () => 8 }, BookingModel: { aggregate: async (pipeline) => {
    pipelines.push(pipeline);
    return [{ totals: [{ totalBookings: 5, confirmedBookings: 3, cancelledBookings: 1, participants: 12, participantBookings: 3, missingIdentity: 1 }], customers: [{ totalCustomers: 2, returningCustomers: 1, identifiedBookings: 4 }], recent: [], trend: [], missingPostings: [{ count: 1 }] }];
  } } });
  const result = await service.getBusinessIntelligence({ section: 'operations' });
  assert.equal(result.kpis.totalBookings.value, 5);
  assert.equal(result.kpis.totalCustomers.value, 2);
  assert.equal(result.customers.newCustomers, 1);
  assert.equal(result.customers.bookingsPerCustomer, 2);
  assert.equal(result.operations.cancellationRate, 20);
  assert.equal(result.operations.averageGroupSize, 4);
  assert.equal(result.operations.averageBookingValue, null);
  assert.equal(pipelines[0][1].$facet.recent[1].$limit, 5);
  assert.equal(pipelines[0][1].$facet.customers[1].$group._id, '$customer.customerId');
});

test('BI rejects unbounded and unknown section requests before touching storage', async () => {
  const service = createBusinessIntelligenceService({ AccountingPostingModel: {}, BookingModel: {} });
  await assert.rejects(service.getBusinessIntelligence({ period: 'LIFETIME' }), /bounded/);
  await assert.rejects(service.getBusinessIntelligence({ section: 'unknown' }), /Unknown/);
});
