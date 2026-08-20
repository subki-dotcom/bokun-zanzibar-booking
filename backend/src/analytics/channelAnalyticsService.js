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

const CHANNEL_DATE_DIMENSIONS = Object.freeze([
  ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE,
  ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE,
  ANALYTICS_DATE_DIMENSION.BOOKING_CREATED_AT
]);

const CHANNEL_RANKING = Object.freeze({
  BEST_BY_BOOKINGS: "BEST_BY_BOOKINGS",
  BEST_BY_PARTICIPANTS: "BEST_BY_PARTICIPANTS",
  HIGHEST_BOOKED_REVENUE: "HIGHEST_BOOKED_REVENUE",
  HIGHEST_COLLECTED_REVENUE: "HIGHEST_COLLECTED_REVENUE",
  HIGHEST_GROSS_PROFIT: "HIGHEST_GROSS_PROFIT",
  HIGHEST_NET_PROFIT: "HIGHEST_NET_PROFIT",
  HIGHEST_MARGIN: "HIGHEST_MARGIN",
  LOWEST_MARGIN: "LOWEST_MARGIN",
  HIGHEST_COMMISSION_COST: "HIGHEST_COMMISSION_COST",
  HIGHEST_REFUND_RATE: "HIGHEST_REFUND_RATE",
  HIGHEST_CANCELLATION_RATE: "HIGHEST_CANCELLATION_RATE",
  LOSS_MAKING: "LOSS_MAKING"
});

const CHANNEL_CLASSIFICATION = Object.freeze({
  PROFIT_LEADER: "PROFIT_LEADER",
  HIGH_VOLUME_LOW_MARGIN: "HIGH_VOLUME_LOW_MARGIN",
  NICHE_PROFITABLE: "NICHE_PROFITABLE",
  NEEDS_REVIEW: "NEEDS_REVIEW"
});

const CHANNEL_LABELS = Object.freeze({
  [SALES_CHANNEL.DIRECT_WEBSITE]: "Direct Website",
  [SALES_CHANNEL.VIATOR]: "Viator",
  [SALES_CHANNEL.GETYOURGUIDE]: "GetYourGuide",
  [SALES_CHANNEL.BOKUN_MARKETPLACE]: "Bokun Marketplace",
  [SALES_CHANNEL.AGENT]: "Agent",
  [SALES_CHANNEL.B2B]: "B2B",
  [SALES_CHANNEL.HOTEL]: "Hotel",
  [SALES_CHANNEL.WHATSAPP]: "WhatsApp",
  [SALES_CHANNEL.WALK_IN]: "Walk In",
  [SALES_CHANNEL.TOURHQ]: "TourHQ",
  [SALES_CHANNEL.AIRBNB]: "Airbnb",
  [SALES_CHANNEL.OTHER]: "Other / Unknown"
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

const channelKeyForBooking = (booking = {}) =>
  normalizeChannel(booking.salesChannel) || SALES_CHANNEL.OTHER;

const bookingAmount = (booking = {}) =>
  moneyOrZero(booking.pricingSnapshot?.finalPayable ?? booking.amount ?? 0);

const participantCount = (booking = {}) => Number(booking.paxSummary?.total || 0);

const componentMoney = (posting = {}, key = "") => moneyOrZero(posting.components?.[key] ?? 0);

const isConfirmed = (booking = {}) => booking.bookingStatus === "confirmed";
const isCancelled = (booking = {}) => booking.bookingStatus === "cancelled";

const buildBookingQuery = ({ range, dateDimension, channel = "", productId = "" } = {}) => {
  const query = {
    ...buildDateDimensionMatch({
      dateDimension,
      range,
      allowed: CHANNEL_DATE_DIMENSIONS
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

const emptyChannelAccumulator = (channel = SALES_CHANNEL.OTHER) => ({
  channel,
  label: CHANNEL_LABELS[channel] || channel,
  bookingsCount: 0,
  confirmedBookings: 0,
  cancelledBookings: 0,
  participants: 0,
  productsCount: new Set(),
  bookedRevenue: "0",
  collectedRevenue: "0",
  refunds: "0",
  providerFees: "0",
  channelCommission: "0",
  directCosts: "0",
  allocatedOperatingExpense: "0",
  grossProfit: "0",
  netProfit: "0",
  bookingReferences: [],
  productIds: new Set(),
  missingAccountingPostingCount: 0,
  missingCostRecords: 0,
  unknownChannelCount: 0
});

function classifyChannel({ bookedRevenue = 0, netProfit = 0, profitMargin = null, thresholds = {} } = {}) {
  const highSales = bookedRevenue > 0 && bookedRevenue >= Number(thresholds.averageBookedRevenue || 0);
  const highProfit = netProfit > 0 && profitMargin !== null && profitMargin >= Number(thresholds.averageProfitMargin || 0);
  if (highSales && highProfit) {
    return {
      code: CHANNEL_CLASSIFICATION.PROFIT_LEADER,
      label: "High sales + high net profit",
      reason: "This channel is above the current channel average for sales and profit margin."
    };
  }
  if (highSales && !highProfit) {
    return {
      code: CHANNEL_CLASSIFICATION.HIGH_VOLUME_LOW_MARGIN,
      label: "High sales + low margin",
      reason: "This channel brings volume, but fees, commissions, refunds or direct costs reduce profit."
    };
  }
  if (!highSales && highProfit) {
    return {
      code: CHANNEL_CLASSIFICATION.NICHE_PROFITABLE,
      label: "Lower sales + strong margin",
      reason: "This channel is below average sales volume but has above-average profit margin."
    };
  }
  return {
    code: CHANNEL_CLASSIFICATION.NEEDS_REVIEW,
    label: "Needs review",
    reason: "This channel has below-average sales and profit margin, or profit data is incomplete."
  };
}

const buildThresholds = (channelAccumulators = []) => {
  const rows = asArray(channelAccumulators).map((channel) => {
    const netRevenue = subtract(
      subtract(subtract(channel.collectedRevenue, channel.refunds), channel.providerFees),
      channel.channelCommission
    );
    const grossProfit = subtract(netRevenue, channel.directCosts);
    const netProfit = subtract(grossProfit, channel.allocatedOperatingExpense);
    return {
      bookedRevenue: toApiNumber(channel.bookedRevenue),
      profitMargin: ratioPercent(toApiNumber(netProfit), toApiNumber(channel.bookedRevenue))
    };
  });
  const withRevenue = rows.filter((row) => row.bookedRevenue > 0);
  const withMargin = rows.filter((row) => row.profitMargin !== null);
  return {
    averageBookedRevenue: withRevenue.length
      ? ratio(withRevenue.reduce((sum, row) => sum + row.bookedRevenue, 0), withRevenue.length)
      : 0,
    averageProfitMargin: withMargin.length
      ? ratio(withMargin.reduce((sum, row) => sum + row.profitMargin, 0), withMargin.length, 1)
      : 0,
    method: "Relative to current filtered channel average"
  };
};

const finalizeChannel = (channel = {}, comparison = null, totalsForShare = {}, thresholds = {}) => {
  const netRevenue = subtract(
    subtract(subtract(channel.collectedRevenue, channel.refunds), channel.providerFees),
    channel.channelCommission
  );
  const grossProfit = subtract(netRevenue, channel.directCosts);
  const netProfit = subtract(grossProfit, channel.allocatedOperatingExpense);
  const bookedRevenueNumber = toApiNumber(channel.bookedRevenue);
  const collectedRevenueNumber = toApiNumber(channel.collectedRevenue);
  const netProfitNumber = toApiNumber(netProfit);
  const confirmedBookings = channel.confirmedBookings || 0;
  const profitMargin = ratioPercent(netProfitNumber, bookedRevenueNumber);
  const refundRate = ratioPercent(toApiNumber(channel.refunds), collectedRevenueNumber);
  const cancellationRate = ratioPercent(channel.cancelledBookings, channel.bookingsCount);
  const classification = classifyChannel({
    bookedRevenue: bookedRevenueNumber,
    netProfit: netProfitNumber,
    profitMargin,
    thresholds
  });

  return {
    channel: channel.channel,
    label: channel.label,
    bookingsCount: channel.bookingsCount,
    confirmedBookings,
    cancelledBookings: channel.cancelledBookings,
    participants: channel.participants,
    productsCount: channel.productsCount.size,
    bookedRevenue: bookedRevenueNumber,
    collectedRevenue: collectedRevenueNumber,
    refunds: toApiNumber(channel.refunds),
    providerFees: toApiNumber(channel.providerFees),
    channelCommission: toApiNumber(channel.channelCommission),
    directCosts: toApiNumber(channel.directCosts),
    allocatedOperatingExpense: toApiNumber(channel.allocatedOperatingExpense),
    netRevenue: toApiNumber(netRevenue),
    grossProfit: toApiNumber(grossProfit),
    netProfit: netProfitNumber,
    profitMargin,
    averageBookingValue: ratio(bookedRevenueNumber, confirmedBookings),
    averageProfitPerBooking: ratio(netProfitNumber, confirmedBookings),
    cancellationRate,
    refundRate,
    refundRateBasis: "refundedAmount/collectedRevenue",
    revenueShare: ratioPercent(bookedRevenueNumber, totalsForShare.bookedRevenue),
    netProfitShare: ratioPercent(netProfitNumber, totalsForShare.netProfit),
    classification,
    growth: comparison
      ? {
          bookings: safePercentageChange(confirmedBookings, comparison.confirmedBookings),
          bookedRevenue: safePercentageChange(bookedRevenueNumber, comparison.bookedRevenue),
          netProfit: safePercentageChange(netProfitNumber, comparison.netProfit)
        }
      : null,
    dataQuality: {
      missingAccountingPostings: channel.missingAccountingPostingCount,
      missingCostRecords: channel.missingCostRecords,
      unknownChannels: channel.unknownChannelCount
    },
    drillDown: {
      bookingReferences: channel.bookingReferences,
      productIds: Array.from(channel.productIds).sort()
    }
  };
};

const summarizeForRanking = (channel = {}) => ({
  channel: channel.channel,
  label: channel.label,
  confirmedBookings: channel.confirmedBookings,
  participants: channel.participants,
  bookedRevenue: channel.bookedRevenue,
  collectedRevenue: channel.collectedRevenue,
  grossProfit: channel.grossProfit,
  netProfit: channel.netProfit,
  profitMargin: channel.profitMargin,
  channelCommission: channel.channelCommission,
  cancellationRate: channel.cancellationRate,
  refundRate: channel.refundRate,
  classification: channel.classification?.code || ""
});

const topBy = (channels = [], metric, { ascending = false, positiveOnly = false } = {}) =>
  asArray(channels)
    .filter((channel) => !positiveOnly || Number(channel[metric] || 0) > 0)
    .filter((channel) => channel[metric] !== null && channel[metric] !== undefined)
    .sort((left, right) => ascending
      ? Number(left[metric] || 0) - Number(right[metric] || 0)
      : Number(right[metric] || 0) - Number(left[metric] || 0))
    .slice(0, 10)
    .map(summarizeForRanking);

const buildRankings = (channels = []) => ({
  [CHANNEL_RANKING.BEST_BY_BOOKINGS]: topBy(channels, "confirmedBookings", { positiveOnly: true }),
  [CHANNEL_RANKING.BEST_BY_PARTICIPANTS]: topBy(channels, "participants", { positiveOnly: true }),
  [CHANNEL_RANKING.HIGHEST_BOOKED_REVENUE]: topBy(channels, "bookedRevenue", { positiveOnly: true }),
  [CHANNEL_RANKING.HIGHEST_COLLECTED_REVENUE]: topBy(channels, "collectedRevenue", { positiveOnly: true }),
  [CHANNEL_RANKING.HIGHEST_GROSS_PROFIT]: topBy(channels, "grossProfit"),
  [CHANNEL_RANKING.HIGHEST_NET_PROFIT]: topBy(channels, "netProfit"),
  [CHANNEL_RANKING.HIGHEST_MARGIN]: topBy(channels.filter((channel) => channel.profitMargin !== null), "profitMargin"),
  [CHANNEL_RANKING.LOWEST_MARGIN]: topBy(channels.filter((channel) => channel.profitMargin !== null), "profitMargin", { ascending: true }),
  [CHANNEL_RANKING.HIGHEST_COMMISSION_COST]: topBy(channels, "channelCommission", { positiveOnly: true }),
  [CHANNEL_RANKING.HIGHEST_REFUND_RATE]: topBy(channels.filter((channel) => channel.refundRate !== null), "refundRate"),
  [CHANNEL_RANKING.HIGHEST_CANCELLATION_RATE]: topBy(channels.filter((channel) => channel.cancellationRate !== null), "cancellationRate"),
  [CHANNEL_RANKING.LOSS_MAKING]: channels
    .filter((channel) => channel.netProfit < 0)
    .sort((left, right) => left.netProfit - right.netProfit)
    .slice(0, 10)
    .map(summarizeForRanking)
});

const aggregateChannels = ({ bookings = [], postingsByReference = new Map(), comparisonByChannel = new Map() } = {}) => {
  const channels = new Map();
  asArray(bookings).forEach((booking) => {
    const key = channelKeyForBooking(booking);
    if (!channels.has(key)) channels.set(key, emptyChannelAccumulator(key));
    const channel = channels.get(key);
    const posting = postingsByReference.get(booking.bookingReference);
    channel.bookingsCount += 1;
    channel.bookingReferences.push(booking.bookingReference);
    if (!normalizeChannel(booking.salesChannel) || booking.salesChannel === SALES_CHANNEL.OTHER) {
      channel.unknownChannelCount += 1;
    }
    if (booking.bokunProductId) {
      channel.productsCount.add(booking.bokunProductId);
      channel.productIds.add(booking.bokunProductId);
    }
    if (isCancelled(booking)) channel.cancelledBookings += 1;
    if (!isConfirmed(booking)) return;

    channel.confirmedBookings += 1;
    channel.participants += participantCount(booking);
    channel.bookedRevenue = sumMoney([channel.bookedRevenue, bookingAmount(booking)]);

    if (!posting) {
      channel.missingAccountingPostingCount += 1;
      return;
    }

    const directCosts = componentMoney(posting, "directBookingCosts");
    channel.collectedRevenue = sumMoney([channel.collectedRevenue, componentMoney(posting, "collectedRevenue")]);
    channel.refunds = sumMoney([channel.refunds, componentMoney(posting, "refundedAmount")]);
    channel.providerFees = sumMoney([channel.providerFees, componentMoney(posting, "providerFees")]);
    channel.channelCommission = sumMoney([channel.channelCommission, componentMoney(posting, "channelCommission")]);
    channel.directCosts = sumMoney([channel.directCosts, directCosts]);
    channel.netProfit = sumMoney([channel.netProfit, componentMoney(posting, "bookingNetContribution")]);
    if (toDecimal(directCosts).isZero() || posting.metadata?.directBookingCostsIncluded === false) {
      channel.missingCostRecords += 1;
    }
  });

  const accumulators = Array.from(channels.values());
  const thresholds = buildThresholds(accumulators);
  const preliminary = accumulators.map((channel) => {
    const netRevenue = subtract(
      subtract(subtract(channel.collectedRevenue, channel.refunds), channel.providerFees),
      channel.channelCommission
    );
    const grossProfit = subtract(netRevenue, channel.directCosts);
    const netProfit = subtract(grossProfit, channel.allocatedOperatingExpense);
    return {
      bookedRevenue: toApiNumber(channel.bookedRevenue),
      netProfit: toApiNumber(netProfit)
    };
  });
  const totalsForShare = {
    bookedRevenue: preliminary.reduce((sum, row) => sum + row.bookedRevenue, 0),
    netProfit: preliminary.reduce((sum, row) => sum + row.netProfit, 0)
  };

  return accumulators
    .map((channel) => finalizeChannel(channel, comparisonByChannel.get(channel.channel) || null, totalsForShare, thresholds))
    .sort((left, right) => right.netProfit - left.netProfit || right.bookedRevenue - left.bookedRevenue);
};

const normalizeTotals = (channels = []) => ({
  channelsCount: channels.length,
  bookingsCount: channels.reduce((sum, channel) => sum + channel.bookingsCount, 0),
  confirmedBookings: channels.reduce((sum, channel) => sum + channel.confirmedBookings, 0),
  cancelledBookings: channels.reduce((sum, channel) => sum + channel.cancelledBookings, 0),
  participants: channels.reduce((sum, channel) => sum + channel.participants, 0),
  bookedRevenue: Number(channels.reduce((sum, channel) => sum + channel.bookedRevenue, 0).toFixed(2)),
  collectedRevenue: Number(channels.reduce((sum, channel) => sum + channel.collectedRevenue, 0).toFixed(2)),
  refunds: Number(channels.reduce((sum, channel) => sum + channel.refunds, 0).toFixed(2)),
  providerFees: Number(channels.reduce((sum, channel) => sum + channel.providerFees, 0).toFixed(2)),
  channelCommission: Number(channels.reduce((sum, channel) => sum + channel.channelCommission, 0).toFixed(2)),
  directCosts: Number(channels.reduce((sum, channel) => sum + channel.directCosts, 0).toFixed(2)),
  allocatedOperatingExpense: Number(channels.reduce((sum, channel) => sum + channel.allocatedOperatingExpense, 0).toFixed(2)),
  grossProfit: Number(channels.reduce((sum, channel) => sum + channel.grossProfit, 0).toFixed(2)),
  netProfit: Number(channels.reduce((sum, channel) => sum + channel.netProfit, 0).toFixed(2)),
  averageBookingValue: ratio(
    channels.reduce((sum, channel) => sum + channel.bookedRevenue, 0),
    channels.reduce((sum, channel) => sum + channel.confirmedBookings, 0)
  ),
  profitMargin: ratioPercent(
    channels.reduce((sum, channel) => sum + channel.netProfit, 0),
    channels.reduce((sum, channel) => sum + channel.bookedRevenue, 0)
  ),
  cancellationRate: ratioPercent(
    channels.reduce((sum, channel) => sum + channel.cancelledBookings, 0),
    channels.reduce((sum, channel) => sum + channel.bookingsCount, 0)
  ),
  refundRate: ratioPercent(
    channels.reduce((sum, channel) => sum + channel.refunds, 0),
    channels.reduce((sum, channel) => sum + channel.collectedRevenue, 0)
  )
});

const buildDataQuality = (channels = [], bookings = []) => {
  const missingAccountingPostings = channels.reduce((sum, channel) => sum + channel.dataQuality.missingAccountingPostings, 0);
  const missingCostRecords = channels.reduce((sum, channel) => sum + channel.dataQuality.missingCostRecords, 0);
  const unknownChannels = asArray(bookings).filter((booking) => !normalizeChannel(booking.salesChannel) || booking.salesChannel === SALES_CHANNEL.OTHER).length;
  const warnings = [];
  if (missingAccountingPostings > 0) {
    warnings.push({
      code: "MISSING_BOOKING_ACCOUNTING_POSTINGS",
      severity: "warning",
      message: "Some confirmed channel bookings do not yet have Booking Accounting contribution postings.",
      count: missingAccountingPostings
    });
  }
  if (missingCostRecords > 0) {
    warnings.push({
      code: "DIRECT_CHANNEL_COSTS_INCOMPLETE",
      severity: "warning",
      message: "Some channel bookings do not include actual direct costs yet, so channel profit may be overstated.",
      count: missingCostRecords
    });
  }
  if (unknownChannels > 0) {
    warnings.push({
      code: "UNKNOWN_SALES_CHANNELS",
      severity: "info",
      message: "Some bookings use OTHER/unknown sales channel mapping.",
      count: unknownChannels
    });
  }
  return {
    completeRecords: Math.max(0, channels.reduce((sum, channel) => sum + channel.confirmedBookings, 0) - missingAccountingPostings - missingCostRecords),
    incompleteRecords: missingAccountingPostings + missingCostRecords + unknownChannels,
    missingAccountingPostings,
    missingCostRecords,
    unknownChannels,
    warnings
  };
};

const compareChannelMetrics = (channels = []) =>
  asArray(channels).reduce((map, channel) => {
    map.set(channel.channel, channel);
    return map;
  }, new Map());

const createChannelAnalyticsService = ({
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

  const getRangeChannels = async ({ range, dateDimension, channel = "", productId = "", comparisonByChannel = new Map() }) => {
    const bookings = await fetchBookings({ range, dateDimension, channel, productId });
    const postings = await fetchPostingsForBookings(bookings);
    const postingsByReference = indexPostingsByBookingReference(postings);
    const channels = aggregateChannels({ bookings, postingsByReference, comparisonByChannel });
    return {
      bookings,
      postings,
      channels,
      totals: normalizeTotals(channels),
      dataQuality: buildDataQuality(channels, bookings)
    };
  };

  const getChannelAnalytics = async ({
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
    let comparisonByChannel = new Map();

    if (comparison?.range) {
      comparisonMetrics = await getRangeChannels({
        range: comparison.range,
        dateDimension: normalizedDateDimension,
        channel: normalizedChannel,
        productId: normalizedProductId
      });
      comparisonByChannel = compareChannelMetrics(comparisonMetrics.channels);
    }

    const currentMetrics = await getRangeChannels({
      range: currentRange,
      dateDimension: normalizedDateDimension,
      channel: normalizedChannel,
      productId: normalizedProductId,
      comparisonByChannel
    });
    const rankings = buildRankings(currentMetrics.channels);

    return {
      report: "CHANNEL_ANALYTICS",
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
        operational: "Confirmed/cancelled Bokun/local Booking records grouped by normalized salesChannel",
        financial: "Business Accounting / AccountingPosting booking contribution rows",
        noSecondAccountingTruth: true
      },
      answers: {
        mostNetProfitableChannel: rankings[CHANNEL_RANKING.HIGHEST_NET_PROFIT][0] || null,
        highestSalesChannel: rankings[CHANNEL_RANKING.HIGHEST_BOOKED_REVENUE][0] || null,
        highestMarginChannel: rankings[CHANNEL_RANKING.HIGHEST_MARGIN][0] || null
      },
      totals: currentMetrics.totals,
      rankings,
      channelMix: currentMetrics.channels.map((row) => ({
        channel: row.channel,
        label: row.label,
        confirmedBookings: row.confirmedBookings,
        bookedRevenue: row.bookedRevenue,
        netProfit: row.netProfit,
        revenueShare: row.revenueShare,
        netProfitShare: row.netProfitShare,
        classification: row.classification
      })),
      channels: currentMetrics.channels,
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
        "Channel sales use immutable booking pricing snapshots for confirmed bookings.",
        "Channel profit uses Booking Accounting contribution postings; missing postings and missing direct costs are reported as data-quality warnings.",
        "Allocated operating expenses by channel are not available yet, so channel netProfit currently equals booking-level net contribution after refunds, provider fees, channel commission and direct costs."
      ]
    };
  };

  return {
    getChannelAnalytics
  };
};

const service = createChannelAnalyticsService();

module.exports = {
  ...service,
  CHANNEL_CLASSIFICATION,
  CHANNEL_RANKING,
  createChannelAnalyticsService,
  __testables: {
    aggregateChannels,
    buildDataQuality,
    buildRankings,
    classifyChannel,
    normalizeTotals
  }
};
