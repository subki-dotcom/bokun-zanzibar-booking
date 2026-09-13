process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27029/bi-isolated';
process.env.JWT_SECRET ||= 'bi-integration-test-secret';
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { createBusinessIntelligenceService } = require('../src/analytics/businessIntelligenceService');
const { ACCOUNTING_SCOPE, FINANCIAL_ENTRY_STATUS, POSTING_TYPE } = require('../src/accounting/constants');

test('BI pipelines run on MongoDB with source-linked money, customers, costs and empty date buckets', { skip: !process.env.BI_TEST_MONGO_URI }, async () => {
  // An explicit isolated server is required; never use the application's MONGO_URI.
  const connection = await mongoose.createConnection(process.env.BI_TEST_MONGO_URI, { dbName: `bi_integration_${Date.now()}_${process.pid}` }).asPromise();
  try {
    const db = connection.db;
    const customerId = new mongoose.Types.ObjectId();
    const date = new Date('2026-09-09T09:00:00Z');
    const booking = { bookingReference: 'BI-1', bokunProductId: 'p1', bokunOptionId: 'o1', productTitle: 'Real fixture tour', createdAt: date, bookingStatus: 'confirmed', salesChannel: 'DIRECT', customer: { customerId, firstName: 'Test', lastName: 'Customer' }, pricingSnapshot: { finalPayable: 100, currency: 'USD' }, amount: 999, currency: 'EUR', paxSummary: { total: 2 } };
    await db.collection('bookings').insertMany([booking, { ...booking, bookingReference: 'BI-2', createdAt: new Date('2026-09-11T09:00:00Z'), pricingSnapshot: { finalPayable: 200, currency: 'USD' } }, { ...booking, bookingReference: 'BI-OLD', createdAt: new Date('2026-08-01T09:00:00Z') }]);
    const money = (value) => mongoose.Types.Decimal128.fromString(String(value));
    const posting = { accountingScope: ACCOUNTING_SCOPE.BUSINESS, status: FINANCIAL_ENTRY_STATUS.APPROVED, postingType: POSTING_TYPE.BOOKING_NET_CONTRIBUTION, transactionDate: date, baseCurrency: 'USD', bookingReference: 'BI-1', amount: money(80), baseCurrencyAmount: money(80), components: { bookedRevenue: money(100), collectedRevenue: money(90), refundedAmount: money(10), bookingNetContribution: money(80) }, metadata: { directBookingCostsIncluded: false } };
    await db.collection('accountingpostings').insertMany([posting, { ...posting, bookingReference: '', postingType: POSTING_TYPE.OTHER_BUSINESS_INCOME, components: { otherBusinessIncome: money(40) } }, { ...posting, bookingReference: 'FX', baseCurrency: 'EUR' }]);
    await db.collection('businessexpenses').insertOne({ bookingReference: 'BI-1', category: 'BOOKING_DIRECT_COST', status: FINANCIAL_ENTRY_STATUS.APPROVED, baseCurrency: 'USD', expenseDate: date, baseCurrencyAmount: money(25) });
    await db.collection('productcosttemplates').insertOne({ bokunProductId: 'p1', bokunOptionId: 'o1', status: 'active' });
    await db.collection('productsnapshots').insertOne({ bokunProductId: 'p1' });
    const model = (name) => ({ aggregate: (pipeline) => db.collection(name).aggregate(pipeline).toArray(), countDocuments: (query) => db.collection(name).countDocuments(query) });
    const service = createBusinessIntelligenceService({ AccountingPostingModel: model('accountingpostings'), BookingModel: model('bookings'), ProductModel: model('productsnapshots'), currency: 'USD', now: () => date });
    const financial = await service.getBusinessIntelligence({ section: 'financial' });
    assert.equal(financial.financialSummary.revenue, 140);
    assert.equal(financial.financialSummary.netProfit, 120);
    assert.equal(financial.channels.length, 1);
    assert.equal(financial.channels[0].revenue, 100);
    assert.equal(financial.channels[0].contributionPercentage, 100);
    assert.equal(financial.products[0].actualDirectCost, 25);
    assert.equal(financial.products[0].templateBookings, 1);
    assert.equal(financial.products[0].grossProfit, null);
    assert.equal(financial.trend.length, 30);
    assert.equal(financial.trend.find((row) => row.date === '2026-09-10').revenue, 0);
    assert.ok(financial.warnings.some((row) => row.code === 'OTHER_BASE_CURRENCY_EXCLUDED' && row.count === 1));
    const operations = await service.getBusinessIntelligence({ section: 'operations' });
    assert.equal(operations.kpis.totalBookings.value, 2);
    assert.equal(operations.kpis.totalCustomers.value, 1);
    assert.equal(operations.customers.returningCustomers, 1);
    assert.equal(operations.operations.averageBookingValue, 150);
    assert.equal(operations.operations.averageBookingValueCount, 2);
    assert.equal(operations.recentBookings[0].amount, 200);
    assert.equal(operations.recentBookings[0].currency, 'USD');
    assert.equal(operations.trend.length, 30);
    assert.equal(operations.trend.find((row) => row.date === '2026-09-10').bookings, 0);
    assert.ok(operations.warnings.some((row) => row.code === 'MISSING_ACCOUNTING_POSTINGS' && row.count === 1));
    assert.equal(await db.collection('accountingpostings').countDocuments(), 3);
  } finally {
    await connection.dropDatabase();
    await connection.close();
  }
});
