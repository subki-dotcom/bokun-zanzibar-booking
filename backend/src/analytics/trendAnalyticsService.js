const AccountingPosting = require("../models/AccountingPosting");
const Booking = require("../models/Booking");
const {
  ACCOUNTING_SCOPE,
  BUSINESS_UNIT,
  COUNTED_FINANCIAL_STATUSES,
  POSTING_TYPE
} = require("../accounting/constants");
const { SALES_CHANNEL } = require("../integrations/bokun/salesChannel.adapter");
const {
  ANALYTICS_COMPARE_MODE,
  ANALYTICS_DATE_DIMENSION,
  ANALYTICS_GRANULARITY,
  ANALYTICS_PERIOD,
  ANALYTICS_TIME_ZONE
} = require("./constants");
const {
  buildDateDimensionMatch,
  describeDateDimension,
  getDateDimensionConfig,
  normalizeDateDimension
} = require("./dateDimensions");
const {
  datePartsInTimeZone,
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

const TREND_OPERATIONAL_DATE_DIMENSIONS = Object.freeze([
  ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE,
  ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE,
  ANALYTICS_DATE_DIMENSION.BOOKING_CREATED_AT
]);

const TREND_FINANCIAL_DATE_DIMENSIONS = Object.freeze([
  ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE
]);

const FINANCIAL_TREND_POSTING_TYPES = Object.freeze([
  POSTING_TYPE.BOOKING_NET_CONTRIBUTION,
  POSTING_TYPE.OTHER_BUSINESS_INCOME,
  POSTING_TYPE.OPERATING_EXPENSE,
  POSTING_TYPE.PAYROLL_EXPENSE,
  POSTING_TYPE.OTHER_COMPANY_EXPENSE
]);

const EXPENSE_POSTING_TYPES = new Set([
  POSTING_TYPE.OPERATING_EXPENSE,
  POSTING_TYPE.PAYROLL_EXPENSE,
  POSTING_TYPE.OTHER_COMPANY_EXPENSE
]);

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

const ymdFromUtc = (date) => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
  day: date.getUTCDate()
});

const addDays = ({ year, month, day }, days = 0) => ymdFromUtc(new Date(Date.UTC(year, month - 1, day + days)));

const formatYmd = ({ year, month, day }) =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const bucketKeyForDate = (date, granularity = ANALYTICS_GRANULARITY.MONTH, timeZone = ANALYTICS_TIME_ZONE) => {
  const parts = datePartsInTimeZone(date, timeZone);
  if (granularity === ANALYTICS_GRANULARITY.DAY) return formatYmd(parts);
  if (granularity === ANALYTICS_GRANULARITY.WEEK) {
    const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
    return `${formatYmd(addDays(parts, -((weekday + 6) % 7)))} WEEK`;
  }
  if (granularity === ANALYTICS_GRANULARITY.QUARTER) {
    return `${parts.year}-Q${Math.floor((parts.month - 1) / 3) + 1}`;
  }
  if (granularity === ANALYTICS_GRANULARITY.YEAR) return String(parts.year);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}`;
};

const normalizeGranularity = (value = ANALYTICS_GRANULARITY.MONTH) => {
  const token = String(value || ANALYTICS_GRANULARITY.MONTH).trim().toUpperCase();
  return Object.values(ANALYTICS_GRANULARITY).includes(token) ? token : ANALYTICS_GRANULARITY.MONTH;
};

const normalizeChannel = (value = "") => {
  const token = String(value || "").trim().toUpperCase();
  return Object.values(SALES_CHANNEL).includes(token) ? token : "";
};

const getPath = (target = {}, path = "") =>
  path.split(".").reduce((value, key) => (value === undefined || value === null ? undefined : value[key]), target);

const getDateForDimension = (record = {}, dateDimension = ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE) => {
  const config = getDateDimensionConfig(dateDimension);
  const raw = getPath(record, config.mongoDateField);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const bookingAmount = (booking = {}) =>
  moneyOrZero(booking.pricingSnapshot?.finalPayable ?? booking.amount ?? 0);

const participantCount = (booking = {}) => Number(booking.paxSummary?.total || 0);

const componentMoney = (posting = {}, key = "") => moneyOrZero(posting.components?.[key] ?? 0);

const emptyOperationalBucket = (bucket = "") => ({
  bucket,
  bookingsCount: 0,
  confirmedBookings: 0,
  cancelledBookings: 0,
  participants: 0,
  bookedRevenue: "0"
});

const emptyFinancialBucket = (bucket = "") => ({
  bucket,
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
  netRevenue: "0",
  grossProfit: "0",
  netProfit: "0",
  postingCount: 0,
  bookingContributionPostingCount: 0,
  expensePostingCount: 0,
  missingDirectCostCount: 0,
  unallocatedBusinessUnitCount: 0
});

const buildBookingQuery = ({ range, dateDimension, channel = "", productId = "" } = {}) => {
  const query = {
    ...buildDateDimensionMatch({
      dateDimension,
      range,
      allowed: TREND_OPERATIONAL_DATE_DIMENSIONS
    })
  };
  const normalizedChannel = normalizeChannel(channel);
  if (normalizedChannel) query.salesChannel = normalizedChannel;
  if (productId) query.bokunProductId = normalizeToken(productId);
  return query;
};

const buildFilterBookingQuery = ({ channel = "", productId = "" } = {}) => {
  const query = {};
  const normalizedChannel = normalizeChannel(channel);
  if (normalizedChannel) query.salesChannel = normalizedChannel;
  if (productId) query.bokunProductId = normalizeToken(productId);
  return query;
};

const buildPostingQuery = ({ range, dateDimension, bookingReferences = null, scoped = false } = {}) => {
  const query = {
    accountingScope: ACCOUNTING_SCOPE.BUSINESS,
    status: { $in: COUNTED_FINANCIAL_STATUSES },
    postingType: { $in: scoped ? [POSTING_TYPE.BOOKING_NET_CONTRIBUTION] : FINANCIAL_TREND_POSTING_TYPES },
    ...buildDateDimensionMatch({
      dateDimension,
      range,
      allowed: TREND_FINANCIAL_DATE_DIMENSIONS
    })
  };
  if (bookingReferences) query.sourceReference = { $in: asArray(bookingReferences).filter(Boolean) };
  return query;
};

const normalizeOperationalBucket = (bucket = {}) => ({
  bucket: bucket.bucket,
  bookingsCount: bucket.bookingsCount || 0,
  confirmedBookings: bucket.confirmedBookings || 0,
  cancelledBookings: bucket.cancelledBookings || 0,
  participants: bucket.participants || 0,
  bookedRevenue: toApiNumber(bucket.bookedRevenue),
  averageBookingValue: ratio(toApiNumber(bucket.bookedRevenue), bucket.confirmedBookings || 0),
  averageParticipantsPerBooking: ratio(bucket.participants || 0, bucket.confirmedBookings || 0)
});

const normalizeFinancialBucket = (bucket = {}) => ({
  bucket: bucket.bucket,
  bookedRevenue: toApiNumber(bucket.bookedRevenue),
  invoicedRevenue: toApiNumber(bucket.invoicedRevenue),
  collectedRevenue: toApiNumber(bucket.collectedRevenue),
  refundedAmount: toApiNumber(bucket.refundedAmount),
  providerFees: toApiNumber(bucket.providerFees),
  channelCommission: toApiNumber(bucket.channelCommission),
  directBookingCosts: toApiNumber(bucket.directBookingCosts),
  bookingNetContribution: toApiNumber(bucket.bookingNetContribution),
  otherBusinessIncome: toApiNumber(bucket.otherBusinessIncome),
  operatingExpenses: toApiNumber(bucket.operatingExpenses),
  netRevenue: toApiNumber(bucket.netRevenue),
  grossProfit: toApiNumber(bucket.grossProfit),
  netProfit: toApiNumber(bucket.netProfit),
  profitMargin: ratioPercent(toApiNumber(bucket.netProfit), toApiNumber(sumMoney([bucket.bookedRevenue, bucket.otherBusinessIncome]))),
  postingCount: bucket.postingCount || 0,
  bookingContributionPostingCount: bucket.bookingContributionPostingCount || 0,
  expensePostingCount: bucket.expensePostingCount || 0,
  missingDirectCostCount: bucket.missingDirectCostCount || 0,
  unallocatedBusinessUnitCount: bucket.unallocatedBusinessUnitCount || 0
});

const aggregateOperationalTrend = ({ bookings = [], dateDimension, granularity } = {}) => {
  const buckets = new Map();
  asArray(bookings).forEach((booking) => {
    const date = getDateForDimension(booking, dateDimension);
    if (!date) return;
    const key = bucketKeyForDate(date, granularity);
    if (!buckets.has(key)) buckets.set(key, emptyOperationalBucket(key));
    const bucket = buckets.get(key);
    bucket.bookingsCount += 1;
    if (booking.bookingStatus === "cancelled") bucket.cancelledBookings += 1;
    if (booking.bookingStatus !== "confirmed") return;
    bucket.confirmedBookings += 1;
    bucket.participants += participantCount(booking);
    bucket.bookedRevenue = sumMoney([bucket.bookedRevenue, bookingAmount(booking)]);
  });
  return Array.from(buckets.values())
    .sort((left, right) => String(left.bucket).localeCompare(String(right.bucket)))
    .map(normalizeOperationalBucket);
};

const addFinancialPostingToBucket = (bucket, posting = {}) => {
  bucket.postingCount += 1;
  if (posting.postingType === POSTING_TYPE.BOOKING_NET_CONTRIBUTION) {
    bucket.bookingContributionPostingCount += 1;
    bucket.bookedRevenue = sumMoney([bucket.bookedRevenue, componentMoney(posting, "bookedRevenue")]);
    bucket.invoicedRevenue = sumMoney([bucket.invoicedRevenue, componentMoney(posting, "invoicedRevenue")]);
    bucket.collectedRevenue = sumMoney([bucket.collectedRevenue, componentMoney(posting, "collectedRevenue")]);
    bucket.refundedAmount = sumMoney([bucket.refundedAmount, componentMoney(posting, "refundedAmount")]);
    bucket.providerFees = sumMoney([bucket.providerFees, componentMoney(posting, "providerFees")]);
    bucket.channelCommission = sumMoney([bucket.channelCommission, componentMoney(posting, "channelCommission")]);
    bucket.directBookingCosts = sumMoney([bucket.directBookingCosts, componentMoney(posting, "directBookingCosts")]);
    bucket.bookingNetContribution = sumMoney([bucket.bookingNetContribution, componentMoney(posting, "bookingNetContribution")]);
    if (toDecimal(componentMoney(posting, "directBookingCosts")).isZero() || posting.metadata?.directBookingCostsIncluded === false) {
      bucket.missingDirectCostCount += 1;
    }
  } else if (posting.postingType === POSTING_TYPE.OTHER_BUSINESS_INCOME) {
    bucket.otherBusinessIncome = sumMoney([bucket.otherBusinessIncome, componentMoney(posting, "otherBusinessIncome")]);
  } else if (EXPENSE_POSTING_TYPES.has(posting.postingType)) {
    bucket.expensePostingCount += 1;
    bucket.operatingExpenses = sumMoney([bucket.operatingExpenses, moneyOrZero(posting.baseCurrencyAmount ?? posting.amount)]);
  }
  if (posting.businessUnit === BUSINESS_UNIT.UNALLOCATED) bucket.unallocatedBusinessUnitCount += 1;
};

const finalizeFinancialBucket = (bucket = {}) => {
  bucket.netRevenue = subtract(
    sumMoney([bucket.collectedRevenue, bucket.otherBusinessIncome]),
    sumMoney([bucket.refundedAmount, bucket.providerFees, bucket.channelCommission])
  );
  bucket.grossProfit = subtract(bucket.netRevenue, bucket.directBookingCosts);
  bucket.netProfit = subtract(bucket.grossProfit, bucket.operatingExpenses);
  return normalizeFinancialBucket(bucket);
};

const aggregateFinancialTrend = ({ postings = [], dateDimension, granularity } = {}) => {
  const buckets = new Map();
  asArray(postings).forEach((posting) => {
    const date = getDateForDimension(posting, dateDimension);
    if (!date) return;
    const key = bucketKeyForDate(date, granularity);
    if (!buckets.has(key)) buckets.set(key, emptyFinancialBucket(key));
    addFinancialPostingToBucket(buckets.get(key), posting);
  });
  return Array.from(buckets.values())
    .map(finalizeFinancialBucket)
    .sort((left, right) => String(left.bucket).localeCompare(String(right.bucket)));
};

const sumTrend = (trend = [], key = "") => Number(asArray(trend).reduce((sum, row) => sum + Number(row[key] || 0), 0).toFixed(2));

const normalizeOperationalTotals = (trend = []) => ({
  bookingsCount: sumTrend(trend, "bookingsCount"),
  confirmedBookings: sumTrend(trend, "confirmedBookings"),
  cancelledBookings: sumTrend(trend, "cancelledBookings"),
  participants: sumTrend(trend, "participants"),
  bookedRevenue: sumTrend(trend, "bookedRevenue"),
  averageBookingValue: ratio(sumTrend(trend, "bookedRevenue"), sumTrend(trend, "confirmedBookings")),
  averageParticipantsPerBooking: ratio(sumTrend(trend, "participants"), sumTrend(trend, "confirmedBookings"))
});

const normalizeFinancialTotals = (trend = []) => ({
  bookedRevenue: sumTrend(trend, "bookedRevenue"),
  invoicedRevenue: sumTrend(trend, "invoicedRevenue"),
  collectedRevenue: sumTrend(trend, "collectedRevenue"),
  refundedAmount: sumTrend(trend, "refundedAmount"),
  providerFees: sumTrend(trend, "providerFees"),
  channelCommission: sumTrend(trend, "channelCommission"),
  directBookingCosts: sumTrend(trend, "directBookingCosts"),
  bookingNetContribution: sumTrend(trend, "bookingNetContribution"),
  otherBusinessIncome: sumTrend(trend, "otherBusinessIncome"),
  operatingExpenses: sumTrend(trend, "operatingExpenses"),
  netRevenue: sumTrend(trend, "netRevenue"),
  grossProfit: sumTrend(trend, "grossProfit"),
  netProfit: sumTrend(trend, "netProfit"),
  profitMargin: ratioPercent(sumTrend(trend, "netProfit"), sumTrend(trend, "bookedRevenue") + sumTrend(trend, "otherBusinessIncome")),
  postingCount: sumTrend(trend, "postingCount"),
  bookingContributionPostingCount: sumTrend(trend, "bookingContributionPostingCount"),
  expensePostingCount: sumTrend(trend, "expensePostingCount")
});

const buildCombinedTrend = ({ operationalTrend = [], financialTrend = [] } = {}) => {
  const buckets = new Map();
  asArray(operationalTrend).forEach((row) => {
    buckets.set(row.bucket, {
      bucket: row.bucket,
      confirmedBookings: row.confirmedBookings,
      participants: row.participants,
      operationalBookedRevenue: row.bookedRevenue,
      collectedRevenue: 0,
      refundedAmount: 0,
      grossProfit: 0,
      netProfit: 0
    });
  });
  asArray(financialTrend).forEach((row) => {
    if (!buckets.has(row.bucket)) {
      buckets.set(row.bucket, {
        bucket: row.bucket,
        confirmedBookings: 0,
        participants: 0,
        operationalBookedRevenue: 0,
        collectedRevenue: 0,
        refundedAmount: 0,
        grossProfit: 0,
        netProfit: 0
      });
    }
    const bucket = buckets.get(row.bucket);
    bucket.collectedRevenue = row.collectedRevenue;
    bucket.refundedAmount = row.refundedAmount;
    bucket.grossProfit = row.grossProfit;
    bucket.netProfit = row.netProfit;
  });
  return Array.from(buckets.values()).sort((left, right) => String(left.bucket).localeCompare(String(right.bucket)));
};

const buildDataQuality = ({ bookings = [], postings = [], financialTrend = [], scopedFinancials = false } = {}) => {
  const missingDirectCostCount = financialTrend.reduce((sum, row) => sum + Number(row.missingDirectCostCount || 0), 0);
  const unallocatedBusinessUnitCount = asArray(postings).filter((posting) => posting.businessUnit === BUSINESS_UNIT.UNALLOCATED).length;
  const unknownChannelCount = asArray(bookings).filter((booking) => !normalizeChannel(booking.salesChannel) || booking.salesChannel === SALES_CHANNEL.OTHER).length;
  const missingParticipantCount = asArray(bookings).filter((booking) => booking.bookingStatus === "confirmed" && !participantCount(booking)).length;
  const warnings = [];

  if (missingDirectCostCount > 0) {
    warnings.push({
      code: "DIRECT_BOOKING_COSTS_INCOMPLETE",
      severity: "warning",
      message: "Some trend buckets include booking postings without actual direct booking costs.",
      count: missingDirectCostCount
    });
  }
  if (unallocatedBusinessUnitCount > 0) {
    warnings.push({
      code: "UNALLOCATED_BUSINESS_UNITS",
      severity: "warning",
      message: "Some trend postings are not assigned to a business unit.",
      count: unallocatedBusinessUnitCount
    });
  }
  if (unknownChannelCount > 0) {
    warnings.push({
      code: "UNKNOWN_SALES_CHANNELS",
      severity: "info",
      message: "Some operational trend bookings use OTHER/unknown sales channel mapping.",
      count: unknownChannelCount
    });
  }
  if (missingParticipantCount > 0) {
    warnings.push({
      code: "MISSING_PARTICIPANT_COUNTS",
      severity: "info",
      message: "Some confirmed trend bookings have no participant count.",
      count: missingParticipantCount
    });
  }
  if (scopedFinancials) {
    warnings.push({
      code: "SCOPED_FINANCIALS_EXCLUDE_UNALLOCATED_COMPANY_POSTINGS",
      severity: "info",
      message: "Channel/product trend filters include booking contribution postings only; company-wide income and operating expenses are not allocated to that scope yet.",
      count: 1
    });
  }

  return {
    completeRecords: Math.max(0, asArray(postings).length - missingDirectCostCount - unallocatedBusinessUnitCount),
    incompleteRecords: missingDirectCostCount + unallocatedBusinessUnitCount + missingParticipantCount,
    missingCostRecords: missingDirectCostCount,
    unallocatedBusinessUnits: unallocatedBusinessUnitCount,
    unknownChannels: unknownChannelCount,
    missingParticipantCounts: missingParticipantCount,
    scopedFinancials,
    warnings
  };
};

const compareTrends = ({ currentOperational = {}, previousOperational = {}, currentFinancial = {}, previousFinancial = {} } = {}) => ({
  bookingGrowth: safePercentageChange(currentOperational.confirmedBookings || 0, previousOperational.confirmedBookings || 0),
  participantGrowth: safePercentageChange(currentOperational.participants || 0, previousOperational.participants || 0),
  bookedRevenueGrowth: safePercentageChange(currentOperational.bookedRevenue || 0, previousOperational.bookedRevenue || 0),
  collectedRevenueGrowth: safePercentageChange(currentFinancial.collectedRevenue || 0, previousFinancial.collectedRevenue || 0),
  refundGrowth: safePercentageChange(currentFinancial.refundedAmount || 0, previousFinancial.refundedAmount || 0),
  expenseGrowth: safePercentageChange(currentFinancial.operatingExpenses || 0, previousFinancial.operatingExpenses || 0),
  grossProfitGrowth: safePercentageChange(currentFinancial.grossProfit || 0, previousFinancial.grossProfit || 0),
  netProfitGrowth: safePercentageChange(currentFinancial.netProfit || 0, previousFinancial.netProfit || 0)
});

const createTrendAnalyticsService = ({
  AccountingPostingModel = AccountingPosting,
  BookingModel = Booking,
  now = () => new Date()
} = {}) => {
  const fetchBookings = async ({ range, dateDimension, channel = "", productId = "" }) => {
    const query = buildBookingQuery({ range, dateDimension, channel, productId });
    const result = BookingModel.find(query);
    const rows = result && typeof result.limit === "function"
      ? await leanMaybe(result.limit(20000))
      : await leanMaybe(result);
    return asArray(rows);
  };

  const fetchScopedBookingReferences = async ({ channel = "", productId = "" }) => {
    if (!channel && !productId) return null;
    const result = BookingModel.find(buildFilterBookingQuery({ channel, productId }));
    const rows = result && typeof result.limit === "function"
      ? await leanMaybe(result.limit(50000))
      : await leanMaybe(result);
    return asArray(rows).map((booking) => booking.bookingReference).filter(Boolean);
  };

  const fetchPostings = async ({ range, dateDimension, bookingReferences = null, scoped = false }) =>
    asArray(await leanMaybe(AccountingPostingModel.find(buildPostingQuery({
      range,
      dateDimension,
      bookingReferences,
      scoped
    }))));

  const getRangeTrend = async ({
    range,
    financialDateDimension,
    operationalDateDimension,
    granularity,
    channel = "",
    productId = "",
    bookingReferences = null,
    scopedFinancials = false
  }) => {
    const [bookings, postings] = await Promise.all([
      fetchBookings({ range, dateDimension: operationalDateDimension, channel, productId }),
      fetchPostings({ range, dateDimension: financialDateDimension, bookingReferences, scoped: scopedFinancials })
    ]);
    const operationalTrend = aggregateOperationalTrend({ bookings, dateDimension: operationalDateDimension, granularity });
    const financialTrend = aggregateFinancialTrend({ postings, dateDimension: financialDateDimension, granularity });
    const operationalTotals = normalizeOperationalTotals(operationalTrend);
    const financialTotals = normalizeFinancialTotals(financialTrend);

    return {
      bookings,
      postings,
      operationalTrend,
      financialTrend,
      combinedTrend: buildCombinedTrend({ operationalTrend, financialTrend }),
      operationalTotals,
      financialTotals,
      dataQuality: buildDataQuality({ bookings, postings, financialTrend, scopedFinancials })
    };
  };

  const getTrendAnalytics = async ({
    period = ANALYTICS_PERIOD.THIS_MONTH,
    from = "",
    to = "",
    compare = ANALYTICS_COMPARE_MODE.PREVIOUS_PERIOD,
    compareFrom = "",
    compareTo = "",
    granularity = ANALYTICS_GRANULARITY.MONTH,
    financialDateDimension = ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE,
    operationalDateDimension = ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE,
    channel = "",
    productId = ""
  } = {}) => {
    const currentRange = resolveAnalyticsPeriod({ period, from, to, now: now() });
    const comparison = resolveComparisonPeriod({ currentRange, compare, compareFrom, compareTo });
    const normalizedFinancialDateDimension = normalizeDateDimension(financialDateDimension);
    const normalizedOperationalDateDimension = normalizeDateDimension(operationalDateDimension);
    const normalizedGranularity = normalizeGranularity(granularity);
    const normalizedChannel = normalizeChannel(channel);
    const normalizedProductId = normalizeToken(productId);
    const scopedFinancials = Boolean(normalizedChannel || normalizedProductId);
    const scopedBookingReferences = await fetchScopedBookingReferences({
      channel: normalizedChannel,
      productId: normalizedProductId
    });

    const currentMetrics = await getRangeTrend({
      range: currentRange,
      financialDateDimension: normalizedFinancialDateDimension,
      operationalDateDimension: normalizedOperationalDateDimension,
      granularity: normalizedGranularity,
      channel: normalizedChannel,
      productId: normalizedProductId,
      bookingReferences: scopedBookingReferences,
      scopedFinancials
    });
    const comparisonMetrics = comparison?.range
      ? await getRangeTrend({
          range: comparison.range,
          financialDateDimension: normalizedFinancialDateDimension,
          operationalDateDimension: normalizedOperationalDateDimension,
          granularity: normalizedGranularity,
          channel: normalizedChannel,
          productId: normalizedProductId,
          bookingReferences: scopedBookingReferences,
          scopedFinancials
        })
      : null;
    const growth = comparisonMetrics
      ? compareTrends({
          currentOperational: currentMetrics.operationalTotals,
          previousOperational: comparisonMetrics.operationalTotals,
          currentFinancial: currentMetrics.financialTotals,
          previousFinancial: comparisonMetrics.financialTotals
        })
      : null;

    return {
      report: "TREND_ANALYTICS",
      generatedAt: now().toISOString(),
      period: currentRange,
      comparison: comparison
        ? {
            ...comparison,
            range: comparison.range || null,
            totals: comparisonMetrics
              ? {
                  operational: comparisonMetrics.operationalTotals,
                  financial: comparisonMetrics.financialTotals
                }
              : null
          }
        : null,
      granularity: normalizedGranularity,
      dateDimensions: {
        financial: describeDateDimension(normalizedFinancialDateDimension),
        operational: describeDateDimension(normalizedOperationalDateDimension)
      },
      filters: {
        channel: normalizedChannel,
        productId: normalizedProductId
      },
      sourceOfTruth: {
        operational: "Bokun/local Booking records bucketed by explicit operational date dimension",
        financial: "Business Accounting / AccountingPosting records bucketed by accounting transaction date",
        noSecondAccountingTruth: true
      },
      kpis: {
        bookingGrowth: growth?.bookingGrowth || null,
        participantGrowth: growth?.participantGrowth || null,
        bookedRevenueGrowth: growth?.bookedRevenueGrowth || null,
        collectedRevenueGrowth: growth?.collectedRevenueGrowth || null,
        refundGrowth: growth?.refundGrowth || null,
        expenseGrowth: growth?.expenseGrowth || null,
        grossProfitGrowth: growth?.grossProfitGrowth || null,
        netProfitGrowth: growth?.netProfitGrowth || null
      },
      totals: {
        operational: currentMetrics.operationalTotals,
        financial: currentMetrics.financialTotals
      },
      trends: {
        operational: currentMetrics.operationalTrend,
        financial: currentMetrics.financialTrend,
        combined: currentMetrics.combinedTrend
      },
      dataQuality: currentMetrics.dataQuality,
      drillDown: {
        operationalBookings: {
          route: "/api/bookings",
          filters: {
            fromDate: currentRange.fromIso,
            toDate: currentRange.toIso,
            dateDimension: normalizedOperationalDateDimension,
            channel: normalizedChannel,
            productId: normalizedProductId
          }
        },
        accountingPostings: {
          route: "/api/admin/business-accounting/foundation",
          filters: {
            fromDate: currentRange.fromIso,
            toDate: currentRange.toIso,
            dateDimension: normalizedFinancialDateDimension,
            sourceReferences: scopedBookingReferences || []
          }
        }
      },
      limitations: [
        "Operational trends and financial trends intentionally use separate date dimensions.",
        "Financial trends currently use AccountingPosting.transactionDate only.",
        scopedFinancials
          ? "Channel/product scoped trends include booking contribution postings only; company-wide income and operating expenses are not allocated to scoped dimensions yet."
          : "Company-wide financial trends include counted booking contribution, other business income, and operating expense postings."
      ]
    };
  };

  return {
    getTrendAnalytics
  };
};

const service = createTrendAnalyticsService();

module.exports = {
  ...service,
  createTrendAnalyticsService,
  __testables: {
    aggregateFinancialTrend,
    aggregateOperationalTrend,
    bucketKeyForDate,
    buildCombinedTrend,
    buildDataQuality,
    compareTrends,
    normalizeFinancialTotals,
    normalizeOperationalTotals
  }
};
