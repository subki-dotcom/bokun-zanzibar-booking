const {
  ANALYTICS_COMPARE_MODE,
  ANALYTICS_DATE_DIMENSION,
  ANALYTICS_GRANULARITY,
  ANALYTICS_PERIOD
} = require("../analytics/constants");
const BusinessExpense = require("../models/BusinessExpense");
const Invoice = require("../models/Invoice");
const Payment = require("../models/Payment");
const {
  executiveAnalyticsService,
  salesAnalyticsService,
  productAnalyticsService,
  channelAnalyticsService,
  trendAnalyticsService
} = require("../analytics");
const { normalizeDateDimension } = require("../analytics/dateDimensions");
const { resolveAnalyticsPeriod, resolveComparisonPeriod } = require("../analytics/periods");
const businessAccountingService = require("../services/businessAccounting");
const AppError = require("../utils/AppError");
const { buildAccountingReportView } = require("./accountingReport");
const { REPORT_EXPORT_FORMAT } = require("./constants");
const { buildManagementPeriodReport } = require("./managementPeriodReport");
const {
  buildChannelReportView,
  buildProductReportView,
  buildProfitabilityOverview
} = require("./productChannelProfitabilityReport");
const {
  REPORT_FILTER,
  REPORT_GROUPS,
  getReportDefinition,
  listReportDefinitions,
  listReportFilterOptions,
  serializeReportDefinition
} = require("./reportRegistry");

const normalizeToken = (value = "") => String(value || "").trim();
const normalizeUpper = (value = "") => normalizeToken(value).toUpperCase();

const defaultServices = {
  executiveAnalyticsService,
  salesAnalyticsService,
  productAnalyticsService,
  channelAnalyticsService,
  trendAnalyticsService,
  businessAccountingService,
  BusinessExpenseModel: BusinessExpense,
  InvoiceModel: Invoice,
  PaymentModel: Payment
};

const includeIfPresent = (target, key, value) => {
  if (value !== undefined && value !== null && normalizeToken(value) !== "") {
    target[key] = value;
  }
};

const normalizeEnumValue = ({ value, fallback, allowed, code, label }) => {
  const normalized = normalizeUpper(value || fallback);
  if (allowed.includes(normalized)) return normalized;
  throw new AppError(`${label} is not supported`, 422, code, { value });
};

const normalizeFreeText = (value = "", maxLength = 180) => normalizeToken(value).slice(0, maxLength);

const buildAllowedFilterSet = (definition) => new Set(definition.filters || []);

const normalizeReportFilters = ({ definition, input = {}, now = new Date() }) => {
  const allowedFilters = buildAllowedFilterSet(definition);
  const defaults = definition.defaultFilters || {};
  const normalized = {};

  if (allowedFilters.has(REPORT_FILTER.PERIOD)) {
    normalized.period = normalizeEnumValue({
      value: input.period,
      fallback: defaults.period || ANALYTICS_PERIOD.THIS_MONTH,
      allowed: Object.values(ANALYTICS_PERIOD),
      code: "REPORT_PERIOD_INVALID",
      label: "Report period"
    });
  }

  [REPORT_FILTER.FROM, REPORT_FILTER.TO, REPORT_FILTER.COMPARE_FROM, REPORT_FILTER.COMPARE_TO].forEach((key) => {
    if (allowedFilters.has(key)) includeIfPresent(normalized, key, normalizeFreeText(input[key], 80));
  });

  if (allowedFilters.has(REPORT_FILTER.COMPARE)) {
    normalized.compare = normalizeEnumValue({
      value: input.compare,
      fallback: defaults.compare || ANALYTICS_COMPARE_MODE.NONE,
      allowed: Object.values(ANALYTICS_COMPARE_MODE),
      code: "REPORT_COMPARE_MODE_INVALID",
      label: "Report comparison mode"
    });
  }

  if (allowedFilters.has(REPORT_FILTER.DATE_DIMENSION)) {
    normalized.dateDimension = normalizeDateDimension(
      input.dateDimension || defaults.dateDimension || ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE
    );
  }

  if (allowedFilters.has(REPORT_FILTER.FINANCIAL_DATE_DIMENSION)) {
    normalized.financialDateDimension = normalizeDateDimension(
      input.financialDateDimension ||
        input.dateDimension ||
        defaults.financialDateDimension ||
        ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE
    );
  }

  if (allowedFilters.has(REPORT_FILTER.OPERATIONAL_DATE_DIMENSION)) {
    normalized.operationalDateDimension = normalizeDateDimension(
      input.operationalDateDimension ||
        defaults.operationalDateDimension ||
        ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE
    );
  }

  if (allowedFilters.has(REPORT_FILTER.GRANULARITY)) {
    normalized.granularity = normalizeEnumValue({
      value: input.granularity,
      fallback: defaults.granularity || ANALYTICS_GRANULARITY.MONTH,
      allowed: Object.values(ANALYTICS_GRANULARITY),
      code: "REPORT_GRANULARITY_INVALID",
      label: "Report granularity"
    });
  }

  [
    REPORT_FILTER.CURRENCY,
    REPORT_FILTER.PRODUCT_ID,
    REPORT_FILTER.PRODUCT_OPTION_ID,
    REPORT_FILTER.CHANNEL,
    REPORT_FILTER.AGENT_ID,
    REPORT_FILTER.CUSTOMER_ID,
    REPORT_FILTER.SUPPLIER_ID,
    REPORT_FILTER.VEHICLE_ID,
    REPORT_FILTER.DRIVER_ID,
    REPORT_FILTER.GUIDE_ID,
    REPORT_FILTER.BUSINESS_UNIT,
    REPORT_FILTER.BOOKING_STATUS,
    REPORT_FILTER.PAYMENT_STATUS,
    REPORT_FILTER.REFUND_STATUS,
    REPORT_FILTER.PROFITABILITY_STATUS,
    REPORT_FILTER.EXPENSE_CATEGORY,
    REPORT_FILTER.INCOME_CATEGORY,
    REPORT_FILTER.FINANCIAL_ENTRY_STATUS,
    REPORT_FILTER.EXPENSE_PAYMENT_STATUS
  ].forEach((key) => {
    if (allowedFilters.has(key)) includeIfPresent(normalized, key, normalizeFreeText(input[key]));
  });

  const period = normalized.period || defaults.period || ANALYTICS_PERIOD.THIS_MONTH;
  const periodRange = resolveAnalyticsPeriod({
    period,
    from: normalized.from || "",
    to: normalized.to || "",
    now
  });
  const comparison = normalized.compare
    ? resolveComparisonPeriod({
        currentRange: periodRange,
        compare: normalized.compare,
        compareFrom: normalized.compareFrom || "",
        compareTo: normalized.compareTo || ""
      })
    : null;

  return {
    values: normalized,
    periodRange,
    comparison
  };
};

const analyticsPeriodFilters = (filters) => ({
  period: filters.period,
  from: filters.from || "",
  to: filters.to || "",
  compare: filters.compare || ANALYTICS_COMPARE_MODE.NONE,
  compareFrom: filters.compareFrom || "",
  compareTo: filters.compareTo || ""
});

const serviceFiltersForDefinition = ({ definition, filters, periodRange }) => {
  const base = analyticsPeriodFilters(filters);

  if (definition.runner === "executiveAnalytics") {
    return {
      ...base,
      dateDimension: filters.financialDateDimension || ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE,
      operationalDateDimension: filters.operationalDateDimension || ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE
    };
  }

  if (definition.runner === "salesAnalytics") {
    return {
      ...base,
      dateDimension: filters.dateDimension || ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE,
      granularity: filters.granularity || ANALYTICS_GRANULARITY.MONTH,
      channel: filters.channel || "",
      productId: filters.productId || ""
    };
  }

  if (definition.runner === "productAnalytics" || definition.runner === "channelAnalytics") {
    return {
      ...base,
      dateDimension: filters.dateDimension || ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE,
      channel: filters.channel || "",
      productId: filters.productId || ""
    };
  }

  if (definition.runner === "trendAnalytics") {
    return {
      ...base,
      financialDateDimension: filters.financialDateDimension || ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE,
      operationalDateDimension: filters.operationalDateDimension || ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE,
      granularity: filters.granularity || ANALYTICS_GRANULARITY.MONTH,
      channel: filters.channel || "",
      productId: filters.productId || ""
    };
  }

  if (definition.runner === "businessAccountingFoundation") {
    return {
      fromDate: periodRange?.fromIso || "",
      toDate: periodRange?.toIso || ""
    };
  }

  return base;
};

const runCanonicalReport = async ({ definition, filters, periodRange, services, now = () => new Date() }) => {
  const serviceFilters = serviceFiltersForDefinition({ definition, filters, periodRange });

  if (definition.runner === "executiveAnalytics") {
    return services.executiveAnalyticsService.getExecutiveDashboard(serviceFilters);
  }
  if (definition.runner === "salesAnalytics") {
    return services.salesAnalyticsService.getSalesAnalytics(serviceFilters);
  }
  if (definition.runner === "productAnalytics") {
    return services.productAnalyticsService.getProductAnalytics(serviceFilters);
  }
  if (definition.runner === "channelAnalytics") {
    return services.channelAnalyticsService.getChannelAnalytics(serviceFilters);
  }
  if (definition.runner === "trendAnalytics") {
    return services.trendAnalyticsService.getTrendAnalytics(serviceFilters);
  }
  if (definition.runner === "businessAccountingFoundation") {
    return services.businessAccountingService.getFoundationSummary(serviceFilters);
  }
  if (definition.runner === "managementPeriod") {
    return buildManagementPeriodReport({
      definition,
      filters,
      periodRange,
      services
    });
  }
  if (definition.runner === "productReportView") {
    return buildProductReportView({
      definition,
      filters,
      periodRange,
      services
    });
  }
  if (definition.runner === "channelReportView") {
    return buildChannelReportView({
      definition,
      filters,
      periodRange,
      services
    });
  }
  if (definition.runner === "profitabilityOverview") {
    return buildProfitabilityOverview({
      definition,
      filters,
      periodRange,
      services
    });
  }
  if (definition.runner === "accountingReportView") {
    return buildAccountingReportView({
      definition,
      filters,
      periodRange,
      services,
      now
    });
  }

  throw new AppError("Report runner is not implemented", 501, "REPORT_RUNNER_NOT_IMPLEMENTED", {
    reportType: definition.type,
    runner: definition.runner
  });
};

const extractDataQuality = (payload = {}) => {
  if (payload.dataQuality) return payload.dataQuality;
  if (payload.current?.dataQuality) return payload.current.dataQuality;
  if (payload.data?.dataQuality) return payload.data.dataQuality;
  return {
    warnings: [],
    completenessPercent: null,
    status: "NOT_REPORTED"
  };
};

const buildExportPlan = (definition) => ({
  status: "AVAILABLE",
  supportedFormats: definition.supportedExports || Object.values(REPORT_EXPORT_FORMAT),
  usesSameQueryDefinition: true,
  columns: definition.columns || [],
  historyTracking: "ENABLED_RESPONSE_ONLY"
});

const createReportCenterService = ({ services = defaultServices, now = () => new Date() } = {}) => {
  const listCatalog = () => ({
    generatedAt: now().toISOString(),
    groups: REPORT_GROUPS,
    reports: listReportDefinitions(),
    filterOptions: listReportFilterOptions(),
    queryRules: {
      reportsUseCanonicalServices: true,
      exportsUseSameQueryDefinition: true,
      frontendRawDatabaseQueriesAllowed: false,
      operationalAndFinancialDatesAreSeparate: true,
      statutoryReportsAvailable: false
    }
  });

  const runReport = async ({ reportType, filters = {}, auth = {}, requestId = "" } = {}) => {
    const normalizedType = normalizeUpper(reportType);
    const definition = getReportDefinition(normalizedType);
    if (!definition) {
      throw new AppError("Report type is not supported", 404, "REPORT_TYPE_NOT_SUPPORTED", {
        reportType
      });
    }

    const normalized = normalizeReportFilters({
      definition,
      input: filters,
      now: now()
    });
    const data = await runCanonicalReport({
      definition,
      filters: normalized.values,
      periodRange: normalized.periodRange,
      services,
      now
    });

    return {
      report: serializeReportDefinition(definition),
      generatedAt: now().toISOString(),
      generatedBy: auth?.id || "",
      requestId,
      filters: normalized.values,
      period: normalized.periodRange,
      comparison: normalized.comparison,
      sourceIntegrity: {
        formulasDuplicatedInReportCenter: false,
        canonicalServices: definition.canonicalServices,
        sourceOfTruth: definition.sourceOfTruth
      },
      data,
      dataQuality: extractDataQuality(data),
      drillDown: data?.drillDown || {},
      exportPlan: buildExportPlan(definition),
      limitations: [
        ...(definition.limitations || []),
        "Exports are generated from the same report query definition and are streamed as response-only files by default."
      ]
    };
  };

  return {
    listCatalog,
    runReport
  };
};

const service = createReportCenterService();

module.exports = {
  ...service,
  createReportCenterService,
  __testables: {
    buildExportPlan,
    extractDataQuality,
    normalizeReportFilters,
    serviceFiltersForDefinition
  }
};
