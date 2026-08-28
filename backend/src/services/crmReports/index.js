const crmAnalyticsService = require("../crmAnalytics");
const AppError = require("../../utils/AppError");
const { CRM_REPORT_EXPORT_FORMAT, CRM_REPORT_TYPE } = require("../../crm/constants");

const REPORT_AVAILABILITY = Object.freeze({
  AVAILABLE: "AVAILABLE"
});

const REPORT_FILTERS = Object.freeze(["from", "to", "source", "assignedTo", "currency"]);

const toArray = (value) => (Array.isArray(value) ? value : []);
const normalizeToken = (value = "") => String(value || "").trim();
const normalizeUpper = (value = "") => normalizeToken(value).toUpperCase();
const toMoney = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
};
const formatDateForFilename = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown-date";
  return date.toISOString().slice(0, 10);
};
const stringifyCell = (value) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value")) return stringifyCell(value.value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};
const escapeCsv = (value) => {
  const text = stringifyCell(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const column = ({ key, label, type = "text" }) => ({ key, label, source: key, type });

const REPORT_DEFINITIONS = Object.freeze({
  [CRM_REPORT_TYPE.CRM_PIPELINE_FORECAST]: {
    type: CRM_REPORT_TYPE.CRM_PIPELINE_FORECAST,
    title: "CRM Pipeline Forecast",
    description: "Open and closed opportunity stages with estimated and weighted CRM forecast value.",
    category: "PIPELINE",
    availability: REPORT_AVAILABILITY.AVAILABLE,
    supportedExports: [CRM_REPORT_EXPORT_FORMAT.CSV],
    filters: REPORT_FILTERS,
    columns: [
      column({ key: "stage", label: "Stage" }),
      column({ key: "count", label: "Opportunities", type: "number" }),
      column({ key: "totalEstimatedValue", label: "Estimated Value", type: "money" }),
      column({ key: "weightedValue", label: "Weighted Forecast", type: "money" }),
      column({ key: "forecastOnly", label: "Forecast Only", type: "boolean" })
    ]
  },
  [CRM_REPORT_TYPE.CRM_CONVERSION_FUNNEL]: {
    type: CRM_REPORT_TYPE.CRM_CONVERSION_FUNNEL,
    title: "CRM Conversion Funnel",
    description: "Lead to Bokun booking evidence funnel from CRM records.",
    category: "CONVERSION",
    availability: REPORT_AVAILABILITY.AVAILABLE,
    supportedExports: [CRM_REPORT_EXPORT_FORMAT.CSV],
    filters: REPORT_FILTERS,
    columns: [
      column({ key: "step", label: "Step" }),
      column({ key: "count", label: "Count", type: "number" }),
      column({ key: "value", label: "Value", type: "money" }),
      column({ key: "weightedValue", label: "Weighted Value", type: "money" }),
      column({ key: "rateFromPrevious", label: "Rate From Previous", type: "percent" }),
      column({ key: "basis", label: "Basis" })
    ]
  },
  [CRM_REPORT_TYPE.CRM_LEAD_SOURCE_PERFORMANCE]: {
    type: CRM_REPORT_TYPE.CRM_LEAD_SOURCE_PERFORMANCE,
    title: "CRM Lead Source Performance",
    description: "Lead source volume connected to CRM opportunity forecast.",
    category: "SOURCE",
    availability: REPORT_AVAILABILITY.AVAILABLE,
    supportedExports: [CRM_REPORT_EXPORT_FORMAT.CSV],
    filters: REPORT_FILTERS,
    columns: [
      column({ key: "source", label: "Source" }),
      column({ key: "leadCount", label: "Leads", type: "number" }),
      column({ key: "opportunityCount", label: "Opportunities", type: "number" }),
      column({ key: "totalEstimatedValue", label: "Estimated Pipeline", type: "money" })
    ]
  },
  [CRM_REPORT_TYPE.CRM_QUOTE_CONVERSION]: {
    type: CRM_REPORT_TYPE.CRM_QUOTE_CONVERSION,
    title: "CRM Quote Conversion",
    description: "Quote status conversion summary with CRM forecast guardrails.",
    category: "QUOTES",
    availability: REPORT_AVAILABILITY.AVAILABLE,
    supportedExports: [CRM_REPORT_EXPORT_FORMAT.CSV],
    filters: REPORT_FILTERS,
    columns: [
      column({ key: "status", label: "Quote Status" }),
      column({ key: "count", label: "Quotes", type: "number" }),
      column({ key: "forecastOnly", label: "Forecast Only", type: "boolean" })
    ]
  },
  [CRM_REPORT_TYPE.CRM_LOST_OPPORTUNITIES]: {
    type: CRM_REPORT_TYPE.CRM_LOST_OPPORTUNITIES,
    title: "CRM Lost Opportunities",
    description: "Lost opportunity reasons. These values are not accounting losses.",
    category: "PIPELINE",
    availability: REPORT_AVAILABILITY.AVAILABLE,
    supportedExports: [CRM_REPORT_EXPORT_FORMAT.CSV],
    filters: REPORT_FILTERS,
    columns: [
      column({ key: "reason", label: "Lost Reason" }),
      column({ key: "count", label: "Opportunities", type: "number" }),
      column({ key: "totalEstimatedValue", label: "Estimated Value", type: "money" }),
      column({ key: "accountingLoss", label: "Accounting Loss", type: "boolean" })
    ]
  },
  [CRM_REPORT_TYPE.CRM_PRODUCT_INTEREST]: {
    type: CRM_REPORT_TYPE.CRM_PRODUCT_INTEREST,
    title: "CRM Product Interest",
    description: "Product demand signals from CRM leads, opportunities and quote line items.",
    category: "PRODUCT",
    availability: REPORT_AVAILABILITY.AVAILABLE,
    supportedExports: [CRM_REPORT_EXPORT_FORMAT.CSV],
    filters: REPORT_FILTERS,
    columns: [
      column({ key: "productTitle", label: "Product" }),
      column({ key: "optionTitle", label: "Option" }),
      column({ key: "totalSignals", label: "Signals", type: "number" }),
      column({ key: "leadInterestCount", label: "Lead Interest", type: "number" }),
      column({ key: "opportunityCount", label: "Opportunities", type: "number" }),
      column({ key: "quoteLineItemCount", label: "Quote Items", type: "number" }),
      column({ key: "weightedPipelineValue", label: "Weighted Forecast", type: "money" }),
      column({ key: "quotedValue", label: "Quoted Value", type: "money" })
    ]
  },
  [CRM_REPORT_TYPE.CRM_B2B_PIPELINE]: {
    type: CRM_REPORT_TYPE.CRM_B2B_PIPELINE,
    title: "CRM B2B Pipeline",
    description: "B2B partner pipeline by status and type. No ledger entries are posted from CRM.",
    category: "B2B",
    availability: REPORT_AVAILABILITY.AVAILABLE,
    supportedExports: [CRM_REPORT_EXPORT_FORMAT.CSV],
    filters: REPORT_FILTERS,
    columns: [
      column({ key: "dimension", label: "Dimension" }),
      column({ key: "value", label: "Value" }),
      column({ key: "count", label: "Partners", type: "number" }),
      column({ key: "postsLedgerEntries", label: "Posts Ledger Entries", type: "boolean" })
    ]
  }
});

const serializeDefinition = (definition) => ({
  ...definition,
  columns: definition.columns.map((item) => ({ ...item })),
  filters: [...definition.filters],
  supportedExports: [...definition.supportedExports]
});

const getDefinition = (reportType) => {
  const normalized = normalizeUpper(reportType);
  const definition = REPORT_DEFINITIONS[normalized];
  if (!definition) {
    throw new AppError("CRM report type is not supported", 422, "CRM_REPORT_TYPE_INVALID", { reportType });
  }
  return definition;
};

const sourceRows = (analytics = {}) => {
  const leadSources = toArray(analytics.leads?.bySource);
  const pipelineSources = toArray(analytics.pipeline?.bySource);
  const keys = new Set([...leadSources.map((row) => row._id), ...pipelineSources.map((row) => row._id)]);
  return [...keys].filter(Boolean).sort().map((source) => {
    const lead = leadSources.find((row) => row._id === source) || {};
    const pipeline = pipelineSources.find((row) => row._id === source) || {};
    return {
      source,
      leadCount: lead.count || 0,
      opportunityCount: pipeline.count || 0,
      totalEstimatedValue: toMoney(pipeline.totalEstimatedValue)
    };
  });
};

const REPORT_BUILDERS = Object.freeze({
  [CRM_REPORT_TYPE.CRM_PIPELINE_FORECAST]: (analytics = {}) =>
    toArray(analytics.pipeline?.byStage).map((row) => ({
      stage: row._id,
      count: row.count || 0,
      totalEstimatedValue: toMoney(row.totalEstimatedValue),
      weightedValue: toMoney(row.weightedValue),
      forecastOnly: true
    })),
  [CRM_REPORT_TYPE.CRM_CONVERSION_FUNNEL]: (analytics = {}) =>
    toArray(analytics.funnel).map((row) => ({
      step: row.label || row.key,
      count: row.count || 0,
      value: row.value === undefined ? "" : toMoney(row.value),
      weightedValue: row.weightedValue === undefined ? "" : toMoney(row.weightedValue),
      rateFromPrevious: row.rateFromPrevious === null || row.rateFromPrevious === undefined ? "" : row.rateFromPrevious,
      basis: row.basis || ""
    })),
  [CRM_REPORT_TYPE.CRM_LEAD_SOURCE_PERFORMANCE]: sourceRows,
  [CRM_REPORT_TYPE.CRM_QUOTE_CONVERSION]: (analytics = {}) =>
    toArray(analytics.quotes?.byStatus).map((row) => ({
      status: row._id,
      count: row.count || 0,
      forecastOnly: true
    })),
  [CRM_REPORT_TYPE.CRM_LOST_OPPORTUNITIES]: (analytics = {}) =>
    toArray(analytics.lost?.byReason).map((row) => ({
      reason: row._id,
      count: row.count || 0,
      totalEstimatedValue: toMoney(row.totalEstimatedValue),
      accountingLoss: false
    })),
  [CRM_REPORT_TYPE.CRM_PRODUCT_INTEREST]: (analytics = {}) =>
    toArray(analytics.productInterest).map((row) => ({
      productTitle: row.productTitle || "Unknown product",
      optionTitle: row.optionTitle || "",
      totalSignals: row.totalSignals || 0,
      leadInterestCount: row.leadInterestCount || 0,
      opportunityCount: row.opportunityCount || 0,
      quoteLineItemCount: row.quoteLineItemCount || 0,
      weightedPipelineValue: toMoney(row.weightedPipelineValue),
      quotedValue: toMoney(row.quotedValue)
    })),
  [CRM_REPORT_TYPE.CRM_B2B_PIPELINE]: (analytics = {}) => [
    ...toArray(analytics.b2b?.byStatus).map((row) => ({
      dimension: "STATUS",
      value: row._id,
      count: row.count || 0,
      postsLedgerEntries: false
    })),
    ...toArray(analytics.b2b?.byType).map((row) => ({
      dimension: "TYPE",
      value: row._id,
      count: row.count || 0,
      postsLedgerEntries: false
    }))
  ]
});

const buildSummary = (reportType, analytics = {}, rows = []) => {
  const totals = analytics.totals || {};
  const common = {
    rowCount: rows.length,
    forecastOnly: true,
    actualRevenueSource: analytics.sourceOfTruth?.actualRevenueSource || "Booking Accounting after Bokun confirmed booking"
  };

  if (reportType === CRM_REPORT_TYPE.CRM_PIPELINE_FORECAST) {
    return {
      ...common,
      openOpportunities: totals.openOpportunityCount || 0,
      openPipelineValue: toMoney(totals.openPipelineValue),
      weightedPipelineValue: toMoney(totals.weightedPipelineValue)
    };
  }
  if (reportType === CRM_REPORT_TYPE.CRM_CONVERSION_FUNNEL) {
    return {
      ...common,
      leads: totals.leadCount || 0,
      qualifiedLeads: totals.qualifiedLeadCount || 0,
      linkedBookingEvidence: totals.wonBookingEvidenceCount || 0
    };
  }
  if (reportType === CRM_REPORT_TYPE.CRM_QUOTE_CONVERSION) {
    return {
      ...common,
      quoteCount: totals.quoteCount || 0,
      quoteAcceptanceRate: totals.quoteAcceptanceRate,
      totalQuotedValue: toMoney(totals.totalQuotedValue),
      acceptedQuoteValue: toMoney(totals.acceptedQuoteValue)
    };
  }
  if (reportType === CRM_REPORT_TYPE.CRM_LOST_OPPORTUNITIES) {
    return {
      ...common,
      lostOpportunities: totals.lostOpportunityCount || 0,
      crmLostValueIsNotAccountingLoss: true
    };
  }
  if (reportType === CRM_REPORT_TYPE.CRM_B2B_PIPELINE) {
    return {
      ...common,
      b2bPartnerCount: totals.b2bPartnerCount || 0,
      activeB2BPartnerCount: totals.activeB2BPartnerCount || 0,
      postsLedgerEntries: false
    };
  }
  return common;
};

const renderCsv = (reportResult = {}) => {
  const columns = toArray(reportResult.report?.columns);
  const rows = toArray(reportResult.rows);
  const metadata = [
    ["Report", reportResult.report?.title || reportResult.report?.type || ""],
    ["Generated At", reportResult.generatedAt || ""],
    ["Source Of Truth", reportResult.sourceOfTruth?.actualRevenueSource || ""],
    ["Forecast Only", reportResult.sourceOfTruth?.pipelineValueIsForecastOnly ? "yes" : "no"],
    []
  ];
  const header = columns.map((item) => escapeCsv(item.label || item.key)).join(",");
  const body = rows.map((row) => columns.map((item) => escapeCsv(row[item.key])).join(","));
  return [...metadata.map((row) => row.map(escapeCsv).join(",")), header, ...body].join("\r\n");
};

const createCrmReportsService = ({ analyticsService = crmAnalyticsService, now = () => new Date() } = {}) => {
  const listCatalog = () => ({
    step: "7K",
    module: "CRM_REPORTS",
    generatedAt: now().toISOString(),
    reports: Object.values(REPORT_DEFINITIONS).map(serializeDefinition),
    filterOptions: {
      exportFormats: Object.values(CRM_REPORT_EXPORT_FORMAT),
      filters: [...REPORT_FILTERS]
    },
    sourceOfTruth: {
      crmReportsSource: "CRM reports are generated from the canonical CRM analytics service.",
      actualRevenueSource: "Booking Accounting after Bokun confirmed booking",
      pipelineValueIsForecastOnly: true
    }
  });

  const runCrmReport = async ({ reportType, filters = {} } = {}) => {
    const definition = getDefinition(reportType);
    const analytics = await analyticsService.getCrmAnalytics(filters);
    const rows = REPORT_BUILDERS[definition.type](analytics);
    return {
      step: "7K",
      module: "CRM_REPORTS",
      generatedAt: now().toISOString(),
      report: serializeDefinition(definition),
      filters: analytics.filters || filters,
      sourceOfTruth: analytics.sourceOfTruth || {},
      summary: buildSummary(definition.type, analytics, rows),
      rows,
      dataQuality: {
        warnings: toArray(analytics.limitations)
      },
      analyticsGeneratedAt: analytics.generatedAt || null
    };
  };

  const exportCrmReport = async ({ reportType, format = CRM_REPORT_EXPORT_FORMAT.CSV, filters = {} } = {}) => {
    const normalizedFormat = normalizeUpper(format || CRM_REPORT_EXPORT_FORMAT.CSV);
    if (normalizedFormat !== CRM_REPORT_EXPORT_FORMAT.CSV) {
      throw new AppError("CRM report export format is not supported", 422, "CRM_REPORT_EXPORT_FORMAT_INVALID", { format });
    }
    const reportResult = await runCrmReport({ reportType, filters });
    const content = renderCsv(reportResult);
    return {
      report: reportResult,
      format: normalizedFormat,
      content,
      contentType: "text/csv; charset=utf-8",
      contentLength: Buffer.byteLength(content),
      disposition: "attachment",
      filename: `${String(reportResult.report.type).toLowerCase()}-${formatDateForFilename(now())}.csv`
    };
  };

  return {
    exportCrmReport,
    listCatalog,
    runCrmReport
  };
};

const service = createCrmReportsService();

module.exports = {
  ...service,
  CRM_REPORT_EXPORT_FORMAT,
  CRM_REPORT_TYPE,
  createCrmReportsService,
  __testables: {
    REPORT_DEFINITIONS,
    renderCsv,
    sourceRows
  }
};
