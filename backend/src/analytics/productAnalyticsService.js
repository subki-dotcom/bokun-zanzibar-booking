const AccountingPosting = require("../models/AccountingPosting");
const Booking = require("../models/Booking");
const {
  ACCOUNTING_SCOPE,
  COUNTED_FINANCIAL_STATUSES,
  POSTING_TYPE
} = require("../accounting/constants");
const { SALES_CHANNEL } = require("../integrations/bokun/salesChannel.adapter");
const {
  ANALYTICS_COMPARE_MODE,
  ANALYTICS_DATE_DIMENSION,
  ANALYTICS_PERIOD
} = require("./constants");
const {
  buildDateDimensionMatch,
  describeDateDimension,
  normalizeDateDimension
} = require("./dateDimensions");
const {
  resolveAnalyticsPeriod,
  resolveComparisonPeriod,
  safePercentageChange
} = require("./periods");
const {
  Decimal,
  decimalString,
  decimalToApi,
  subtract,
  toDecimal
} = require("../utils/money");

const PRODUCT_DATE_DIMENSIONS = Object.freeze([
  ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE,
  ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE,
  ANALYTICS_DATE_DIMENSION.BOOKING_CREATED_AT
]);

const PRODUCT_RANKING = Object.freeze({
  BEST_SELLING_BY_BOOKINGS: "BEST_SELLING_BY_BOOKINGS",
  BEST_SELLING_BY_PARTICIPANTS: "BEST_SELLING_BY_PARTICIPANTS",
  HIGHEST_REVENUE: "HIGHEST_REVENUE",
  HIGHEST_GROSS_PROFIT: "HIGHEST_GROSS_PROFIT",
  HIGHEST_NET_PROFIT: "HIGHEST_NET_PROFIT",
  HIGHEST_MARGIN: "HIGHEST_MARGIN",
  LOWEST_MARGIN: "LOWEST_MARGIN",
  HIGHEST_REFUND_RATE: "HIGHEST_REFUND_RATE",
  HIGHEST_CANCELLATION_RATE: "HIGHEST_CANCELLATION_RATE",
  LOSS_MAKING: "LOSS_MAKING"
});

const PRODUCT_CLASSIFICATION = Object.freeze({
  STAR_PRODUCT: "STAR_PRODUCT",
  MARGIN_PROBLEM: "MARGIN_PROBLEM",
  GROWTH_OPPORTUNITY: "GROWTH_OPPORTUNITY",
  REVIEW_PRODUCT: "REVIEW_PRODUCT"
});

const normalizeToken = (value = "") => String(value || "").trim();

const leanMaybe = async (value) => {
  if (value && typeof value.lean === "function") return value.lean();
  return value;
};

const asArray = (value) => (Array.isArray(value) ? value : []);

const moneyOrZero = (value) => {
  const normalized = decimalToApi(value);
  if (normalized !== null && normalized !== undefined) return normalized;
  try {
    return decimalString(value ?? 0);
  } catch (error) {
    return "0";
  }
};

const toApiNumber = (value) => Number(toDecimal(value || 0).toFixed(2));

const sumMoney = (rows = [], mapper = (row) => row) =>
  rows.reduce((sum, row) => sum.plus(toDecimal(mapper(row) || 0)), new Decimal(0)).toFixed();

const ratio = (numerator = 0, denominator = 0, decimalPlaces = 2) => {
  const bottom = Number(denominator || 0);
  if (!Number.isFinite(bottom) || bottom <= 0) return null;
  const top = Number(numerator || 0);
  return Number((top / bottom).toFixed(decimalPlaces));
};

const ratioPercent = (numerator = 0, denominator = 0, decimalPlaces = 1) => {
  const bottom = Number(denominator || 0);
  if (!Number.isFinite(bottom) || bottom <= 0) return null;
  const top = Number(numerator || 0);
  return Number(((top / bottom) * 100).toFixed(decimalPlaces));
};

const normalizeChannel = (value = "") => {
  const token = String(value || "").trim().toUpperCase();
  return Object.values(SALES_CHANNEL).includes(token) ? token : "";
};

const bookingAmount = (booking = {}) =>
  moneyOrZero(booking.pricingSnapshot?.finalPayable ?? booking.amount ?? 0);

const participantCount = (booking = {}) => Number(booking.paxSummary?.total || 0);

const componentMoney = (posting = {}, key = "") => moneyOrZero(posting.components?.[key] ?? 0);

const productKeyForBooking = (booking = {}) =>
  normalizeToken(booking.bokunProductId || booking.productTitle || "UNKNOWN_PRODUCT");

const productTitleForBooking = (booking = {}) =>
  normalizeToken(booking.productTitle || booking.bokunProductId || "Unknown product");

const isConfirmed = (booking = {}) => booking.bookingStatus === "confirmed";
const isCancelled = (booking = {}) => booking.bookingStatus === "cancelled";

const buildBookingQuery = ({ range, dateDimension, channel = "", productId = "" } = {}) => {
  const query = {
    ...buildDateDimensionMatch({
      dateDimension,
      range,
      allowed: PRODUCT_DATE_DIMENSIONS
    })
  };
  const normalizedChannel = normalizeChannel(channel);
  if (normalizedChannel) query.salesChannel = normalizedChannel;
  if (productId) query.bokunProductId = normalizeToken(productId);
  return query;
};

const buildPostingQuery = (bookingReferences = []) => ({
  accountingScope: ACCOUNTING_SCOPE.BUSINESS,
  status: { $in: COUNTED_FINANCIAL_STATUSES },
  postingType: POSTING_TYPE.BOOKING_NET_CONTRIBUTION,
  sourceReference: { $in: asArray(bookingReferences).filter(Boolean) }
});

const indexPostingsByBookingReference = (postings = []) =>
  asArray(postings).reduce((map, posting) => {
    if (posting.sourceReference) map.set(posting.sourceReference, posting);
    return map;
  }, new Map());

const emptyProductAccumulator = (booking = {}) => ({
  productId: productKeyForBooking(booking),
  productTitle: productTitleForBooking(booking),
  bookingsCount: 0,
  confirmedBookings: 0,
  cancelledBookings: 0,
  participants: 0,
  bookedRevenue: "0",
  collectedRevenue: "0",
  refunds: "0",
  providerFees: "0",
  channelCommission: "0",
  directCosts: "0",
  grossProfit: "0",
  netContribution: "0",
  bookingReferences: [],
  salesChannels: new Set(),
  missingAccountingPostingCount: 0,
  missingCostRecords: 0
});

const finalizeProduct = (product = {}, comparison = null, thresholds = {}) => {
  const netRevenue = subtract(
    subtract(
      subtract(product.collectedRevenue, product.refunds),
      product.providerFees
    ),
    product.channelCommission
  );
  const grossProfit = subtract(netRevenue, product.directCosts);
  const netContribution = product.netContribution || grossProfit;
  const bookedRevenueNumber = toApiNumber(product.bookedRevenue);
  const confirmedBookings = product.confirmedBookings || 0;
  const profitMargin = ratioPercent(toApiNumber(netContribution), bookedRevenueNumber);
  const refundRate = ratioPercent(toApiNumber(product.refunds), toApiNumber(product.collectedRevenue));
  const cancellationRate = ratioPercent(product.cancelledBookings, product.bookingsCount);
  const classification = classifyProduct({
    bookedRevenue: bookedRevenueNumber,
    netContribution: toApiNumber(netContribution),
    profitMargin,
    thresholds
  });

  return {
    productId: product.productId,
    productTitle: product.productTitle,
    bookingsCount: product.bookingsCount,
    confirmedBookings,
    cancelledBookings: product.cancelledBookings,
    participants: product.participants,
    bookedRevenue: bookedRevenueNumber,
    collectedRevenue: toApiNumber(product.collectedRevenue),
    refunds: toApiNumber(product.refunds),
    providerFees: toApiNumber(product.providerFees),
    channelCommission: toApiNumber(product.channelCommission),
    directCosts: toApiNumber(product.directCosts),
    netRevenue: toApiNumber(netRevenue),
    grossProfit: toApiNumber(grossProfit),
    netContribution: toApiNumber(netContribution),
    profitMargin,
    averageBookingValue: ratio(bookedRevenueNumber, confirmedBookings),
    averageProfitPerBooking: ratio(toApiNumber(netContribution), confirmedBookings),
    cancellationRate,
    refundRate,
    refundRateBasis: "refundedAmount/collectedRevenue",
    salesChannels: Array.from(product.salesChannels).sort(),
    classification,
    growth: comparison
      ? {
          bookings: safePercentageChange(confirmedBookings, comparison.confirmedBookings),
          revenue: safePercentageChange(bookedRevenueNumber, comparison.bookedRevenue),
          netContribution: safePercentageChange(toApiNumber(netContribution), comparison.netContribution)
        }
      : null,
    dataQuality: {
      missingAccountingPostings: product.missingAccountingPostingCount,
      missingCostRecords: product.missingCostRecords
    },
    drillDown: {
      bookingReferences: product.bookingReferences
    }
  };
};

function classifyProduct({ bookedRevenue = 0, netContribution = 0, profitMargin = null, thresholds = {} } = {}) {
  const highSales = bookedRevenue > 0 && bookedRevenue >= Number(thresholds.averageBookedRevenue || 0);
  const highProfit = netContribution > 0 && profitMargin !== null && profitMargin >= Number(thresholds.averageProfitMargin || 0);
  if (highSales && highProfit) {
    return {
      code: PRODUCT_CLASSIFICATION.STAR_PRODUCT,
      label: "High sales + high profit",
      reason: "Revenue and profit margin are both above the current product average."
    };
  }
  if (highSales && !highProfit) {
    return {
      code: PRODUCT_CLASSIFICATION.MARGIN_PROBLEM,
      label: "High sales + low profit",
      reason: "Sales are strong but profit margin is below the current product average."
    };
  }
  if (!highSales && highProfit) {
    return {
      code: PRODUCT_CLASSIFICATION.GROWTH_OPPORTUNITY,
      label: "Low sales + high margin",
      reason: "Profit margin is strong but booked revenue is below the current product average."
    };
  }
  return {
    code: PRODUCT_CLASSIFICATION.REVIEW_PRODUCT,
    label: "Low sales + low profit",
    reason: "Sales and profit margin are both below the current product average, or profit data is incomplete."
  };
}

const summarizeForRanking = (product = {}) => ({
  productId: product.productId,
  productTitle: product.productTitle,
  bookingsCount: product.bookingsCount,
  confirmedBookings: product.confirmedBookings,
  participants: product.participants,
  bookedRevenue: product.bookedRevenue,
  grossProfit: product.grossProfit,
  netContribution: product.netContribution,
  profitMargin: product.profitMargin,
  cancellationRate: product.cancellationRate,
  refundRate: product.refundRate,
  classification: product.classification?.code || ""
});

const topBy = (products = [], metric, { ascending = false, positiveOnly = false } = {}) =>
  asArray(products)
    .filter((product) => !positiveOnly || Number(product[metric] || 0) > 0)
    .filter((product) => product[metric] !== null && product[metric] !== undefined)
    .sort((left, right) => ascending
      ? Number(left[metric] || 0) - Number(right[metric] || 0)
      : Number(right[metric] || 0) - Number(left[metric] || 0))
    .slice(0, 10)
    .map(summarizeForRanking);

const buildRankings = (products = []) => ({
  [PRODUCT_RANKING.BEST_SELLING_BY_BOOKINGS]: topBy(products, "confirmedBookings", { positiveOnly: true }),
  [PRODUCT_RANKING.BEST_SELLING_BY_PARTICIPANTS]: topBy(products, "participants", { positiveOnly: true }),
  [PRODUCT_RANKING.HIGHEST_REVENUE]: topBy(products, "bookedRevenue", { positiveOnly: true }),
  [PRODUCT_RANKING.HIGHEST_GROSS_PROFIT]: topBy(products, "grossProfit"),
  [PRODUCT_RANKING.HIGHEST_NET_PROFIT]: topBy(products, "netContribution"),
  [PRODUCT_RANKING.HIGHEST_MARGIN]: topBy(products.filter((product) => product.profitMargin !== null), "profitMargin"),
  [PRODUCT_RANKING.LOWEST_MARGIN]: topBy(products.filter((product) => product.profitMargin !== null), "profitMargin", { ascending: true }),
  [PRODUCT_RANKING.HIGHEST_REFUND_RATE]: topBy(products.filter((product) => product.refundRate !== null), "refundRate"),
  [PRODUCT_RANKING.HIGHEST_CANCELLATION_RATE]: topBy(products.filter((product) => product.cancellationRate !== null), "cancellationRate"),
  [PRODUCT_RANKING.LOSS_MAKING]: products
    .filter((product) => product.netContribution < 0)
    .sort((left, right) => left.netContribution - right.netContribution)
    .slice(0, 10)
    .map(summarizeForRanking)
});

const buildThresholds = (productAccumulators = []) => {
  const finalizedForThresholds = asArray(productAccumulators).map((product) => {
    const netRevenue = subtract(
      subtract(subtract(product.collectedRevenue, product.refunds), product.providerFees),
      product.channelCommission
    );
    const grossProfit = subtract(netRevenue, product.directCosts);
    const netContribution = product.netContribution || grossProfit;
    return {
      bookedRevenue: toApiNumber(product.bookedRevenue),
      profitMargin: ratioPercent(toApiNumber(netContribution), toApiNumber(product.bookedRevenue))
    };
  });
  const productsWithRevenue = finalizedForThresholds.filter((product) => product.bookedRevenue > 0);
  const productsWithMargin = finalizedForThresholds.filter((product) => product.profitMargin !== null);
  return {
    averageBookedRevenue: productsWithRevenue.length
      ? ratio(productsWithRevenue.reduce((sum, product) => sum + product.bookedRevenue, 0), productsWithRevenue.length)
      : 0,
    averageProfitMargin: productsWithMargin.length
      ? ratio(productsWithMargin.reduce((sum, product) => sum + product.profitMargin, 0), productsWithMargin.length, 1)
      : 0,
    method: "Relative to current filtered product average"
  };
};

const aggregateProducts = ({ bookings = [], postingsByReference = new Map(), comparisonByProduct = new Map() } = {}) => {
  const products = new Map();
  asArray(bookings).forEach((booking) => {
    const key = productKeyForBooking(booking);
    if (!products.has(key)) products.set(key, emptyProductAccumulator(booking));
    const product = products.get(key);
    const posting = postingsByReference.get(booking.bookingReference);
    product.bookingsCount += 1;
    product.bookingReferences.push(booking.bookingReference);
    if (booking.salesChannel) product.salesChannels.add(booking.salesChannel);
    if (isCancelled(booking)) product.cancelledBookings += 1;

    if (!isConfirmed(booking)) return;

    product.confirmedBookings += 1;
    product.participants += participantCount(booking);
    product.bookedRevenue = sumMoney([product.bookedRevenue, bookingAmount(booking)]);

    if (!posting) {
      product.missingAccountingPostingCount += 1;
      return;
    }

    const directCosts = componentMoney(posting, "directBookingCosts");
    product.collectedRevenue = sumMoney([product.collectedRevenue, componentMoney(posting, "collectedRevenue")]);
    product.refunds = sumMoney([product.refunds, componentMoney(posting, "refundedAmount")]);
    product.providerFees = sumMoney([product.providerFees, componentMoney(posting, "providerFees")]);
    product.channelCommission = sumMoney([product.channelCommission, componentMoney(posting, "channelCommission")]);
    product.directCosts = sumMoney([product.directCosts, directCosts]);
    product.netContribution = sumMoney([product.netContribution, componentMoney(posting, "bookingNetContribution")]);
    if (toDecimal(directCosts).isZero() || posting.metadata?.directBookingCostsIncluded === false) {
      product.missingCostRecords += 1;
    }
  });

  const accumulators = Array.from(products.values());
  const thresholds = buildThresholds(accumulators);
  return accumulators
    .map((product) => finalizeProduct(product, comparisonByProduct.get(product.productId) || null, thresholds))
    .sort((left, right) => right.bookedRevenue - left.bookedRevenue || right.netContribution - left.netContribution);
};

const normalizeTotals = (products = []) => ({
  productsCount: products.length,
  bookingsCount: products.reduce((sum, product) => sum + product.bookingsCount, 0),
  confirmedBookings: products.reduce((sum, product) => sum + product.confirmedBookings, 0),
  cancelledBookings: products.reduce((sum, product) => sum + product.cancelledBookings, 0),
  participants: products.reduce((sum, product) => sum + product.participants, 0),
  bookedRevenue: Number(products.reduce((sum, product) => sum + product.bookedRevenue, 0).toFixed(2)),
  collectedRevenue: Number(products.reduce((sum, product) => sum + product.collectedRevenue, 0).toFixed(2)),
  refunds: Number(products.reduce((sum, product) => sum + product.refunds, 0).toFixed(2)),
  directCosts: Number(products.reduce((sum, product) => sum + product.directCosts, 0).toFixed(2)),
  grossProfit: Number(products.reduce((sum, product) => sum + product.grossProfit, 0).toFixed(2)),
  netContribution: Number(products.reduce((sum, product) => sum + product.netContribution, 0).toFixed(2)),
  averageBookingValue: ratio(
    products.reduce((sum, product) => sum + product.bookedRevenue, 0),
    products.reduce((sum, product) => sum + product.confirmedBookings, 0)
  ),
  cancellationRate: ratioPercent(
    products.reduce((sum, product) => sum + product.cancelledBookings, 0),
    products.reduce((sum, product) => sum + product.bookingsCount, 0)
  ),
  refundRate: ratioPercent(
    products.reduce((sum, product) => sum + product.refunds, 0),
    products.reduce((sum, product) => sum + product.collectedRevenue, 0)
  )
});

const buildDataQuality = (products = [], bookings = []) => {
  const missingAccountingPostings = products.reduce((sum, product) => sum + product.dataQuality.missingAccountingPostings, 0);
  const missingCostRecords = products.reduce((sum, product) => sum + product.dataQuality.missingCostRecords, 0);
  const unknownProducts = asArray(bookings).filter((booking) => !booking.bokunProductId && !booking.productTitle).length;
  const warnings = [];
  if (missingAccountingPostings > 0) {
    warnings.push({
      code: "MISSING_BOOKING_ACCOUNTING_POSTINGS",
      severity: "warning",
      message: "Some confirmed product bookings do not yet have Booking Accounting contribution postings.",
      count: missingAccountingPostings
    });
  }
  if (missingCostRecords > 0) {
    warnings.push({
      code: "DIRECT_PRODUCT_COSTS_INCOMPLETE",
      severity: "warning",
      message: "Some product bookings do not include actual direct costs yet, so margin may be overstated.",
      count: missingCostRecords
    });
  }
  if (unknownProducts > 0) {
    warnings.push({
      code: "UNKNOWN_PRODUCTS",
      severity: "info",
      message: "Some bookings are missing a product identifier/title.",
      count: unknownProducts
    });
  }
  return {
    completeRecords: Math.max(0, products.reduce((sum, product) => sum + product.confirmedBookings, 0) - missingAccountingPostings - missingCostRecords),
    incompleteRecords: missingAccountingPostings + missingCostRecords + unknownProducts,
    missingAccountingPostings,
    missingCostRecords,
    unknownProducts,
    warnings
  };
};

const compareProductMetrics = (products = []) =>
  asArray(products).reduce((map, product) => {
    map.set(product.productId, product);
    return map;
  }, new Map());

const createProductAnalyticsService = ({
  AccountingPostingModel = AccountingPosting,
  BookingModel = Booking,
  now = () => new Date()
} = {}) => {
  const fetchBookings = async ({ range, dateDimension, channel = "", productId = "" }) => {
    const query = buildBookingQuery({ range, dateDimension, channel, productId });
    const result = BookingModel.find(query);
    const rows = result && typeof result.limit === "function"
      ? await leanMaybe(result.limit(10000))
      : await leanMaybe(result);
    return asArray(rows);
  };

  const fetchPostingsForBookings = async (bookings = []) => {
    const refs = asArray(bookings).map((booking) => booking.bookingReference).filter(Boolean);
    if (!refs.length) return [];
    return asArray(await leanMaybe(AccountingPostingModel.find(buildPostingQuery(refs))));
  };

  const getRangeProducts = async ({ range, dateDimension, channel = "", productId = "", comparisonByProduct = new Map() }) => {
    const bookings = await fetchBookings({ range, dateDimension, channel, productId });
    const postings = await fetchPostingsForBookings(bookings);
    const postingsByReference = indexPostingsByBookingReference(postings);
    const products = aggregateProducts({ bookings, postingsByReference, comparisonByProduct });
    return {
      bookings,
      postings,
      products,
      totals: normalizeTotals(products),
      dataQuality: buildDataQuality(products, bookings)
    };
  };

  const getProductAnalytics = async ({
    period = ANALYTICS_PERIOD.THIS_MONTH,
    from = "",
    to = "",
    compare = ANALYTICS_COMPARE_MODE.PREVIOUS_PERIOD,
    compareFrom = "",
    compareTo = "",
    dateDimension = ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE,
    channel = "",
    productId = ""
  } = {}) => {
    const currentRange = resolveAnalyticsPeriod({ period, from, to, now: now() });
    const comparison = resolveComparisonPeriod({ currentRange, compare, compareFrom, compareTo });
    const normalizedDateDimension = normalizeDateDimension(dateDimension);
    const normalizedChannel = normalizeChannel(channel);
    const normalizedProductId = normalizeToken(productId);
    let comparisonMetrics = null;
    let comparisonByProduct = new Map();

    if (comparison?.range) {
      comparisonMetrics = await getRangeProducts({
        range: comparison.range,
        dateDimension: normalizedDateDimension,
        channel: normalizedChannel,
        productId: normalizedProductId
      });
      comparisonByProduct = compareProductMetrics(comparisonMetrics.products);
    }

    const currentMetrics = await getRangeProducts({
      range: currentRange,
      dateDimension: normalizedDateDimension,
      channel: normalizedChannel,
      productId: normalizedProductId,
      comparisonByProduct
    });

    return {
      report: "PRODUCT_ANALYTICS",
      generatedAt: now().toISOString(),
      period: currentRange,
      comparison: comparison
        ? {
            ...comparison,
            range: comparison.range || null,
            totals: comparisonMetrics?.totals || null
          }
        : null,
      dateDimension: describeDateDimension(normalizedDateDimension),
      filters: {
        channel: normalizedChannel,
        productId: normalizedProductId
      },
      sourceOfTruth: {
        operational: "Confirmed/cancelled Bokun/local Booking records grouped by product",
        financial: "Business Accounting / AccountingPosting booking contribution rows",
        noSecondAccountingTruth: true
      },
      totals: currentMetrics.totals,
      rankings: buildRankings(currentMetrics.products),
      performanceMatrix: {
        classificationMethod: "Products are classified relative to current filtered average booked revenue and profit margin.",
        products: currentMetrics.products.map((product) => ({
          productId: product.productId,
          productTitle: product.productTitle,
          bookedRevenue: product.bookedRevenue,
          netContribution: product.netContribution,
          profitMargin: product.profitMargin,
          classification: product.classification
        }))
      },
      products: currentMetrics.products,
      dataQuality: currentMetrics.dataQuality,
      drillDown: {
        bookings: {
          route: "/api/bookings",
          filters: {
            fromDate: currentRange.fromIso,
            toDate: currentRange.toIso,
            dateDimension: normalizedDateDimension,
            channel: normalizedChannel,
            productId: normalizedProductId
          }
        },
        accountingPostings: {
          route: "/api/admin/business-accounting/foundation",
          filters: {
            sourceReferences: currentMetrics.bookings.map((booking) => booking.bookingReference).filter(Boolean)
          }
        }
      },
      limitations: [
        "Product revenue uses immutable booking pricing snapshots for confirmed bookings.",
        "Product profit uses Booking Accounting contribution postings; missing postings and missing direct costs are reported as data-quality warnings.",
        "High sales and high profit are ranked independently; a high-revenue product can still be classified as a margin problem."
      ]
    };
  };

  return {
    getProductAnalytics
  };
};

const service = createProductAnalyticsService();

module.exports = {
  ...service,
  createProductAnalyticsService,
  PRODUCT_CLASSIFICATION,
  PRODUCT_RANKING,
  __testables: {
    aggregateProducts,
    buildDataQuality,
    buildRankings,
    classifyProduct,
    normalizeTotals
  }
};
