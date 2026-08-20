const AccountingPosting = require("../models/AccountingPosting");
const Booking = require("../models/Booking");
const {
  ACCOUNTING_SCOPE,
  BUSINESS_UNIT,
  COUNTED_FINANCIAL_STATUSES,
  POSTING_TYPE
} = require("../accounting/constants");
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

const EXECUTIVE_FINANCIAL_DATE_DIMENSIONS = Object.freeze([
  ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE
]);

const EXECUTIVE_OPERATIONAL_DATE_DIMENSIONS = Object.freeze([
  ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE,
  ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE,
  ANALYTICS_DATE_DIMENSION.BOOKING_CREATED_AT
]);

const EXPENSE_POSTING_TYPES = new Set([
  POSTING_TYPE.OPERATING_EXPENSE,
  POSTING_TYPE.PAYROLL_EXPENSE,
  POSTING_TYPE.OTHER_COMPANY_EXPENSE
]);

const DEFAULT_UNSUPPORTED_KPIS = Object.freeze({
  cashPosition: "CASH_MOVEMENT_MODEL_NOT_AVAILABLE",
  netCashFlow: "CASH_MOVEMENT_MODEL_NOT_AVAILABLE",
  accountsReceivable: "RECEIVABLE_MODEL_NOT_AVAILABLE",
  accountsPayable: "PAYABLE_MODEL_NOT_AVAILABLE"
});

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

const componentMoney = (posting = {}, key = "") => moneyOrZero(posting.components?.[key] ?? 0);

const sumMoney = (rows = [], mapper = (row) => row) =>
  rows.reduce((sum, row) => sum.plus(toDecimal(mapper(row) || 0)), new Decimal(0)).toFixed();

const ratioPercent = (numerator = 0, denominator = 0) => {
  const top = toDecimal(numerator || 0);
  const bottom = toDecimal(denominator || 0);
  if (!bottom.greaterThan(0)) {
    return {
      value: null,
      valid: false,
      reason: "DENOMINATOR_NOT_POSITIVE"
    };
  }
  return {
    value: Number(top.dividedBy(bottom).times(100).toDecimalPlaces(1).toFixed()),
    valid: true,
    reason: ""
  };
};

const createKpi = ({ value, unit = "money", comparison = null, source = "Business Accounting", supported = true, reason = "" }) => ({
  value,
  unit,
  comparison,
  source,
  supported,
  reason
});

const unsupportedKpi = (reason) =>
  createKpi({
    value: null,
    unit: "money",
    supported: false,
    reason,
    source: "Not available in current accounting foundation"
  });

const normalizeBookingForApi = (booking = {}) => ({
  bookingReference: booking.bookingReference || "",
  bokunBookingId: booking.bokunBookingId || "",
  productTitle: booking.productTitle || "",
  salesChannel: booking.salesChannel || "",
  bookingStatus: booking.bookingStatus || "",
  participantCount: Number(booking.paxSummary?.total || 0),
  travelDate: booking.bokunOperationalDates?.travelDate?.localDate || booking.travelDate || ""
});

const buildQueryForRange = ({ range, dateDimension, allowed }) => ({
  accountingScope: ACCOUNTING_SCOPE.BUSINESS,
  status: { $in: COUNTED_FINANCIAL_STATUSES },
  ...buildDateDimensionMatch({ dateDimension, range, allowed })
});

const buildOperationalBookingQuery = ({ range, dateDimension }) => ({
  bookingStatus: "confirmed",
  ...buildDateDimensionMatch({
    dateDimension,
    range,
    allowed: EXECUTIVE_OPERATIONAL_DATE_DIMENSIONS
  })
});

const aggregatePostings = (postings = []) => {
  const counted = asArray(postings);
  const bookingRows = counted.filter((posting) => posting.postingType === POSTING_TYPE.BOOKING_NET_CONTRIBUTION);
  const otherIncomeRows = counted.filter((posting) => posting.postingType === POSTING_TYPE.OTHER_BUSINESS_INCOME);
  const expenseRows = counted.filter((posting) => EXPENSE_POSTING_TYPES.has(posting.postingType));

  const bookedRevenue = sumMoney(bookingRows, (posting) => componentMoney(posting, "bookedRevenue"));
  const invoicedRevenue = sumMoney(bookingRows, (posting) => componentMoney(posting, "invoicedRevenue"));
  const collectedRevenue = sumMoney(bookingRows, (posting) => componentMoney(posting, "collectedRevenue"));
  const refundedAmount = sumMoney(bookingRows, (posting) => componentMoney(posting, "refundedAmount"));
  const providerFees = sumMoney(bookingRows, (posting) => componentMoney(posting, "providerFees"));
  const channelCommission = sumMoney(bookingRows, (posting) => componentMoney(posting, "channelCommission"));
  const directBookingCosts = sumMoney(bookingRows, (posting) => componentMoney(posting, "directBookingCosts"));
  const bookingNetContribution = sumMoney(bookingRows, (posting) => componentMoney(posting, "bookingNetContribution"));
  const otherBusinessIncome = sumMoney(otherIncomeRows, (posting) => componentMoney(posting, "otherBusinessIncome"));
  const operatingExpenses = sumMoney(expenseRows, (posting) => moneyOrZero(posting.baseCurrencyAmount ?? posting.amount));
  const netRevenue = subtract(
    sumMoney([collectedRevenue, otherBusinessIncome]),
    sumMoney([refundedAmount, providerFees, channelCommission])
  );
  const grossProfit = subtract(netRevenue, directBookingCosts);
  const netProfit = subtract(grossProfit, operatingExpenses);
  const revenue = sumMoney([bookedRevenue, otherBusinessIncome]);
  const profitMargin = ratioPercent(netProfit, revenue);

  return {
    revenue,
    bookedRevenue,
    invoicedRevenue,
    collectedRevenue,
    refundedAmount,
    providerFees,
    channelCommission,
    directBookingCosts,
    bookingNetContribution,
    otherBusinessIncome,
    netRevenue,
    grossProfit,
    operatingExpenses,
    netProfit,
    profitMargin,
    postingCount: counted.length,
    bookingContributionPostingCount: bookingRows.length,
    otherIncomePostingCount: otherIncomeRows.length,
    expensePostingCount: expenseRows.length,
    unallocatedBusinessUnitCount: counted.filter((posting) => posting.businessUnit === BUSINESS_UNIT.UNALLOCATED).length,
    missingDirectCostCount: bookingRows.filter((posting) => {
      const value = toDecimal(componentMoney(posting, "directBookingCosts"));
      return value.isZero() || posting.metadata?.directBookingCostsIncluded === false;
    }).length
  };
};

const normalizeTotalsForApi = (totals = {}) => ({
  revenue: toApiNumber(totals.revenue),
  bookedRevenue: toApiNumber(totals.bookedRevenue),
  invoicedRevenue: toApiNumber(totals.invoicedRevenue),
  collectedRevenue: toApiNumber(totals.collectedRevenue),
  refundedAmount: toApiNumber(totals.refundedAmount),
  providerFees: toApiNumber(totals.providerFees),
  channelCommission: toApiNumber(totals.channelCommission),
  directBookingCosts: toApiNumber(totals.directBookingCosts),
  bookingNetContribution: toApiNumber(totals.bookingNetContribution),
  otherBusinessIncome: toApiNumber(totals.otherBusinessIncome),
  netRevenue: toApiNumber(totals.netRevenue),
  grossProfit: toApiNumber(totals.grossProfit),
  operatingExpenses: toApiNumber(totals.operatingExpenses),
  netProfit: toApiNumber(totals.netProfit),
  profitMargin: totals.profitMargin,
  postingCount: totals.postingCount || 0,
  bookingContributionPostingCount: totals.bookingContributionPostingCount || 0,
  otherIncomePostingCount: totals.otherIncomePostingCount || 0,
  expensePostingCount: totals.expensePostingCount || 0
});

const buildDataQuality = ({ totals, operationalBookings = [], unknownChannelCount = 0 }) => {
  const warnings = [];
  if (totals.missingDirectCostCount > 0) {
    warnings.push({
      code: "DIRECT_BOOKING_COSTS_INCOMPLETE",
      severity: "warning",
      message: "Some booking contribution postings do not include actual direct booking costs yet.",
      count: totals.missingDirectCostCount
    });
  }
  if (totals.unallocatedBusinessUnitCount > 0) {
    warnings.push({
      code: "UNALLOCATED_BUSINESS_UNITS",
      severity: "warning",
      message: "Some accounting postings are not assigned to a business unit.",
      count: totals.unallocatedBusinessUnitCount
    });
  }
  if (unknownChannelCount > 0) {
    warnings.push({
      code: "UNKNOWN_SALES_CHANNELS",
      severity: "info",
      message: "Some confirmed bookings use OTHER/unknown sales channel mapping.",
      count: unknownChannelCount
    });
  }
  if (operationalBookings.some((booking) => !Number(booking.paxSummary?.total || 0))) {
    warnings.push({
      code: "MISSING_PARTICIPANT_COUNTS",
      severity: "info",
      message: "Some confirmed bookings have no participant total.",
      count: operationalBookings.filter((booking) => !Number(booking.paxSummary?.total || 0)).length
    });
  }

  return {
    completeRecords: Math.max(0, totals.postingCount - totals.missingDirectCostCount - totals.unallocatedBusinessUnitCount),
    incompleteRecords: totals.missingDirectCostCount + totals.unallocatedBusinessUnitCount,
    missingCostRecords: totals.missingDirectCostCount,
    unallocatedBusinessUnits: totals.unallocatedBusinessUnitCount,
    unknownChannels: unknownChannelCount,
    missingHistoricalFX: 0,
    warnings
  };
};

const compareKpis = (currentTotals, comparisonTotals, currentOperational, comparisonOperational) => ({
  revenue: safePercentageChange(toApiNumber(currentTotals.revenue), toApiNumber(comparisonTotals.revenue)),
  collectedRevenue: safePercentageChange(toApiNumber(currentTotals.collectedRevenue), toApiNumber(comparisonTotals.collectedRevenue)),
  grossProfit: safePercentageChange(toApiNumber(currentTotals.grossProfit), toApiNumber(comparisonTotals.grossProfit)),
  netProfit: safePercentageChange(toApiNumber(currentTotals.netProfit), toApiNumber(comparisonTotals.netProfit)),
  operatingExpenses: safePercentageChange(toApiNumber(currentTotals.operatingExpenses), toApiNumber(comparisonTotals.operatingExpenses)),
  refundedAmount: safePercentageChange(toApiNumber(currentTotals.refundedAmount), toApiNumber(comparisonTotals.refundedAmount)),
  totalConfirmedBookings: safePercentageChange(currentOperational.totalConfirmedBookings, comparisonOperational.totalConfirmedBookings),
  totalParticipants: safePercentageChange(currentOperational.totalParticipants, comparisonOperational.totalParticipants)
});

const createExecutiveAnalyticsService = ({
  AccountingPostingModel = AccountingPosting,
  BookingModel = Booking,
  now = () => new Date()
} = {}) => {
  const fetchPostings = async ({ range, dateDimension }) => {
    const query = buildQueryForRange({
      range,
      dateDimension,
      allowed: EXECUTIVE_FINANCIAL_DATE_DIMENSIONS
    });
    return asArray(await leanMaybe(AccountingPostingModel.find(query)));
  };

  const fetchOperationalBookings = async ({ range, dateDimension }) => {
    const query = buildOperationalBookingQuery({ range, dateDimension });
    const result = BookingModel.find(query);
    const rows = result && typeof result.limit === "function"
      ? await leanMaybe(result.limit(10000))
      : await leanMaybe(result);
    return asArray(rows);
  };

  const getRangeMetrics = async ({ range, financialDateDimension, operationalDateDimension }) => {
    const [postings, bookings] = await Promise.all([
      fetchPostings({ range, dateDimension: financialDateDimension }),
      fetchOperationalBookings({ range, dateDimension: operationalDateDimension })
    ]);
    const totals = aggregatePostings(postings);
    const unknownChannelCount = bookings.filter((booking) => !booking.salesChannel || booking.salesChannel === "OTHER").length;

    return {
      postings,
      bookings,
      totals,
      operational: {
        totalConfirmedBookings: bookings.length,
        totalParticipants: bookings.reduce((sum, booking) => sum + Number(booking.paxSummary?.total || 0), 0),
        unknownChannelCount
      },
      dataQuality: buildDataQuality({ totals, operationalBookings: bookings, unknownChannelCount })
    };
  };

  const getExecutiveDashboard = async ({
    period = ANALYTICS_PERIOD.THIS_MONTH,
    from = "",
    to = "",
    compare = ANALYTICS_COMPARE_MODE.PREVIOUS_PERIOD,
    compareFrom = "",
    compareTo = "",
    dateDimension = ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE,
    operationalDateDimension = ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE
  } = {}) => {
    const currentRange = resolveAnalyticsPeriod({ period, from, to, now: now() });
    const comparison = resolveComparisonPeriod({
      currentRange,
      compare,
      compareFrom,
      compareTo
    });
    const financialDateDimension = normalizeDateDimension(dateDimension);
    const normalizedOperationalDateDimension = normalizeDateDimension(operationalDateDimension);
    const currentMetrics = await getRangeMetrics({
      range: currentRange,
      financialDateDimension,
      operationalDateDimension: normalizedOperationalDateDimension
    });
    const comparisonMetrics = comparison?.range
      ? await getRangeMetrics({
          range: comparison.range,
          financialDateDimension,
          operationalDateDimension: normalizedOperationalDateDimension
        })
      : null;
    const comparisonByKpi = comparisonMetrics
      ? compareKpis(currentMetrics.totals, comparisonMetrics.totals, currentMetrics.operational, comparisonMetrics.operational)
      : {};
    const profitMarginComparison = comparisonMetrics
      ? safePercentageChange(
          currentMetrics.totals.profitMargin.value ?? 0,
          comparisonMetrics.totals.profitMargin.value ?? 0
        )
      : null;

    return {
      report: "EXECUTIVE_ANALYTICS",
      generatedAt: now().toISOString(),
      period: currentRange,
      comparison: comparison
        ? {
            ...comparison,
            range: comparison.range || null,
            metrics: comparisonMetrics ? normalizeTotalsForApi(comparisonMetrics.totals) : null
          }
        : null,
      dateDimensions: {
        financial: describeDateDimension(financialDateDimension),
        operational: describeDateDimension(normalizedOperationalDateDimension)
      },
      sourceOfTruth: {
        financial: "Business Accounting / AccountingPosting",
        operational: "Confirmed Bokun/local Booking records",
        noSecondAccountingTruth: true
      },
      kpis: {
        revenue: createKpi({ value: toApiNumber(currentMetrics.totals.revenue), comparison: comparisonByKpi.revenue }),
        collectedRevenue: createKpi({ value: toApiNumber(currentMetrics.totals.collectedRevenue), comparison: comparisonByKpi.collectedRevenue }),
        grossProfit: createKpi({ value: toApiNumber(currentMetrics.totals.grossProfit), comparison: comparisonByKpi.grossProfit }),
        netProfit: createKpi({ value: toApiNumber(currentMetrics.totals.netProfit), comparison: comparisonByKpi.netProfit }),
        profitMargin: createKpi({
          value: currentMetrics.totals.profitMargin.value,
          unit: "percent",
          comparison: profitMarginComparison,
          supported: currentMetrics.totals.profitMargin.valid,
          reason: currentMetrics.totals.profitMargin.reason
        }),
        operatingExpenses: createKpi({ value: toApiNumber(currentMetrics.totals.operatingExpenses), comparison: comparisonByKpi.operatingExpenses }),
        cashPosition: unsupportedKpi(DEFAULT_UNSUPPORTED_KPIS.cashPosition),
        netCashFlow: unsupportedKpi(DEFAULT_UNSUPPORTED_KPIS.netCashFlow),
        accountsReceivable: unsupportedKpi(DEFAULT_UNSUPPORTED_KPIS.accountsReceivable),
        accountsPayable: unsupportedKpi(DEFAULT_UNSUPPORTED_KPIS.accountsPayable),
        refundedAmount: createKpi({ value: toApiNumber(currentMetrics.totals.refundedAmount), comparison: comparisonByKpi.refundedAmount }),
        totalConfirmedBookings: createKpi({
          value: currentMetrics.operational.totalConfirmedBookings,
          unit: "count",
          comparison: comparisonByKpi.totalConfirmedBookings,
          source: "Confirmed bookings"
        }),
        totalParticipants: createKpi({
          value: currentMetrics.operational.totalParticipants,
          unit: "count",
          comparison: comparisonByKpi.totalParticipants,
          source: "Confirmed bookings"
        })
      },
      financialBreakdown: normalizeTotalsForApi(currentMetrics.totals),
      dataQuality: currentMetrics.dataQuality,
      drillDown: {
        accountingPostings: {
          route: "/api/admin/business-accounting/foundation",
          filters: {
            fromDate: currentRange.fromIso,
            toDate: currentRange.toIso,
            dateDimension: financialDateDimension
          }
        },
        confirmedBookings: {
          route: "/api/bookings",
          filters: {
            bookingStatus: "confirmed",
            fromDate: currentRange.fromIso,
            toDate: currentRange.toIso,
            dateDimension: normalizedOperationalDateDimension
          }
        }
      },
      sample: {
        confirmedBookings: currentMetrics.bookings.slice(0, 5).map(normalizeBookingForApi)
      },
      limitations: [
        "Cash position, receivables and payables remain unavailable until dedicated cash/AR/AP accounting models exist.",
        "Direct booking costs are shown only where Booking Accounting contribution postings include them.",
        "Executive financial KPIs use AccountingPosting transaction dates and do not switch silently to operational dates."
      ]
    };
  };

  return {
    getExecutiveDashboard
  };
};

const service = createExecutiveAnalyticsService();

module.exports = {
  ...service,
  createExecutiveAnalyticsService,
  __testables: {
    aggregatePostings,
    buildDataQuality,
    compareKpis,
    normalizeTotalsForApi,
    ratioPercent
  }
};
