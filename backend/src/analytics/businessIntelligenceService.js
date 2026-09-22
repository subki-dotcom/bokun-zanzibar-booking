const AccountingPosting = require('../models/AccountingPosting');
const Booking = require('../models/Booking');
const ProductSnapshot = require('../models/ProductSnapshot');
const { env } = require('../config/env');
const AppError = require('../utils/AppError');
const { ACCOUNTING_SCOPE, COUNTED_FINANCIAL_STATUSES, POSTING_TYPE } = require('../accounting/constants');
const { resolveAnalyticsPeriod, resolveComparisonPeriod, safePercentageChange, datePartsInTimeZone, zonedDateTimeToUtc } = require('./periods');
const { aggregatePostings, normalizeTotalsForApi } = require('./executiveAnalyticsService');

const COMPONENTS = ['bookedRevenue', 'invoicedRevenue', 'collectedRevenue', 'refundedAmount', 'providerFees', 'channelCommission', 'directBookingCosts', 'bookingNetContribution', 'otherBusinessIncome'];
const countWhen = (condition) => ({ $sum: { $cond: [condition, 1, 0] } });
const granularityFor = (range) => (range.to - range.from <= 86400000 ? 'hour' : range.to - range.from <= 93 * 86400000 ? 'day' : 'month');
const dateKey = (field, range) => ({ $dateToString: { date: field, timezone: range.timeZone, format: granularityFor(range) === 'hour' ? '%Y-%m-%dT%H:00' : granularityFor(range) === 'month' ? '%Y-%m' : '%Y-%m-%d' } });
const rangeMatch = (range) => ({ $gte: range.from, $lt: range.to });
const fillTrend = (rows, range, field) => {
  const values = new Map(rows.map((row) => [row.date, row[field]]));
  const granularity = granularityFor(range);
  const output = [];
  let cursor = new Date(range.from);
  while (cursor < range.to) {
    const p = datePartsInTimeZone(cursor, range.timeZone);
    const month = `${p.year}-${String(p.month).padStart(2, '0')}`;
    const day = `${month}-${String(p.day).padStart(2, '0')}`;
    const date = granularity === 'month' ? month : granularity === 'hour' ? `${day}T${String(p.hour).padStart(2, '0')}:00` : day;
    output.push({ date, [field]: values.get(date) || 0 });
    cursor = granularity === 'month' ? zonedDateTimeToUtc({ year: p.year, month: p.month + 1, day: 1 }, range.timeZone) : new Date(cursor.getTime() + (granularity === 'hour' ? 3600000 : 86400000));
  }
  return output;
};
const metric = (value, previous) => ({ value, supported: value !== null, comparison: value === null || previous === null ? null : safePercentageChange(value, previous) });
const summarize = (rows = []) => {
  const postings = rows.map((row) => ({ postingType: row._id.type, baseCurrencyAmount: row.amount, components: Object.fromEntries(COMPONENTS.map((key) => [key, row[key]])) }));
  const totals = normalizeTotalsForApi(aggregatePostings(postings));
  totals.postingCount = rows.reduce((sum, row) => sum + row.count, 0);
  totals.totalCost = Number((totals.directBookingCosts + totals.operatingExpenses + totals.providerFees + totals.channelCommission).toFixed(2));
  return totals;
};
const groupPostings = (dimension = null) => ({ $group: {
  _id: { type: '$postingType', ...(dimension ? { dimension } : {}) },
  ...Object.fromEntries(COMPONENTS.map((key) => [key, { $sum: { $ifNull: [`$components.${key}`, 0] } }])),
  amount: { $sum: '$baseCurrencyAmount' }, count: { $sum: 1 },
  missingCosts: countWhen({ $and: [{ $eq: ['$postingType', POSTING_TYPE.BOOKING_NET_CONTRIBUTION] }, { $ne: ['$metadata.directBookingCostsIncluded', true] }] })
} });
const dimensionRows = (rows = []) => {
  const grouped = new Map();
  rows.forEach((row) => { const key = JSON.stringify(row._id.dimension); if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(row); });
  return [...grouped.values()].map((group) => ({ dimension: group[0]._id.dimension, ...summarize(group), bookings: group.filter((row) => row._id.type === POSTING_TYPE.BOOKING_NET_CONTRIBUTION).reduce((sum, row) => sum + row.count, 0), costsComplete: !group.some((row) => row.missingCosts > 0) }));
};
const warning = (code, message, count, severity = 'warning') => ({ code, message, count, severity });

const createBusinessIntelligenceService = ({ AccountingPostingModel = AccountingPosting, BookingModel = Booking, ProductModel = ProductSnapshot, currency = env.DEFAULT_CURRENCY, now = () => new Date() } = {}) => {
  const financialRange = async (range, details) => {
    const match = { accountingScope: ACCOUNTING_SCOPE.BUSINESS, status: { $in: COUNTED_FINANCIAL_STATUSES }, transactionDate: rangeMatch(range) };
    const facets = { totals: [groupPostings()] };
    if (details) {
      facets.trend = [groupPostings(dateKey('$transactionDate', range))];
      facets.channels = [{ $match: { postingType: POSTING_TYPE.BOOKING_NET_CONTRIBUTION } }, groupPostings({ $ifNull: ['$booking.salesChannel', { $ifNull: ['$sourceSnapshot.salesChannel', 'OTHER'] }] })];
      const productGroup = groupPostings({ productId: { $ifNull: ['$booking.bokunProductId', ''] }, productTitle: { $ifNull: ['$booking.productTitle', 'Unmapped product'] } });
      productGroup.$group.actualDirectCost = { $sum: { $ifNull: [{ $arrayElemAt: ['$actualCosts.amount', 0] }, 0] } };
      productGroup.$group.actualCostRecords = { $sum: { $ifNull: [{ $arrayElemAt: ['$actualCosts.count', 0] }, 0] } };
      productGroup.$group.templateBookings = countWhen({ $gt: [{ $size: '$templates' }, 0] });
      facets.products = [{ $match: { postingType: POSTING_TYPE.BOOKING_NET_CONTRIBUTION } },
        { $lookup: { from: 'businessexpenses', localField: 'bookingReference', foreignField: 'bookingReference', pipeline: [{ $match: { category: 'BOOKING_DIRECT_COST', status: { $in: COUNTED_FINANCIAL_STATUSES }, baseCurrency: currency, expenseDate: rangeMatch(range) } }, { $group: { _id: null, amount: { $sum: '$baseCurrencyAmount' }, count: { $sum: 1 } } }], as: 'actualCosts' } },
        { $lookup: { from: 'productcosttemplates', localField: 'booking.bokunProductId', foreignField: 'bokunProductId', let: { option: '$booking.bokunOptionId' }, pipeline: [{ $match: { status: 'active', $expr: { $eq: ['$bokunOptionId', '$$option'] } } }, { $limit: 1 }, { $project: { _id: 1 } }], as: 'templates' } }, productGroup];
    }
    const bookingLookup = [
        { $lookup: { from: 'bookings', localField: 'bookingReference', foreignField: 'bookingReference', pipeline: [{ $project: { salesChannel: 1, bokunProductId: 1, bokunOptionId: 1, productTitle: 1 } }], as: 'booking' } },
        { $set: { booking: { $arrayElemAt: ['$booking', 0] } } }
    ];
    const pipeline = [{ $match: match }, { $facet: {
      ...Object.fromEntries(Object.entries(facets).map(([key, stages]) => [key, [{ $match: { baseCurrency: currency } }, ...(['channels', 'products'].includes(key) ? bookingLookup : []), ...stages]])),
      excludedCurrency: [{ $match: { baseCurrency: { $ne: currency } } }, { $count: 'count' }]
    } }];
    const [result = {}] = await AccountingPostingModel.aggregate(pipeline);
    return { ...result, excludedCurrency: result.excludedCurrency?.[0]?.count || 0 };
  };

  const getFinancial = async (range, previous) => {
    const [current, prior] = await Promise.all([financialRange(range, true), financialRange(previous, false)]);
    const financialSummary = summarize(current.totals);
    const previousSummary = summarize(prior.totals);
    const kpis = Object.fromEntries(['revenue', 'collectedRevenue', 'grossProfit', 'netProfit', 'totalCost', 'refundedAmount'].map((key) => [key, metric(financialSummary[key], previousSummary[key])]));
    kpis.profitMargin = metric(financialSummary.profitMargin.value, previousSummary.profitMargin.value);
    const performance = (row) => ({ revenue: row.revenue, bookings: row.bookings, directCost: row.costsComplete ? row.directBookingCosts : null, grossProfit: row.costsComplete ? row.grossProfit : null, margin: row.costsComplete ? row.profitMargin.value : null, netContribution: row.bookingNetContribution, costsComplete: row.costsComplete });
    const missingCosts = (current.totals || []).reduce((sum, row) => sum + row.missingCosts, 0);
    const missingTemplates = (current.products || []).reduce((sum, row) => sum + Math.max(0, row.count - (row.templateBookings || 0)), 0);
    const productSources = new Map((current.products || []).map((row) => [JSON.stringify(row._id.dimension), row]));
    financialSummary.costsIncomplete = missingCosts > 0;
    financialSummary.missingCostCount = missingCosts;
    return { kpis, financialSummary, previousFinancialSummary: previousSummary,
      trend: fillTrend(dimensionRows(current.trend).map((row) => ({ date: row.dimension, revenue: row.revenue })), range, 'revenue'),
      channels: dimensionRows(current.channels).map((row) => ({ channel: row.dimension || 'OTHER', ...performance(row), contributionPercentage: financialSummary.bookedRevenue > 0 ? row.revenue / financialSummary.bookedRevenue * 100 : null })).sort((a, b) => b.revenue - a.revenue),
      products: dimensionRows(current.products).map((row) => {
        const source = productSources.get(JSON.stringify(row.dimension));
        return { ...row.dimension, ...performance(row), actualDirectCost: source?.actualCostRecords ? Number(source.actualDirectCost.toString()) : null, actualCostRecords: source?.actualCostRecords || 0, templateBookings: source?.templateBookings || 0 };
      }).sort((a, b) => b.revenue - a.revenue),
      warnings: [missingCosts && warning('DIRECT_BOOKING_COSTS_INCOMPLETE', 'Actual booking cost evidence is pending; profit remains provisional until booking expenses are recorded.', missingCosts, 'info'), missingTemplates && warning('MISSING_COST_TEMPLATE', 'Booking contributions have no currently active product/option cost template.', missingTemplates), current.excludedCurrency && warning('OTHER_BASE_CURRENCY_EXCLUDED', `Postings in other base currencies are excluded from ${currency} totals; historical conversion is unavailable.`, current.excludedCurrency), prior.excludedCurrency && warning('COMPARISON_CURRENCY_EXCLUDED', 'Previous-period postings in other base currencies are excluded from comparisons.', prior.excludedCurrency)].filter(Boolean),
      limitations: ['Revenue is booked revenue plus other business income, not earned revenue. Profit follows the existing collection-based executive accounting formula.', 'Financial dates are accounting transaction dates; booking metrics use record creation dates.', 'Product and channel counts are source-linked contribution postings in the financial period.', 'Company expenses are not allocated to products. Cost templates are estimates and are not substituted for posted actual costs.', 'Receivables, payables, ratings and departure punctuality are not included in this report.']
    };
  };

  const bookingRange = async (range, details) => {
    const facets = {
      bookingValue: [{ $match: { bookingStatus: 'confirmed', 'pricingSnapshot.currency': currency, 'pricingSnapshot.finalPayable': { $type: 'number' } } }, { $group: { _id: null, value: { $avg: '$pricingSnapshot.finalPayable' }, count: { $sum: 1 } } }],
      totals: [{ $group: { _id: null, totalBookings: { $sum: 1 }, confirmedBookings: countWhen({ $eq: ['$bookingStatus', 'confirmed'] }), cancelledBookings: countWhen({ $eq: ['$bookingStatus', 'cancelled'] }), participants: { $sum: '$paxSummary.total' }, participantBookings: countWhen({ $gt: ['$paxSummary.total', 0] }), missingIdentity: countWhen({ $eq: [{ $ifNull: ['$customer.customerId', null] }, null] }) } }],
      customers: [{ $match: { 'customer.customerId': { $ne: null } } }, { $group: { _id: '$customer.customerId', bookings: { $sum: 1 } } }, { $lookup: { from: 'bookings', localField: '_id', foreignField: 'customer.customerId', pipeline: [{ $match: { createdAt: { $lt: range.from } } }, { $limit: 1 }, { $project: { _id: 1 } }], as: 'prior' } }, { $group: { _id: null, totalCustomers: { $sum: 1 }, identifiedBookings: { $sum: '$bookings' }, returningCustomers: countWhen({ $gt: [{ $size: '$prior' }, 0] }) } }]
    };
    if (details) {
      facets.trend = [{ $group: { _id: dateKey('$createdAt', range), bookings: { $sum: 1 } } }, { $sort: { _id: 1 } }];
      facets.recent = [{ $sort: { createdAt: -1, _id: -1 } }, { $limit: 5 }, { $project: { bookingReference: 1, createdAt: 1, customer: 1, productTitle: 1, salesChannel: 1, amount: 1, currency: 1, pricingSnapshot: 1, bookingStatus: 1 } }];
      facets.missingPostings = [{ $match: { bookingStatus: 'confirmed' } }, { $lookup: { from: 'accountingpostings', localField: 'bookingReference', foreignField: 'bookingReference', pipeline: [{ $match: { accountingScope: ACCOUNTING_SCOPE.BUSINESS, postingType: POSTING_TYPE.BOOKING_NET_CONTRIBUTION, status: { $in: COUNTED_FINANCIAL_STATUSES } } }, { $limit: 1 }], as: 'posting' } }, { $match: { posting: { $size: 0 } } }, { $count: 'count' }];
      facets.missingInvoices = [{ $match: { bookingStatus: 'confirmed' } }, { $lookup: { from: 'invoices', localField: 'bookingReference', foreignField: 'bookingReference', pipeline: [{ $limit: 1 }], as: 'invoice' } }, { $match: { invoice: { $size: 0 } } }, { $count: 'count' }];
    }
    const [result = {}] = await BookingModel.aggregate([{ $match: { createdAt: rangeMatch(range) } }, { $facet: facets }]);
    const totals = result.totals?.[0] || {};
    const customers = result.customers?.[0] || {};
    return { ...result, totals: { totalBookings: 0, confirmedBookings: 0, cancelledBookings: 0, participants: 0, participantBookings: 0, missingIdentity: 0, ...totals }, customers: { totalCustomers: 0, returningCustomers: 0, identifiedBookings: 0, ...customers } };
  };
  const getOperations = async (range, previous) => {
    const [current, prior, totalProducts] = await Promise.all([bookingRange(range, true), bookingRange(previous, false), ProductModel.countDocuments({})]);
    const c = current.customers;
    const t = current.totals;
    const missingPostings = current.missingPostings?.[0]?.count || 0;
    const missingInvoices = current.missingInvoices?.[0]?.count || 0;
    return { kpis: { totalBookings: metric(t.totalBookings, prior.totals.totalBookings), totalCustomers: metric(c.totalCustomers, prior.customers.totalCustomers) },
      customers: { ...c, newCustomers: c.totalCustomers - c.returningCustomers, bookingsPerCustomer: c.totalCustomers ? c.identifiedBookings / c.totalCustomers : null },
      operations: { totalBookings: t.totalBookings, confirmedBookings: t.confirmedBookings, cancelledBookings: t.cancelledBookings, cancellationRate: t.totalBookings ? t.cancelledBookings / t.totalBookings * 100 : null, averageGroupSize: t.participantBookings ? t.participants / t.participantBookings : null, totalProducts, averageBookingValue: current.bookingValue?.[0]?.value ?? null, averageBookingValueCount: current.bookingValue?.[0]?.count || 0, averageBookingValueCurrency: currency },
      trend: fillTrend((current.trend || []).map((row) => ({ date: row._id, bookings: row.bookings })), range, 'bookings'),
      recentBookings: (current.recent || []).map((row) => ({ id: String(row._id), bookingReference: row.bookingReference, date: row.createdAt, customer: [row.customer?.firstName, row.customer?.lastName].filter(Boolean).join(' ') || 'Customer unavailable', productTitle: row.productTitle, channel: row.salesChannel || 'OTHER', amount: row.pricingSnapshot?.finalPayable ?? row.amount, currency: row.pricingSnapshot?.currency || row.currency, status: row.bookingStatus })),
      warnings: [t.missingIdentity && warning('MISSING_CUSTOMER_ID', 'Bookings without a linked customer ID are excluded from customer metrics.', t.missingIdentity, 'info'), missingPostings && warning('MISSING_ACCOUNTING_POSTINGS', 'Accounting contribution postings are pending review because settlement or source evidence is incomplete.', missingPostings, 'info'), missingInvoices && warning('MISSING_INVOICE', 'Confirmed bookings have no invoice.', missingInvoices)].filter(Boolean)
    };
  };
  return { getBusinessIntelligence: async ({ section = 'financial', period = 'THIS_MONTH', from, to } = {}) => {
    const range = resolveAnalyticsPeriod({ period, from, to, now: now() });
    if (!range.isBounded) throw new AppError('Business Intelligence requires a bounded period', 422, 'BI_PERIOD_REQUIRED');
    const comparison = resolveComparisonPeriod({ currentRange: range });
    if (!['financial', 'operations'].includes(section)) throw new AppError('Unknown BI section', 422, 'BI_SECTION_INVALID');
    const data = await (section === 'financial' ? getFinancial(range, comparison.range) : getOperations(range, comparison.range));
    return { section, period: range, comparison, currency, granularity: granularityFor(range), generatedAt: now().toISOString(), ...data };
  } };
};

module.exports = { ...createBusinessIntelligenceService(), createBusinessIntelligenceService, __testables: { summarize, dimensionRows, granularityFor, groupPostings, fillTrend } };
