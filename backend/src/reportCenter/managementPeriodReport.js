const {
  ANALYTICS_COMPARE_MODE,
  ANALYTICS_DATE_DIMENSION,
  ANALYTICS_GRANULARITY
} = require("../analytics/constants");

const dataQualityOf = (payload = {}) =>
  payload.dataQuality || {
    warnings: [],
    completenessPercent: null,
    status: "NOT_REPORTED"
  };

const warningsOf = (payload = {}) => {
  const quality = dataQualityOf(payload);
  return Array.isArray(quality.warnings) ? quality.warnings : [];
};

const mergeDataQuality = (sections = {}) => {
  const sources = Object.entries(sections).reduce((result, [key, payload]) => {
    result[key] = dataQualityOf(payload);
    return result;
  }, {});
  const warnings = Object.values(sections).flatMap(warningsOf);
  return {
    status: warnings.length ? "WARNING" : "OK",
    warnings,
    sources
  };
};

const prefixDrillDown = (prefix, drillDown = {}) =>
  Object.entries(drillDown || {}).reduce((result, [key, value]) => {
    result[`${prefix}.${key}`] = value;
    return result;
  }, {});

const mergeDrillDown = (sections = {}) => ({
  ...prefixDrillDown("financial", sections.financial?.drillDown),
  ...prefixDrillDown("bookingsCreated", sections.bookingsCreated?.drillDown),
  ...prefixDrillDown("toursOperating", sections.toursOperating?.drillDown),
  ...prefixDrillDown("trends", sections.trends?.drillDown)
});

const kpiValue = (kpi = null) => {
  if (!kpi || typeof kpi !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(kpi, "value")) return kpi.value;
  return null;
};

const metric = ({ value = null, source, supported = true, reason = "" }) => ({
  value,
  source,
  supported,
  reason
});

const unsupportedMetric = (source, reason) => metric({ value: null, source, supported: false, reason });

const buildManagementSummary = ({ financial = {}, bookingsCreated = {}, toursOperating = {} } = {}) => ({
  bookingsCreated: metric({
    value: bookingsCreated.totals?.confirmedBookings ?? null,
    source: "bookingsCreated.totals.confirmedBookings"
  }),
  participantsBooked: metric({
    value: bookingsCreated.totals?.participants ?? null,
    source: "bookingsCreated.totals.participants"
  }),
  toursOperating: metric({
    value: toursOperating.totals?.confirmedBookings ?? null,
    source: "toursOperating.totals.confirmedBookings"
  }),
  participantsOperating: metric({
    value: toursOperating.totals?.participants ?? null,
    source: "toursOperating.totals.participants"
  }),
  bookedRevenue: metric({
    value: financial.financialBreakdown?.bookedRevenue ?? null,
    source: "financial.financialBreakdown.bookedRevenue"
  }),
  collectedRevenue: metric({
    value: kpiValue(financial.kpis?.collectedRevenue),
    source: "financial.kpis.collectedRevenue"
  }),
  refundedAmount: metric({
    value: kpiValue(financial.kpis?.refundedAmount),
    source: "financial.kpis.refundedAmount"
  }),
  directBookingCosts: metric({
    value: financial.financialBreakdown?.directBookingCosts ?? null,
    source: "financial.financialBreakdown.directBookingCosts"
  }),
  operatingExpenses: metric({
    value: kpiValue(financial.kpis?.operatingExpenses),
    source: "financial.kpis.operatingExpenses"
  }),
  grossProfit: metric({
    value: kpiValue(financial.kpis?.grossProfit),
    source: "financial.kpis.grossProfit"
  }),
  netProfit: metric({
    value: kpiValue(financial.kpis?.netProfit),
    source: "financial.kpis.netProfit"
  }),
  profitMargin: metric({
    value: kpiValue(financial.kpis?.profitMargin),
    source: "financial.kpis.profitMargin",
    supported: financial.kpis?.profitMargin?.supported !== false,
    reason: financial.kpis?.profitMargin?.reason || ""
  }),
  netCashMovement: unsupportedMetric(
    "cashMovement",
    "Dedicated cash movement accounting is not implemented yet."
  ),
  receivables: unsupportedMetric(
    "receivables",
    "Dedicated receivables accounting is not implemented yet."
  ),
  payables: unsupportedMetric(
    "payables",
    "Dedicated payables accounting is not implemented yet."
  )
});

const periodBaseFilters = (filters = {}) => ({
  period: filters.period,
  from: filters.from || "",
  to: filters.to || "",
  compare: filters.compare || ANALYTICS_COMPARE_MODE.NONE,
  compareFrom: filters.compareFrom || "",
  compareTo: filters.compareTo || ""
});

const buildManagementPeriodReport = async ({ definition, filters = {}, periodRange = null, services }) => {
  const profile = definition.periodProfile || {};
  const base = periodBaseFilters(filters);
  const granularity = filters.granularity || profile.defaultGranularity || ANALYTICS_GRANULARITY.MONTH;
  const financialDateDimension =
    filters.financialDateDimension || ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE;
  const selectedOperationalDateDimension =
    filters.operationalDateDimension || profile.defaultOperationalDateDimension || ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE;
  const channel = filters.channel || "";
  const productId = filters.productId || "";

  const financialFilters = {
    ...base,
    dateDimension: financialDateDimension,
    operationalDateDimension: ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE
  };
  const bookingsCreatedFilters = {
    ...base,
    dateDimension: ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE,
    granularity,
    channel,
    productId
  };
  const toursOperatingFilters = {
    ...base,
    dateDimension: ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE,
    granularity,
    channel,
    productId
  };
  const trendFilters = {
    ...base,
    financialDateDimension,
    operationalDateDimension: selectedOperationalDateDimension,
    granularity,
    channel,
    productId
  };

  const [financial, bookingsCreated, toursOperating, trends] = await Promise.all([
    services.executiveAnalyticsService.getExecutiveDashboard(financialFilters),
    services.salesAnalyticsService.getSalesAnalytics(bookingsCreatedFilters),
    services.salesAnalyticsService.getSalesAnalytics(toursOperatingFilters),
    services.trendAnalyticsService.getTrendAnalytics(trendFilters)
  ]);

  const sections = {
    financial,
    bookingsCreated,
    toursOperating,
    trends
  };

  return {
    report: "MANAGEMENT_PERIOD_REPORT",
    profile: {
      key: profile.key,
      label: profile.label,
      primaryQuestion: profile.primaryQuestion,
      defaultPeriod: profile.defaultPeriod,
      defaultGranularity: profile.defaultGranularity
    },
    period: periodRange,
    dateDimensions: {
      financial: financialDateDimension,
      bookingsCreated: ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE,
      toursOperating: ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE,
      trendOperational: selectedOperationalDateDimension
    },
    filters: {
      ...base,
      financialDateDimension,
      operationalDateDimension: selectedOperationalDateDimension,
      granularity,
      channel,
      productId
    },
    sourceOfTruth: {
      financial: "Executive Analytics / Business Accounting / AccountingPosting",
      bookingsCreated: "Sales Analytics using Bokun booking-created date",
      toursOperating: "Sales Analytics using Bokun travel date",
      trends: "Trend Analytics with separate financial and operational date dimensions",
      noSecondAccountingTruth: true
    },
    managementSummary: buildManagementSummary({ financial, bookingsCreated, toursOperating }),
    sections,
    dataQuality: mergeDataQuality(sections),
    drillDown: mergeDrillDown(sections),
    limitations: [
      "This management report composes canonical analytics services and does not define independent revenue or profit formulas.",
      "Bookings created and tours operating intentionally use different Bokun operational date dimensions.",
      "Financial movement uses accounting transaction dates and remains separate from operational dates.",
      "Net cash movement, receivables and payables remain unsupported until dedicated accounting models exist."
    ]
  };
};

module.exports = {
  buildManagementPeriodReport,
  __testables: {
    buildManagementSummary,
    mergeDataQuality,
    mergeDrillDown
  }
};
