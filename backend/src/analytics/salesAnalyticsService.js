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
  toDecimal
} = require("../utils/money");

const SALES_DATE_DIMENSIONS = Object.freeze([
  ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE,
  ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE,
  ANALYTICS_DATE_DIMENSION.BOOKING_CREATED_AT
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

const getPath = (target = {}, path = "") =>
  path.split(".").reduce((value, key) => (value === undefined || value === null ? undefined : value[key]), target);

const getBookingDate = (booking = {}, dateDimension = ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE) => {
  const config = getDateDimensionConfig(dateDimension);
  const raw = getPath(booking, config.mongoDateField);
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const localDate = config.mongoLocalDateField ? getPath(booking, config.mongoLocalDateField) : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(localDate || ""))) {
    const parsed = new Date(`${localDate}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
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

const bookingAmount = (booking = {}) =>
  moneyOrZero(booking.pricingSnapshot?.finalPayable ?? booking.amount ?? 0);

const participantCount = (booking = {}) => Number(booking.paxSummary?.total || 0);

const normalizeBookingForDrillDown = (booking = {}) => ({
  bookingReference: booking.bookingReference || "",
  bokunBookingId: booking.bokunBookingId || "",
  productTitle: booking.productTitle || "",
  bokunProductId: booking.bokunProductId || "",
  optionTitle: booking.optionTitle || "",
  salesChannel: booking.salesChannel || "",
  bookingStatus: booking.bookingStatus || "",
  participantCount: participantCount(booking),
  bookedRevenue: toApiNumber(bookingAmount(booking)),
  currency: booking.currency || booking.pricingSnapshot?.currency || "",
  travelDate: booking.bokunOperationalDates?.travelDate?.localDate || booking.travelDate || ""
});

const componentMoney = (posting = {}, key = "") => moneyOrZero(posting.components?.[key] ?? 0);

const buildBookingQuery = ({ range, dateDimension, channel = "", productId = "" } = {}) => {
  const query = {
    ...buildDateDimensionMatch({
      dateDimension,
      range,
      allowed: SALES_DATE_DIMENSIONS
    })
  };
  const normalizedChannel = normalizeChannel(channel);
  if (normalizedChannel) query.salesChannel = normalizedChannel;
  if (productId) query.bokunProductId = normalizeToken(productId);
  return query;
};

const buildPostingQuery = (bookingReferences = []) => {
  const refs = asArray(bookingReferences).filter(Boolean);
  return {
    accountingScope: ACCOUNTING_SCOPE.BUSINESS,
    status: { $in: COUNTED_FINANCIAL_STATUSES },
    postingType: POSTING_TYPE.BOOKING_NET_CONTRIBUTION,
    sourceReference: { $in: refs }
  };
};

const indexPostingsByBookingReference = (postings = []) =>
  asArray(postings).reduce((map, posting) => {
    if (posting.sourceReference) map.set(posting.sourceReference, posting);
    return map;
  }, new Map());

const aggregateSales = ({ bookings = [], postingsByReference = new Map(), dateDimension, granularity = ANALYTICS_GRANULARITY.MONTH } = {}) => {
  const allBookings = asArray(bookings);
  const confirmedBookings = allBookings.filter((booking) => booking.bookingStatus === "confirmed");
  const confirmedRefs = new Set(confirmedBookings.map((booking) => booking.bookingReference).filter(Boolean));
  const bookedRevenue = sumMoney(confirmedBookings, bookingAmount);
  const collectedRevenue = sumMoney(Array.from(confirmedRefs), (reference) =>
    componentMoney(postingsByReference.get(reference), "collectedRevenue")
  );
  const participants = confirmedBookings.reduce((sum, booking) => sum + participantCount(booking), 0);
  const totalBookings = allBookings.length;
  const confirmedCount = confirmedBookings.length;
  const missingAccountingPostingCount = confirmedBookings.filter((booking) => !postingsByReference.has(booking.bookingReference)).length;
  const unknownChannelCount = allBookings.filter((booking) => !booking.salesChannel || booking.salesChannel === SALES_CHANNEL.OTHER).length;
  const missingParticipantCount = confirmedBookings.filter((booking) => !participantCount(booking)).length;

  const buckets = new Map();
  allBookings.forEach((booking) => {
    const date = getBookingDate(booking, dateDimension);
    if (!date) return;
    const key = bucketKeyForDate(date, granularity);
    if (!buckets.has(key)) {
      buckets.set(key, {
        bucket: key,
        totalBookings: 0,
        confirmedBookings: 0,
        participants: 0,
        bookedRevenue: "0",
        collectedRevenue: "0"
      });
    }
    const bucket = buckets.get(key);
    bucket.totalBookings += 1;
    if (booking.bookingStatus === "confirmed") {
      bucket.confirmedBookings += 1;
      bucket.participants += participantCount(booking);
      bucket.bookedRevenue = sumMoney([bucket.bookedRevenue, bookingAmount(booking)]);
      bucket.collectedRevenue = sumMoney([
        bucket.collectedRevenue,
        componentMoney(postingsByReference.get(booking.bookingReference), "collectedRevenue")
      ]);
    }
  });

  return {
    totalBookings,
    confirmedBookings: confirmedCount,
    participants,
    bookedRevenue,
    collectedRevenue,
    averageBookingValue: ratio(toApiNumber(bookedRevenue), confirmedCount),
    averageParticipantsPerBooking: ratio(participants, confirmedCount),
    missingAccountingPostingCount,
    unknownChannelCount,
    missingParticipantCount,
    trend: Array.from(buckets.values())
      .sort((left, right) => String(left.bucket).localeCompare(String(right.bucket)))
      .map((bucket) => ({
        ...bucket,
        bookedRevenue: toApiNumber(bucket.bookedRevenue),
        collectedRevenue: toApiNumber(bucket.collectedRevenue),
        averageBookingValue: ratio(toApiNumber(bucket.bookedRevenue), bucket.confirmedBookings),
        averageParticipantsPerBooking: ratio(bucket.participants, bucket.confirmedBookings)
      }))
  };
};

const normalizeSalesTotalsForApi = (totals = {}) => ({
  totalBookings: totals.totalBookings || 0,
  confirmedBookings: totals.confirmedBookings || 0,
  participants: totals.participants || 0,
  bookedRevenue: toApiNumber(totals.bookedRevenue),
  collectedRevenue: toApiNumber(totals.collectedRevenue),
  averageBookingValue: totals.averageBookingValue,
  averageParticipantsPerBooking: totals.averageParticipantsPerBooking
});

const buildDataQuality = (totals = {}) => {
  const warnings = [];
  if (totals.missingAccountingPostingCount > 0) {
    warnings.push({
      code: "MISSING_BOOKING_ACCOUNTING_POSTINGS",
      severity: "warning",
      message: "Some confirmed bookings do not yet have Booking Accounting contribution postings, so collected revenue may be incomplete.",
      count: totals.missingAccountingPostingCount
    });
  }
  if (totals.unknownChannelCount > 0) {
    warnings.push({
      code: "UNKNOWN_SALES_CHANNELS",
      severity: "info",
      message: "Some bookings use OTHER/unknown sales channel mapping.",
      count: totals.unknownChannelCount
    });
  }
  if (totals.missingParticipantCount > 0) {
    warnings.push({
      code: "MISSING_PARTICIPANT_COUNTS",
      severity: "info",
      message: "Some confirmed bookings have no participant count.",
      count: totals.missingParticipantCount
    });
  }

  return {
    completeRecords: Math.max(0, totals.confirmedBookings - totals.missingAccountingPostingCount - totals.missingParticipantCount),
    incompleteRecords: totals.missingAccountingPostingCount + totals.missingParticipantCount,
    missingAccountingPostings: totals.missingAccountingPostingCount,
    unknownChannels: totals.unknownChannelCount,
    missingParticipantCounts: totals.missingParticipantCount,
    warnings
  };
};

const compareSales = (current = {}, previous = {}) => ({
  bookingGrowth: safePercentageChange(current.confirmedBookings || 0, previous.confirmedBookings || 0),
  revenueGrowth: safePercentageChange(toApiNumber(current.bookedRevenue), toApiNumber(previous.bookedRevenue)),
  collectedRevenueGrowth: safePercentageChange(toApiNumber(current.collectedRevenue), toApiNumber(previous.collectedRevenue)),
  participantGrowth: safePercentageChange(current.participants || 0, previous.participants || 0)
});

const createSalesAnalyticsService = ({
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

  const getRangeMetrics = async ({ range, dateDimension, granularity, channel = "", productId = "" }) => {
    const bookings = await fetchBookings({ range, dateDimension, channel, productId });
    const postings = await fetchPostingsForBookings(bookings);
    const postingsByReference = indexPostingsByBookingReference(postings);
    const totals = aggregateSales({
      bookings,
      postingsByReference,
      dateDimension,
      granularity
    });

    return {
      bookings,
      postings,
      totals,
      dataQuality: buildDataQuality(totals)
    };
  };

  const getSalesAnalytics = async ({
    period = ANALYTICS_PERIOD.THIS_MONTH,
    from = "",
    to = "",
    compare = ANALYTICS_COMPARE_MODE.PREVIOUS_PERIOD,
    compareFrom = "",
    compareTo = "",
    dateDimension = ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE,
    granularity = ANALYTICS_GRANULARITY.MONTH,
    channel = "",
    productId = ""
  } = {}) => {
    const currentRange = resolveAnalyticsPeriod({ period, from, to, now: now() });
    const comparison = resolveComparisonPeriod({ currentRange, compare, compareFrom, compareTo });
    const normalizedDateDimension = normalizeDateDimension(dateDimension);
    const normalizedGranularity = normalizeGranularity(granularity);
    const normalizedChannel = normalizeChannel(channel);
    const currentMetrics = await getRangeMetrics({
      range: currentRange,
      dateDimension: normalizedDateDimension,
      granularity: normalizedGranularity,
      channel: normalizedChannel,
      productId
    });
    const comparisonMetrics = comparison?.range
      ? await getRangeMetrics({
          range: comparison.range,
          dateDimension: normalizedDateDimension,
          granularity: normalizedGranularity,
          channel: normalizedChannel,
          productId
        })
      : null;
    const comparisonByKpi = comparisonMetrics ? compareSales(currentMetrics.totals, comparisonMetrics.totals) : {};

    return {
      report: "SALES_ANALYTICS",
      generatedAt: now().toISOString(),
      period: currentRange,
      comparison: comparison
        ? {
            ...comparison,
            range: comparison.range || null,
            metrics: comparisonMetrics ? normalizeSalesTotalsForApi(comparisonMetrics.totals) : null
          }
        : null,
      dateDimension: describeDateDimension(normalizedDateDimension),
      granularity: normalizedGranularity,
      filters: {
        channel: normalizedChannel,
        productId: normalizeToken(productId)
      },
      sourceOfTruth: {
        operational: "Confirmed Bokun/local Booking records",
        collectedRevenue: "Business Accounting / AccountingPosting booking contribution rows",
        noSecondAccountingTruth: true
      },
      kpis: {
        totalBookings: {
          value: currentMetrics.totals.totalBookings,
          unit: "count"
        },
        confirmedBookings: {
          value: currentMetrics.totals.confirmedBookings,
          unit: "count",
          comparison: comparisonByKpi.bookingGrowth || null
        },
        participants: {
          value: currentMetrics.totals.participants,
          unit: "count",
          comparison: comparisonByKpi.participantGrowth || null
        },
        bookedRevenue: {
          value: toApiNumber(currentMetrics.totals.bookedRevenue),
          unit: "money",
          comparison: comparisonByKpi.revenueGrowth || null,
          source: "Booking pricing snapshot"
        },
        collectedRevenue: {
          value: toApiNumber(currentMetrics.totals.collectedRevenue),
          unit: "money",
          comparison: comparisonByKpi.collectedRevenueGrowth || null,
          source: "AccountingPosting.components.collectedRevenue"
        },
        averageBookingValue: {
          value: currentMetrics.totals.averageBookingValue,
          unit: "money"
        },
        averageParticipantsPerBooking: {
          value: currentMetrics.totals.averageParticipantsPerBooking,
          unit: "count"
        }
      },
      charts: {
        bookingsOverTime: currentMetrics.totals.trend.map((row) => ({
          bucket: row.bucket,
          totalBookings: row.totalBookings,
          confirmedBookings: row.confirmedBookings
        })),
        revenueOverTime: currentMetrics.totals.trend.map((row) => ({
          bucket: row.bucket,
          bookedRevenue: row.bookedRevenue,
          collectedRevenue: row.collectedRevenue
        })),
        averageBookingValueTrend: currentMetrics.totals.trend.map((row) => ({
          bucket: row.bucket,
          averageBookingValue: row.averageBookingValue
        })),
        participantsTrend: currentMetrics.totals.trend.map((row) => ({
          bucket: row.bucket,
          participants: row.participants,
          averageParticipantsPerBooking: row.averageParticipantsPerBooking
        }))
      },
      totals: normalizeSalesTotalsForApi(currentMetrics.totals),
      dataQuality: currentMetrics.dataQuality,
      drillDown: {
        bookings: {
          route: "/api/bookings",
          filters: {
            fromDate: currentRange.fromIso,
            toDate: currentRange.toIso,
            dateDimension: normalizedDateDimension,
            channel: normalizedChannel,
            productId: normalizeToken(productId)
          }
        },
        accountingPostings: {
          route: "/api/admin/business-accounting/foundation",
          filters: {
            sourceReferences: currentMetrics.bookings.map((booking) => booking.bookingReference).filter(Boolean)
          }
        }
      },
      sample: {
        bookings: currentMetrics.bookings.slice(0, 10).map(normalizeBookingForDrillDown)
      },
      limitations: [
        "Booked revenue uses the immutable booking pricing snapshot for confirmed bookings.",
        "Collected revenue is linked from Booking Accounting contribution postings; missing postings are reported as data-quality warnings.",
        "Sales analytics uses one explicit operational date dimension and does not silently switch to payment or accounting dates."
      ]
    };
  };

  return {
    getSalesAnalytics
  };
};

const service = createSalesAnalyticsService();

module.exports = {
  ...service,
  createSalesAnalyticsService,
  __testables: {
    aggregateSales,
    bucketKeyForDate,
    buildDataQuality,
    buildBookingQuery,
    buildPostingQuery,
    compareSales,
    normalizeSalesTotalsForApi
  }
};
