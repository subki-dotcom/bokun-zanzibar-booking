const {
  ANALYTICS_COMPARE_MODE,
  ANALYTICS_DATE_DIMENSION,
  ANALYTICS_GRANULARITY
} = require("../analytics/constants");
const { CHANNEL_RANKING } = require("../analytics/channelAnalyticsService");
const { PRODUCT_RANKING } = require("../analytics/productAnalyticsService");

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
  const warnings = Object.values(sections).flatMap(warningsOf);
  return {
    status: warnings.length ? "WARNING" : "OK",
    warnings,
    sources: Object.entries(sections).reduce((result, [key, payload]) => {
      result[key] = dataQualityOf(payload);
      return result;
    }, {})
  };
};

const prefixDrillDown = (prefix, drillDown = {}) =>
  Object.entries(drillDown || {}).reduce((result, [key, value]) => {
    result[`${prefix}.${key}`] = value;
    return result;
  }, {});

const buildAnalyticsFilters = (filters = {}) => ({
  period: filters.period,
  from: filters.from || "",
  to: filters.to || "",
  compare: filters.compare || ANALYTICS_COMPARE_MODE.NONE,
  compareFrom: filters.compareFrom || "",
  compareTo: filters.compareTo || "",
  dateDimension: filters.dateDimension || ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE,
  channel: filters.channel || "",
  productId: filters.productId || ""
});

const productRowsForView = (analytics = {}, view = {}) => {
  if (view.kind === "PRODUCT_COST_VARIANCE") {
    return (analytics.products || [])
      .map((product) => ({
        productId: product.productId,
        productTitle: product.productTitle,
        directCosts: product.directCosts,
        missingCostRecords: product.dataQuality?.missingCostRecords || 0,
        missingAccountingPostings: product.dataQuality?.missingAccountingPostings || 0,
        varianceSupported: false,
        reason: "Estimated-vs-actual cost variance requires richer cost template and actual-cost evidence."
      }))
      .sort((left, right) => right.missingCostRecords - left.missingCostRecords || right.directCosts - left.directCosts);
  }

  if (view.rankingKey) return analytics.rankings?.[view.rankingKey] || [];
  return analytics.products || [];
};

const channelRowsForView = (analytics = {}, view = {}) => {
  if (view.rankingKey) return analytics.rankings?.[view.rankingKey] || [];
  return analytics.channels || [];
};

const buildProductReportView = async ({ definition, filters = {}, services }) => {
  const view = definition.reportView || {};
  const analytics = await services.productAnalyticsService.getProductAnalytics(buildAnalyticsFilters(filters));
  const rows = productRowsForView(analytics, view);

  return {
    report: "PRODUCT_REPORT_VIEW",
    view,
    rows,
    totals: analytics.totals || {},
    rankings: analytics.rankings || {},
    performanceMatrix: analytics.performanceMatrix || {},
    sourceOfTruth: analytics.sourceOfTruth || definition.sourceOfTruth,
    dataQuality: dataQualityOf(analytics),
    drillDown: analytics.drillDown || {},
    limitations: [
      ...(analytics.limitations || []),
      ...(definition.limitations || []),
      "This product report view uses Product Analytics output and does not define independent profit formulas."
    ]
  };
};

const buildChannelReportView = async ({ definition, filters = {}, services }) => {
  const view = definition.reportView || {};
  const analytics = await services.channelAnalyticsService.getChannelAnalytics(buildAnalyticsFilters(filters));
  const rows = channelRowsForView(analytics, view);

  return {
    report: "CHANNEL_REPORT_VIEW",
    view,
    rows,
    answers: analytics.answers || {},
    totals: analytics.totals || {},
    rankings: analytics.rankings || {},
    channelMix: analytics.channelMix || [],
    sourceOfTruth: analytics.sourceOfTruth || definition.sourceOfTruth,
    dataQuality: dataQualityOf(analytics),
    drillDown: analytics.drillDown || {},
    limitations: [
      ...(analytics.limitations || []),
      ...(definition.limitations || []),
      "This channel report view uses Channel Analytics output and does not define independent profit formulas."
    ]
  };
};

const buildProfitabilityOverview = async ({ definition, filters = {}, services }) => {
  const base = buildAnalyticsFilters(filters);
  const trendFilters = {
    period: base.period,
    from: base.from,
    to: base.to,
    compare: base.compare,
    compareFrom: base.compareFrom,
    compareTo: base.compareTo,
    granularity: filters.granularity || ANALYTICS_GRANULARITY.MONTH,
    financialDateDimension: filters.financialDateDimension || ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE,
    operationalDateDimension: filters.operationalDateDimension || base.dateDimension,
    channel: base.channel,
    productId: base.productId
  };
  const [productAnalytics, channelAnalytics, trendAnalytics] = await Promise.all([
    services.productAnalyticsService.getProductAnalytics(base),
    services.channelAnalyticsService.getChannelAnalytics(base),
    services.trendAnalyticsService.getTrendAnalytics(trendFilters)
  ]);
  const lossMakingProducts = productAnalytics.rankings?.[PRODUCT_RANKING.LOSS_MAKING] || [];
  const lossMakingChannels = channelAnalytics.rankings?.[CHANNEL_RANKING.LOSS_MAKING] || [];

  return {
    report: "PROFITABILITY_OVERVIEW",
    view: definition.reportView || {},
    supportedGroupings: [
      { grouping: "PRODUCT", status: "SUPPORTED", source: "productAnalytics.products" },
      { grouping: "CHANNEL", status: "SUPPORTED", source: "channelAnalytics.channels" },
      { grouping: "MONTH_OR_YEAR", status: "SUPPORTED", source: "trendAnalytics.trends.combined" },
      { grouping: "BOOKING", status: "PLANNED", reason: "Booking-level profitability report is scheduled for later report-center phases." },
      { grouping: "AGENT", status: "PLANNED", reason: "Agent profitability requires allocation by agent settlement and commission evidence." },
      { grouping: "SUPPLIER", status: "PLANNED", reason: "Supplier profitability requires supplier payable/cost allocation reports." },
      { grouping: "VEHICLE_DRIVER_GUIDE", status: "PLANNED", reason: "Operations assignment cost allocation is not complete yet." }
    ],
    product: {
      totals: productAnalytics.totals || {},
      rankings: productAnalytics.rankings || {},
      lossMaking: lossMakingProducts,
      rows: productAnalytics.products || []
    },
    channel: {
      answers: channelAnalytics.answers || {},
      totals: channelAnalytics.totals || {},
      rankings: channelAnalytics.rankings || {},
      lossMaking: lossMakingChannels,
      rows: channelAnalytics.channels || []
    },
    trend: {
      totals: trendAnalytics.totals || {},
      trends: trendAnalytics.trends || {}
    },
    lossSummary: {
      products: lossMakingProducts,
      channels: lossMakingChannels
    },
    dataQuality: mergeDataQuality({
      product: productAnalytics,
      channel: channelAnalytics,
      trend: trendAnalytics
    }),
    drillDown: {
      ...prefixDrillDown("product", productAnalytics.drillDown),
      ...prefixDrillDown("channel", channelAnalytics.drillDown),
      ...prefixDrillDown("trend", trendAnalytics.drillDown)
    },
    limitations: [
      ...(productAnalytics.limitations || []),
      ...(channelAnalytics.limitations || []),
      ...(trendAnalytics.limitations || []),
      ...(definition.limitations || []),
      "This profitability report composes Product, Channel and Trend Analytics without duplicating formulas.",
      "Actual-vs-estimated profitability remains limited by available cost evidence."
    ]
  };
};

module.exports = {
  buildChannelReportView,
  buildProductReportView,
  buildProfitabilityOverview,
  __testables: {
    buildAnalyticsFilters,
    channelRowsForView,
    mergeDataQuality,
    productRowsForView
  }
};
