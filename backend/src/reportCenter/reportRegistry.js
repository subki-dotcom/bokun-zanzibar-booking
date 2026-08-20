const {
  ANALYTICS_COMPARE_MODE,
  ANALYTICS_DATE_DIMENSION,
  ANALYTICS_GRANULARITY,
  ANALYTICS_PERIOD,
  ANALYTICS_SOURCE_LAYER
} = require("../analytics/constants");
const {
  EXPENSE_CATEGORY,
  EXPENSE_PAYMENT_STATUS,
  FINANCIAL_ENTRY_STATUS,
  INCOME_CATEGORY
} = require("../accounting/constants");
const { listDateDimensions } = require("../analytics/dateDimensions");
const { CHANNEL_RANKING } = require("../analytics/channelAnalyticsService");
const { PRODUCT_RANKING } = require("../analytics/productAnalyticsService");
const { SALES_CHANNEL } = require("../integrations/bokun/salesChannel.adapter");
const {
  REPORT_AVAILABILITY,
  REPORT_EXPORT_FORMAT,
  REPORT_GROUP,
  REPORT_PERMISSION,
  REPORT_TYPE
} = require("./constants");

const allExportFormats = Object.values(REPORT_EXPORT_FORMAT);

const REPORT_FILTER = Object.freeze({
  PERIOD: "period",
  FROM: "from",
  TO: "to",
  COMPARE: "compare",
  COMPARE_FROM: "compareFrom",
  COMPARE_TO: "compareTo",
  DATE_DIMENSION: "dateDimension",
  FINANCIAL_DATE_DIMENSION: "financialDateDimension",
  OPERATIONAL_DATE_DIMENSION: "operationalDateDimension",
  GRANULARITY: "granularity",
  CURRENCY: "currency",
  PRODUCT_ID: "productId",
  PRODUCT_OPTION_ID: "productOptionId",
  CHANNEL: "channel",
  AGENT_ID: "agentId",
  CUSTOMER_ID: "customerId",
  SUPPLIER_ID: "supplierId",
  VEHICLE_ID: "vehicleId",
  DRIVER_ID: "driverId",
  GUIDE_ID: "guideId",
  BUSINESS_UNIT: "businessUnit",
  BOOKING_STATUS: "bookingStatus",
  PAYMENT_STATUS: "paymentStatus",
  REFUND_STATUS: "refundStatus",
  PROFITABILITY_STATUS: "profitabilityStatus",
  EXPENSE_CATEGORY: "expenseCategory",
  INCOME_CATEGORY: "incomeCategory",
  FINANCIAL_ENTRY_STATUS: "status",
  EXPENSE_PAYMENT_STATUS: "expensePaymentStatus"
});

const REPORT_GROUPS = Object.freeze([
  { key: REPORT_GROUP.EXECUTIVE, label: "Executive Reports", order: 10 },
  { key: REPORT_GROUP.BOOKING, label: "Booking Reports", order: 20 },
  { key: REPORT_GROUP.SALES, label: "Sales Reports", order: 30 },
  { key: REPORT_GROUP.PRODUCT, label: "Product Reports", order: 40 },
  { key: REPORT_GROUP.CHANNEL, label: "Channel Reports", order: 50 },
  { key: REPORT_GROUP.CUSTOMER, label: "Customer Reports", order: 60 },
  { key: REPORT_GROUP.AGENT, label: "Agent Reports", order: 70 },
  { key: REPORT_GROUP.SUPPLIER, label: "Supplier Reports", order: 80 },
  { key: REPORT_GROUP.VEHICLE, label: "Vehicle Reports", order: 90 },
  { key: REPORT_GROUP.DRIVER, label: "Driver Reports", order: 100 },
  { key: REPORT_GROUP.GUIDE, label: "Guide Reports", order: 110 },
  { key: REPORT_GROUP.BOOKING_ACCOUNTING, label: "Booking Accounting Reports", order: 120 },
  { key: REPORT_GROUP.BUSINESS_ACCOUNTING, label: "Business Accounting Reports", order: 130 },
  { key: REPORT_GROUP.EXPENSE, label: "Expense Reports", order: 140 },
  { key: REPORT_GROUP.REFUND, label: "Refund Reports", order: 150 },
  { key: REPORT_GROUP.RECEIVABLES, label: "Receivables Reports", order: 160 },
  { key: REPORT_GROUP.PAYABLES, label: "Payables Reports", order: 170 },
  { key: REPORT_GROUP.CASH_FLOW, label: "Cash Flow Reports", order: 180 },
  { key: REPORT_GROUP.PROFITABILITY, label: "Profitability Reports", order: 190 },
  { key: REPORT_GROUP.TAX_SUPPORT, label: "Tax Support Reports", order: 200 },
  { key: REPORT_GROUP.RECONCILIATION, label: "Reconciliation Reports", order: 210 },
  { key: REPORT_GROUP.CUSTOM, label: "Custom Reports", order: 220 },
  { key: REPORT_GROUP.EXPORT_HISTORY, label: "Export History", order: 230 }
]);

const field = ({ key, label, type = "string", unit = "", source = "" }) => ({
  key,
  label,
  type,
  unit,
  source
});

const commonPeriodFilters = [
  REPORT_FILTER.PERIOD,
  REPORT_FILTER.FROM,
  REPORT_FILTER.TO,
  REPORT_FILTER.COMPARE,
  REPORT_FILTER.COMPARE_FROM,
  REPORT_FILTER.COMPARE_TO
];

const managementPeriodFilters = [
  ...commonPeriodFilters,
  REPORT_FILTER.FINANCIAL_DATE_DIMENSION,
  REPORT_FILTER.OPERATIONAL_DATE_DIMENSION,
  REPORT_FILTER.GRANULARITY,
  REPORT_FILTER.CHANNEL,
  REPORT_FILTER.PRODUCT_ID,
  REPORT_FILTER.CURRENCY
];

const managementPeriodColumns = [
  field({ key: "bookingsCreated", label: "Bookings Created", type: "number", source: "managementSummary.bookingsCreated" }),
  field({ key: "toursOperating", label: "Tours Operating", type: "number", source: "managementSummary.toursOperating" }),
  field({ key: "collectedRevenue", label: "Collected Revenue", type: "money", source: "managementSummary.collectedRevenue" }),
  field({ key: "refundedAmount", label: "Refunds", type: "money", source: "managementSummary.refundedAmount" }),
  field({ key: "grossProfit", label: "Gross Profit", type: "money", source: "managementSummary.grossProfit" }),
  field({ key: "netProfit", label: "Net Profit", type: "money", source: "managementSummary.netProfit" }),
  field({ key: "profitMargin", label: "Profit Margin", type: "percent", source: "managementSummary.profitMargin" })
];

const managementPeriodDefinition = ({
  type,
  title,
  description,
  order,
  profileKey,
  profileLabel,
  primaryQuestion,
  defaultPeriod,
  defaultGranularity,
  defaultOperationalDateDimension = ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE,
  limitations = []
}) => ({
  type,
  title,
  description,
  group: REPORT_GROUP.EXECUTIVE,
  order,
  availability: REPORT_AVAILABILITY.AVAILABLE,
  runner: "managementPeriod",
  canonicalServices: [
    "executiveAnalyticsService.getExecutiveDashboard",
    "salesAnalyticsService.getSalesAnalytics",
    "trendAnalyticsService.getTrendAnalytics"
  ],
  sourceLayer: ANALYTICS_SOURCE_LAYER.ANALYTICS,
  sourceOfTruth: {
    financial: "Business Accounting / AccountingPosting through Executive Analytics",
    bookingsCreated: "Bokun confirmed/local Booking records through Sales Analytics",
    toursOperating: "Bokun travel dates through Sales Analytics",
    duplicatesFinancialTruth: false
  },
  filters: managementPeriodFilters,
  defaultFilters: {
    period: defaultPeriod,
    compare: ANALYTICS_COMPARE_MODE.PREVIOUS_PERIOD,
    financialDateDimension: ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE,
    operationalDateDimension: defaultOperationalDateDimension,
    granularity: defaultGranularity
  },
  periodProfile: {
    key: profileKey,
    label: profileLabel,
    primaryQuestion,
    defaultPeriod,
    defaultGranularity,
    includesBookingsCreatedByBokunCreatedDate: true,
    includesToursOperatingByBokunTravelDate: true,
    separatesFinancialTransactionDates: true
  },
  supportedExports: allExportFormats,
  permissions: [
    REPORT_PERMISSION.VIEW_REPORTS,
    REPORT_PERMISSION.VIEW_PROFIT,
    REPORT_PERMISSION.VIEW_COMPANY_PROFIT
  ],
  columns: managementPeriodColumns,
  limitations: [
    "This report composes canonical analytics services and does not duplicate financial formulas.",
    "Operational Bokun dates and financial accounting dates are kept separate.",
    ...limitations
  ]
});

const productReportColumns = [
  field({ key: "productId", label: "Product ID", source: "rows.productId" }),
  field({ key: "productTitle", label: "Product", source: "rows.productTitle" }),
  field({ key: "confirmedBookings", label: "Confirmed Bookings", type: "number", source: "rows.confirmedBookings" }),
  field({ key: "participants", label: "Participants", type: "number", source: "rows.participants" }),
  field({ key: "bookedRevenue", label: "Booked Revenue", type: "money", source: "rows.bookedRevenue" }),
  field({ key: "refunds", label: "Refunds", type: "money", source: "rows.refunds" }),
  field({ key: "netContribution", label: "Net Contribution", type: "money", source: "rows.netContribution" }),
  field({ key: "profitMargin", label: "Profit Margin", type: "percent", source: "rows.profitMargin" }),
  field({ key: "cancellationRate", label: "Cancellation Rate", type: "percent", source: "rows.cancellationRate" }),
  field({ key: "refundRate", label: "Refund Rate", type: "percent", source: "rows.refundRate" })
];

const channelReportColumns = [
  field({ key: "channel", label: "Channel", source: "rows.channel" }),
  field({ key: "label", label: "Label", source: "rows.label" }),
  field({ key: "confirmedBookings", label: "Confirmed Bookings", type: "number", source: "rows.confirmedBookings" }),
  field({ key: "participants", label: "Participants", type: "number", source: "rows.participants" }),
  field({ key: "bookedRevenue", label: "Booked Revenue", type: "money", source: "rows.bookedRevenue" }),
  field({ key: "collectedRevenue", label: "Collected Revenue", type: "money", source: "rows.collectedRevenue" }),
  field({ key: "refunds", label: "Refunds", type: "money", source: "rows.refunds" }),
  field({ key: "channelCommission", label: "Commission", type: "money", source: "rows.channelCommission" }),
  field({ key: "netProfit", label: "Net Profit", type: "money", source: "rows.netProfit" }),
  field({ key: "profitMargin", label: "Profit Margin", type: "percent", source: "rows.profitMargin" })
];

const productReportDefinition = ({
  type,
  title,
  description,
  order,
  rankingKey = "",
  viewKind = "PRODUCT_RANKING",
  metricLabel = "",
  limitations = []
}) => ({
  type,
  title,
  description,
  group: REPORT_GROUP.PRODUCT,
  order,
  availability: REPORT_AVAILABILITY.AVAILABLE,
  runner: "productReportView",
  canonicalServices: ["productAnalyticsService.getProductAnalytics"],
  sourceLayer: ANALYTICS_SOURCE_LAYER.ANALYTICS,
  sourceOfTruth: {
    operational: "Bokun/local Booking records through Product Analytics",
    financial: "Business Accounting / AccountingPosting booking contribution rows through Product Analytics",
    duplicatesFinancialTruth: false
  },
  filters: [
    ...commonPeriodFilters,
    REPORT_FILTER.DATE_DIMENSION,
    REPORT_FILTER.CHANNEL,
    REPORT_FILTER.PRODUCT_ID,
    REPORT_FILTER.CURRENCY
  ],
  defaultFilters: {
    period: ANALYTICS_PERIOD.THIS_MONTH,
    compare: ANALYTICS_COMPARE_MODE.PREVIOUS_PERIOD,
    dateDimension: ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE
  },
  reportView: {
    kind: viewKind,
    rankingKey,
    metricLabel,
    rowSource: rankingKey ? `productAnalytics.rankings.${rankingKey}` : "productAnalytics.products"
  },
  supportedExports: allExportFormats,
  permissions: [REPORT_PERMISSION.VIEW_REPORTS, REPORT_PERMISSION.VIEW_PROFIT],
  columns: productReportColumns,
  limitations: [
    "This report is a Product Analytics view and does not duplicate financial formulas.",
    ...limitations
  ]
});

const channelReportDefinition = ({
  type,
  title,
  description,
  order,
  rankingKey = "",
  viewKind = "CHANNEL_RANKING",
  metricLabel = "",
  limitations = []
}) => ({
  type,
  title,
  description,
  group: REPORT_GROUP.CHANNEL,
  order,
  availability: REPORT_AVAILABILITY.AVAILABLE,
  runner: "channelReportView",
  canonicalServices: ["channelAnalyticsService.getChannelAnalytics"],
  sourceLayer: ANALYTICS_SOURCE_LAYER.ANALYTICS,
  sourceOfTruth: {
    operational: "Bokun/local Booking records grouped by normalized salesChannel through Channel Analytics",
    financial: "Business Accounting / AccountingPosting booking contribution rows through Channel Analytics",
    duplicatesFinancialTruth: false
  },
  filters: [
    ...commonPeriodFilters,
    REPORT_FILTER.DATE_DIMENSION,
    REPORT_FILTER.CHANNEL,
    REPORT_FILTER.PRODUCT_ID,
    REPORT_FILTER.CURRENCY
  ],
  defaultFilters: {
    period: ANALYTICS_PERIOD.THIS_MONTH,
    compare: ANALYTICS_COMPARE_MODE.PREVIOUS_PERIOD,
    dateDimension: ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE
  },
  reportView: {
    kind: viewKind,
    rankingKey,
    metricLabel,
    rowSource: rankingKey ? `channelAnalytics.rankings.${rankingKey}` : "channelAnalytics.channels"
  },
  supportedExports: allExportFormats,
  permissions: [REPORT_PERMISSION.VIEW_REPORTS, REPORT_PERMISSION.VIEW_PROFIT],
  columns: channelReportColumns,
  limitations: [
    "This report is a Channel Analytics view and does not duplicate financial formulas.",
    "Allocated operating expenses by channel remain limited until allocation rules are available.",
    ...limitations
  ]
});

const profitabilityReportDefinition = ({
  type,
  title,
  description,
  order,
  viewKind,
  limitations = []
}) => ({
  type,
  title,
  description,
  group: REPORT_GROUP.PROFITABILITY,
  order,
  availability: REPORT_AVAILABILITY.AVAILABLE,
  runner: "profitabilityOverview",
  canonicalServices: [
    "productAnalyticsService.getProductAnalytics",
    "channelAnalyticsService.getChannelAnalytics",
    "trendAnalyticsService.getTrendAnalytics"
  ],
  sourceLayer: ANALYTICS_SOURCE_LAYER.ANALYTICS,
  sourceOfTruth: {
    product: "Product Analytics",
    channel: "Channel Analytics",
    trend: "Trend Analytics",
    duplicatesFinancialTruth: false
  },
  filters: [
    ...commonPeriodFilters,
    REPORT_FILTER.DATE_DIMENSION,
    REPORT_FILTER.FINANCIAL_DATE_DIMENSION,
    REPORT_FILTER.OPERATIONAL_DATE_DIMENSION,
    REPORT_FILTER.GRANULARITY,
    REPORT_FILTER.CHANNEL,
    REPORT_FILTER.PRODUCT_ID,
    REPORT_FILTER.CURRENCY
  ],
  defaultFilters: {
    period: ANALYTICS_PERIOD.THIS_MONTH,
    compare: ANALYTICS_COMPARE_MODE.PREVIOUS_PERIOD,
    dateDimension: ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE,
    financialDateDimension: ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE,
    operationalDateDimension: ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE,
    granularity: ANALYTICS_GRANULARITY.MONTH
  },
  reportView: {
    kind: viewKind,
    rowSources: [
      "productAnalytics.products",
      "channelAnalytics.channels",
      "trendAnalytics.trends.combined"
    ]
  },
  supportedExports: allExportFormats,
  permissions: [
    REPORT_PERMISSION.VIEW_REPORTS,
    REPORT_PERMISSION.VIEW_PROFIT,
    REPORT_PERMISSION.VIEW_COMPANY_PROFIT
  ],
  columns: [
    field({ key: "grouping", label: "Grouping", source: "supportedGroupings.grouping" }),
    field({ key: "status", label: "Status", source: "supportedGroupings.status" }),
    field({ key: "source", label: "Source", source: "supportedGroupings.source" })
  ],
  limitations: [
    "This profitability report composes canonical analytics outputs and does not duplicate formulas.",
    "Booking/agent/supplier/vehicle/driver/guide profitability groupings are disclosed as planned where allocation models are incomplete.",
    ...limitations
  ]
});

const accountingReportColumns = [
  field({ key: "reference", label: "Reference", source: "rows.reference" }),
  field({ key: "counterparty", label: "Counterparty", source: "rows.counterparty" }),
  field({ key: "category", label: "Category", source: "rows.category" }),
  field({ key: "amount", label: "Amount", type: "money", source: "rows.amount" }),
  field({ key: "status", label: "Status", source: "rows.status" }),
  field({ key: "date", label: "Date", type: "date", source: "rows.date" })
];

const agingReportColumns = [
  field({ key: "counterparty", label: "Counterparty", source: "rows.counterparty" }),
  field({ key: "source", label: "Source", source: "rows.source" }),
  field({ key: "amountDue", label: "Amount Due", type: "money", source: "rows.amountDue" }),
  field({ key: "amountReceived", label: "Received/Paid", type: "money", source: "rows.amountReceived" }),
  field({ key: "outstanding", label: "Outstanding", type: "money", source: "rows.outstanding" }),
  field({ key: "dueDate", label: "Due Date", type: "date", source: "rows.dueDate" }),
  field({ key: "agingBucket", label: "Aging", source: "rows.agingBucket" })
];

const accountingReportDefinition = ({
  type,
  title,
  description,
  group,
  order,
  viewKind,
  filters = [],
  columns = accountingReportColumns,
  permissions = [REPORT_PERMISSION.VIEW_REPORTS, REPORT_PERMISSION.VIEW_PROFIT],
  limitations = []
}) => ({
  type,
  title,
  description,
  group,
  order,
  availability: REPORT_AVAILABILITY.AVAILABLE,
  runner: "accountingReportView",
  canonicalServices: [
    "businessAccountingService.getFoundationSummary",
    "businessAccountingService.listBusinessIncome",
    "businessAccountingService.listBusinessExpenses",
    "Invoice",
    "Payment",
    "BusinessExpense"
  ],
  sourceLayer: ANALYTICS_SOURCE_LAYER.BUSINESS_ACCOUNTING,
  sourceOfTruth: {
    financial: "Business Accounting services and accounting-linked local financial records",
    duplicatesFinancialTruth: false,
    statutoryReport: false
  },
  filters: [
    REPORT_FILTER.PERIOD,
    REPORT_FILTER.FROM,
    REPORT_FILTER.TO,
    REPORT_FILTER.FINANCIAL_DATE_DIMENSION,
    REPORT_FILTER.CURRENCY,
    REPORT_FILTER.BUSINESS_UNIT,
    ...filters
  ],
  defaultFilters: {
    period: ANALYTICS_PERIOD.THIS_MONTH,
    financialDateDimension: ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE
  },
  reportView: {
    kind: viewKind,
    statutoryReport: false
  },
  supportedExports: allExportFormats,
  permissions,
  columns,
  limitations: [
    "This is a management accounting report, not a statutory balance sheet, trial balance or general ledger.",
    "The report consumes existing accounting services/records and does not define a second accounting truth.",
    ...limitations
  ]
});

const reportDefinitions = Object.freeze({
  [REPORT_TYPE.DAILY_MANAGEMENT_REPORT]: managementPeriodDefinition({
    type: REPORT_TYPE.DAILY_MANAGEMENT_REPORT,
    title: "Daily Management Report",
    description: "Daily operating and financial management report answering what happened in the business today.",
    order: 1,
    profileKey: "DAILY",
    profileLabel: "Daily Management",
    primaryQuestion: "What happened in the business today?",
    defaultPeriod: ANALYTICS_PERIOD.TODAY,
    defaultGranularity: ANALYTICS_GRANULARITY.DAY,
    limitations: [
      "Net cash movement is disclosed as unsupported until dedicated cash movement accounting exists."
    ]
  }),
  [REPORT_TYPE.WEEKLY_MANAGEMENT_REPORT]: managementPeriodDefinition({
    type: REPORT_TYPE.WEEKLY_MANAGEMENT_REPORT,
    title: "Weekly Management Report",
    description: "Weekly management report for bookings, revenue, expenses, refunds, profit and trends.",
    order: 2,
    profileKey: "WEEKLY",
    profileLabel: "Weekly Management",
    primaryQuestion: "How did the business perform this week?",
    defaultPeriod: ANALYTICS_PERIOD.THIS_WEEK,
    defaultGranularity: ANALYTICS_GRANULARITY.DAY
  }),
  [REPORT_TYPE.MONTHLY_MANAGEMENT_REPORT]: managementPeriodDefinition({
    type: REPORT_TYPE.MONTHLY_MANAGEMENT_REPORT,
    title: "Monthly Management Report",
    description: "Monthly management report for bookings, collected revenue, refunds, expenses, profit and management KPIs.",
    order: 3,
    profileKey: "MONTHLY",
    profileLabel: "Monthly Management",
    primaryQuestion: "How did the business perform this month?",
    defaultPeriod: ANALYTICS_PERIOD.THIS_MONTH,
    defaultGranularity: ANALYTICS_GRANULARITY.WEEK
  }),
  [REPORT_TYPE.QUARTERLY_MANAGEMENT_REPORT]: managementPeriodDefinition({
    type: REPORT_TYPE.QUARTERLY_MANAGEMENT_REPORT,
    title: "Quarterly Management Report",
    description: "Quarterly management report with operational and financial trends.",
    order: 4,
    profileKey: "QUARTERLY",
    profileLabel: "Quarterly Management",
    primaryQuestion: "How did the business perform this quarter?",
    defaultPeriod: ANALYTICS_PERIOD.THIS_QUARTER,
    defaultGranularity: ANALYTICS_GRANULARITY.MONTH
  }),
  [REPORT_TYPE.ANNUAL_MANAGEMENT_REPORT]: managementPeriodDefinition({
    type: REPORT_TYPE.ANNUAL_MANAGEMENT_REPORT,
    title: "Annual Management Report",
    description: "Annual management report with monthly breakdown and year-level performance.",
    order: 5,
    profileKey: "ANNUAL",
    profileLabel: "Annual Management",
    primaryQuestion: "How did the business perform this year?",
    defaultPeriod: ANALYTICS_PERIOD.THIS_YEAR,
    defaultGranularity: ANALYTICS_GRANULARITY.MONTH
  }),
  [REPORT_TYPE.MULTI_YEAR_COMPARISON]: managementPeriodDefinition({
    type: REPORT_TYPE.MULTI_YEAR_COMPARISON,
    title: "Multi-Year Comparison",
    description: "Multi-year management comparison for revenue, expenses, profit, bookings and participant trends.",
    order: 6,
    profileKey: "MULTI_YEAR",
    profileLabel: "Multi-Year Comparison",
    primaryQuestion: "How is the business changing over multiple years?",
    defaultPeriod: ANALYTICS_PERIOD.MULTI_YEAR,
    defaultGranularity: ANALYTICS_GRANULARITY.YEAR,
    limitations: [
      "Multi-year reports require explicit from and to dates and do not fabricate empty years as activity."
    ]
  }),
  [REPORT_TYPE.EXECUTIVE_BUSINESS_SUMMARY]: {
    type: REPORT_TYPE.EXECUTIVE_BUSINESS_SUMMARY,
    title: "Executive Business Summary",
    description: "Company-level management KPIs from canonical Business Accounting and operational booking analytics.",
    group: REPORT_GROUP.EXECUTIVE,
    order: 10,
    availability: REPORT_AVAILABILITY.AVAILABLE,
    runner: "executiveAnalytics",
    canonicalServices: ["executiveAnalyticsService.getExecutiveDashboard"],
    sourceLayer: ANALYTICS_SOURCE_LAYER.ANALYTICS,
    sourceOfTruth: {
      financial: "Business Accounting / AccountingPosting",
      operational: "Bokun confirmed/local Booking records",
      duplicatesFinancialTruth: false
    },
    filters: [
      ...commonPeriodFilters,
      REPORT_FILTER.FINANCIAL_DATE_DIMENSION,
      REPORT_FILTER.OPERATIONAL_DATE_DIMENSION,
      REPORT_FILTER.CURRENCY
    ],
    defaultFilters: {
      period: ANALYTICS_PERIOD.THIS_MONTH,
      compare: ANALYTICS_COMPARE_MODE.PREVIOUS_PERIOD,
      financialDateDimension: ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE,
      operationalDateDimension: ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE
    },
    supportedExports: allExportFormats,
    permissions: [
      REPORT_PERMISSION.VIEW_REPORTS,
      REPORT_PERMISSION.VIEW_PROFIT,
      REPORT_PERMISSION.VIEW_COMPANY_PROFIT
    ],
    columns: [
      field({ key: "revenue", label: "Revenue", type: "money", source: "kpis.revenue" }),
      field({ key: "collectedRevenue", label: "Collected Revenue", type: "money", source: "kpis.collectedRevenue" }),
      field({ key: "grossProfit", label: "Gross Profit", type: "money", source: "kpis.grossProfit" }),
      field({ key: "netProfit", label: "Net Profit", type: "money", source: "kpis.netProfit" }),
      field({ key: "profitMargin", label: "Profit Margin", type: "percent", source: "kpis.profitMargin" }),
      field({ key: "confirmedBookings", label: "Confirmed Bookings", type: "number", source: "kpis.totalConfirmedBookings" })
    ],
    limitations: [
      "Cash position, receivables and payables depend on future dedicated accounting models.",
      "This report wraps Executive Analytics and does not define separate financial formulas."
    ]
  },
  [REPORT_TYPE.SALES_SUMMARY]: {
    type: REPORT_TYPE.SALES_SUMMARY,
    title: "Sales Summary",
    description: "Booked sales, collected revenue and booking activity using one explicit operational date dimension.",
    group: REPORT_GROUP.SALES,
    order: 20,
    availability: REPORT_AVAILABILITY.AVAILABLE,
    runner: "salesAnalytics",
    canonicalServices: ["salesAnalyticsService.getSalesAnalytics"],
    sourceLayer: ANALYTICS_SOURCE_LAYER.ANALYTICS,
    sourceOfTruth: {
      operational: "Bokun confirmed/local Booking records",
      collectedRevenue: "Business Accounting / AccountingPosting booking contribution rows",
      duplicatesFinancialTruth: false
    },
    filters: [
      ...commonPeriodFilters,
      REPORT_FILTER.DATE_DIMENSION,
      REPORT_FILTER.GRANULARITY,
      REPORT_FILTER.CHANNEL,
      REPORT_FILTER.PRODUCT_ID,
      REPORT_FILTER.CURRENCY
    ],
    defaultFilters: {
      period: ANALYTICS_PERIOD.THIS_MONTH,
      compare: ANALYTICS_COMPARE_MODE.PREVIOUS_PERIOD,
      dateDimension: ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE,
      granularity: ANALYTICS_GRANULARITY.MONTH
    },
    supportedExports: allExportFormats,
    permissions: [REPORT_PERMISSION.VIEW_REPORTS],
    columns: [
      field({ key: "totalBookings", label: "Total Bookings", type: "number", source: "totals.totalBookings" }),
      field({ key: "confirmedBookings", label: "Confirmed Bookings", type: "number", source: "totals.confirmedBookings" }),
      field({ key: "participants", label: "Participants", type: "number", source: "totals.participants" }),
      field({ key: "bookedRevenue", label: "Booked Revenue", type: "money", source: "totals.bookedRevenue" }),
      field({ key: "collectedRevenue", label: "Collected Revenue", type: "money", source: "totals.collectedRevenue" }),
      field({ key: "averageBookingValue", label: "Average Booking Value", type: "money", source: "totals.averageBookingValue" })
    ],
    limitations: [
      "Booked revenue and collected revenue remain separate.",
      "This report wraps Sales Analytics and does not define separate financial formulas."
    ]
  },
  [REPORT_TYPE.PRODUCT_BEST_SELLERS]: productReportDefinition({
    type: REPORT_TYPE.PRODUCT_BEST_SELLERS,
    title: "Best Selling Products",
    description: "Products ranked by confirmed bookings from Product Analytics.",
    order: 70,
    rankingKey: PRODUCT_RANKING.BEST_SELLING_BY_BOOKINGS,
    metricLabel: "Confirmed bookings"
  }),
  [REPORT_TYPE.PRODUCT_REVENUE_RANKING]: productReportDefinition({
    type: REPORT_TYPE.PRODUCT_REVENUE_RANKING,
    title: "Highest Revenue Products",
    description: "Products ranked by booked revenue from Product Analytics.",
    order: 71,
    rankingKey: PRODUCT_RANKING.HIGHEST_REVENUE,
    metricLabel: "Booked revenue"
  }),
  [REPORT_TYPE.PRODUCT_PROFIT_RANKING]: productReportDefinition({
    type: REPORT_TYPE.PRODUCT_PROFIT_RANKING,
    title: "Highest Profit Products",
    description: "Products ranked by net contribution from Product Analytics.",
    order: 72,
    rankingKey: PRODUCT_RANKING.HIGHEST_NET_PROFIT,
    metricLabel: "Net contribution"
  }),
  [REPORT_TYPE.PRODUCT_MARGIN_RANKING]: productReportDefinition({
    type: REPORT_TYPE.PRODUCT_MARGIN_RANKING,
    title: "Highest Margin Products",
    description: "Products ranked by profit margin from Product Analytics.",
    order: 73,
    rankingKey: PRODUCT_RANKING.HIGHEST_MARGIN,
    metricLabel: "Profit margin"
  }),
  [REPORT_TYPE.PRODUCT_LOW_MARGIN]: productReportDefinition({
    type: REPORT_TYPE.PRODUCT_LOW_MARGIN,
    title: "Lowest Margin Products",
    description: "Products ranked by lowest supported profit margin from Product Analytics.",
    order: 74,
    rankingKey: PRODUCT_RANKING.LOWEST_MARGIN,
    metricLabel: "Lowest profit margin"
  }),
  [REPORT_TYPE.PRODUCT_LOSS_MAKING]: productReportDefinition({
    type: REPORT_TYPE.PRODUCT_LOSS_MAKING,
    title: "Loss-Making Products",
    description: "Products with negative net contribution from Product Analytics.",
    order: 75,
    rankingKey: PRODUCT_RANKING.LOSS_MAKING,
    metricLabel: "Negative net contribution"
  }),
  [REPORT_TYPE.PRODUCT_CANCELLATION_REPORT]: productReportDefinition({
    type: REPORT_TYPE.PRODUCT_CANCELLATION_REPORT,
    title: "Product Cancellation Report",
    description: "Products ranked by cancellation rate from Product Analytics.",
    order: 76,
    rankingKey: PRODUCT_RANKING.HIGHEST_CANCELLATION_RATE,
    metricLabel: "Cancellation rate"
  }),
  [REPORT_TYPE.PRODUCT_REFUND_REPORT]: productReportDefinition({
    type: REPORT_TYPE.PRODUCT_REFUND_REPORT,
    title: "Product Refund Report",
    description: "Products ranked by refund rate from Product Analytics.",
    order: 77,
    rankingKey: PRODUCT_RANKING.HIGHEST_REFUND_RATE,
    metricLabel: "Refund rate"
  }),
  [REPORT_TYPE.PRODUCT_COST_VARIANCE_REPORT]: productReportDefinition({
    type: REPORT_TYPE.PRODUCT_COST_VARIANCE_REPORT,
    title: "Product Cost Evidence Report",
    description: "Product direct-cost evidence and missing-cost indicators from Product Analytics.",
    order: 78,
    viewKind: "PRODUCT_COST_VARIANCE",
    metricLabel: "Cost evidence",
    limitations: [
      "Estimated-vs-actual variance is not fabricated; rows disclose direct costs and missing cost evidence until richer cost models are available."
    ]
  }),
  [REPORT_TYPE.PRODUCT_PROFITABILITY]: {
    type: REPORT_TYPE.PRODUCT_PROFITABILITY,
    title: "Product Profitability",
    description: "Product revenue, contribution, margin and loss indicators from canonical Product Analytics.",
    group: REPORT_GROUP.PRODUCT,
    order: 30,
    availability: REPORT_AVAILABILITY.AVAILABLE,
    runner: "productAnalytics",
    canonicalServices: ["productAnalyticsService.getProductAnalytics"],
    sourceLayer: ANALYTICS_SOURCE_LAYER.ANALYTICS,
    sourceOfTruth: {
      operational: "Bokun/local Booking records grouped by product",
      financial: "Business Accounting / AccountingPosting booking contribution rows",
      duplicatesFinancialTruth: false
    },
    filters: [
      ...commonPeriodFilters,
      REPORT_FILTER.DATE_DIMENSION,
      REPORT_FILTER.CHANNEL,
      REPORT_FILTER.PRODUCT_ID,
      REPORT_FILTER.CURRENCY
    ],
    defaultFilters: {
      period: ANALYTICS_PERIOD.THIS_MONTH,
      compare: ANALYTICS_COMPARE_MODE.PREVIOUS_PERIOD,
      dateDimension: ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE
    },
    supportedExports: allExportFormats,
    permissions: [REPORT_PERMISSION.VIEW_REPORTS, REPORT_PERMISSION.VIEW_PROFIT],
    columns: [
      field({ key: "productId", label: "Product ID", source: "products.productId" }),
      field({ key: "productTitle", label: "Product", source: "products.productTitle" }),
      field({ key: "confirmedBookings", label: "Confirmed Bookings", type: "number", source: "products.confirmedBookings" }),
      field({ key: "bookedRevenue", label: "Booked Revenue", type: "money", source: "products.bookedRevenue" }),
      field({ key: "netContribution", label: "Net Contribution", type: "money", source: "products.netContribution" }),
      field({ key: "profitMargin", label: "Profit Margin", type: "percent", source: "products.profitMargin" })
    ],
    limitations: [
      "Missing Booking Accounting contribution postings are surfaced as data-quality warnings.",
      "This report wraps Product Analytics and does not define separate financial formulas."
    ]
  },
  [REPORT_TYPE.CHANNEL_COMPARISON_REPORT]: channelReportDefinition({
    type: REPORT_TYPE.CHANNEL_COMPARISON_REPORT,
    title: "Channel Comparison Report",
    description: "All channels compared by bookings, revenue, costs, net profit and margin.",
    order: 90,
    viewKind: "CHANNEL_COMPARISON",
    metricLabel: "Channel comparison"
  }),
  [REPORT_TYPE.CHANNEL_NET_PROFIT_REPORT]: channelReportDefinition({
    type: REPORT_TYPE.CHANNEL_NET_PROFIT_REPORT,
    title: "Channel Net Profit Report",
    description: "Channels ranked by net profit from Channel Analytics.",
    order: 91,
    rankingKey: CHANNEL_RANKING.HIGHEST_NET_PROFIT,
    metricLabel: "Net profit"
  }),
  [REPORT_TYPE.CHANNEL_MARGIN_REPORT]: channelReportDefinition({
    type: REPORT_TYPE.CHANNEL_MARGIN_REPORT,
    title: "Channel Margin Report",
    description: "Channels ranked by profit margin from Channel Analytics.",
    order: 92,
    rankingKey: CHANNEL_RANKING.HIGHEST_MARGIN,
    metricLabel: "Profit margin"
  }),
  [REPORT_TYPE.CHANNEL_REFUND_REPORT]: channelReportDefinition({
    type: REPORT_TYPE.CHANNEL_REFUND_REPORT,
    title: "Channel Refund Report",
    description: "Channels ranked by refund rate from Channel Analytics.",
    order: 93,
    rankingKey: CHANNEL_RANKING.HIGHEST_REFUND_RATE,
    metricLabel: "Refund rate"
  }),
  [REPORT_TYPE.CHANNEL_CANCELLATION_REPORT]: channelReportDefinition({
    type: REPORT_TYPE.CHANNEL_CANCELLATION_REPORT,
    title: "Channel Cancellation Report",
    description: "Channels ranked by cancellation rate from Channel Analytics.",
    order: 94,
    rankingKey: CHANNEL_RANKING.HIGHEST_CANCELLATION_RATE,
    metricLabel: "Cancellation rate"
  }),
  [REPORT_TYPE.CHANNEL_LOSS_MAKING]: channelReportDefinition({
    type: REPORT_TYPE.CHANNEL_LOSS_MAKING,
    title: "Loss-Making Channels",
    description: "Channels with negative net profit from Channel Analytics.",
    order: 95,
    rankingKey: CHANNEL_RANKING.LOSS_MAKING,
    metricLabel: "Negative net profit"
  }),
  [REPORT_TYPE.CHANNEL_PROFITABILITY]: {
    type: REPORT_TYPE.CHANNEL_PROFITABILITY,
    title: "Channel Profitability",
    description: "Channel comparison with net-profit answer from canonical Channel Analytics.",
    group: REPORT_GROUP.CHANNEL,
    order: 40,
    availability: REPORT_AVAILABILITY.AVAILABLE,
    runner: "channelAnalytics",
    canonicalServices: ["channelAnalyticsService.getChannelAnalytics"],
    sourceLayer: ANALYTICS_SOURCE_LAYER.ANALYTICS,
    sourceOfTruth: {
      operational: "Bokun/local Booking records grouped by normalized salesChannel",
      financial: "Business Accounting / AccountingPosting booking contribution rows",
      duplicatesFinancialTruth: false
    },
    filters: [
      ...commonPeriodFilters,
      REPORT_FILTER.DATE_DIMENSION,
      REPORT_FILTER.CHANNEL,
      REPORT_FILTER.PRODUCT_ID,
      REPORT_FILTER.CURRENCY
    ],
    defaultFilters: {
      period: ANALYTICS_PERIOD.THIS_MONTH,
      compare: ANALYTICS_COMPARE_MODE.PREVIOUS_PERIOD,
      dateDimension: ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE
    },
    supportedExports: allExportFormats,
    permissions: [REPORT_PERMISSION.VIEW_REPORTS, REPORT_PERMISSION.VIEW_PROFIT],
    columns: [
      field({ key: "channel", label: "Channel", source: "channels.channel" }),
      field({ key: "confirmedBookings", label: "Confirmed Bookings", type: "number", source: "channels.confirmedBookings" }),
      field({ key: "bookedRevenue", label: "Booked Revenue", type: "money", source: "channels.bookedRevenue" }),
      field({ key: "netProfit", label: "Net Profit", type: "money", source: "channels.netProfit" }),
      field({ key: "margin", label: "Margin", type: "percent", source: "channels.profitMargin" })
    ],
    limitations: [
      "Operating expenses are not allocated by channel yet.",
      "This report wraps Channel Analytics and does not define separate financial formulas."
    ]
  },
  [REPORT_TYPE.PROFITABILITY_OVERVIEW]: profitabilityReportDefinition({
    type: REPORT_TYPE.PROFITABILITY_OVERVIEW,
    title: "Profitability Overview",
    description: "Profitability by supported product, channel and trend groupings.",
    order: 110,
    viewKind: "PROFITABILITY_OVERVIEW"
  }),
  [REPORT_TYPE.LOSS_MAKING_REPORT]: profitabilityReportDefinition({
    type: REPORT_TYPE.LOSS_MAKING_REPORT,
    title: "Loss-Making Report",
    description: "Loss-making products and channels from canonical profitability analytics.",
    order: 111,
    viewKind: "LOSS_MAKING"
  }),
  [REPORT_TYPE.MANAGEMENT_PROFIT_LOSS_REPORT]: accountingReportDefinition({
    type: REPORT_TYPE.MANAGEMENT_PROFIT_LOSS_REPORT,
    title: "Management Profit & Loss",
    description: "Management P&L summary from Business Accounting foundation totals.",
    group: REPORT_GROUP.BUSINESS_ACCOUNTING,
    order: 120,
    viewKind: "MANAGEMENT_PROFIT_LOSS",
    permissions: [
      REPORT_PERMISSION.VIEW_REPORTS,
      REPORT_PERMISSION.VIEW_PROFIT,
      REPORT_PERMISSION.VIEW_COMPANY_PROFIT
    ],
    columns: [
      field({ key: "bookingNetContribution", label: "Booking Net Contribution", type: "money", source: "totals.bookingNetContribution" }),
      field({ key: "otherBusinessIncome", label: "Other Business Income", type: "money", source: "totals.otherBusinessIncome" }),
      field({ key: "companyContributionRevenue", label: "Company Contribution Revenue", type: "money", source: "totals.companyContributionRevenue" }),
      field({ key: "companyExpenses", label: "Company Expenses", type: "money", source: "totals.companyExpenses" }),
      field({ key: "companyNetProfit", label: "Company Net Profit", type: "money", source: "totals.companyNetProfit" })
    ]
  }),
  [REPORT_TYPE.MANAGEMENT_CASH_FLOW_REPORT]: accountingReportDefinition({
    type: REPORT_TYPE.MANAGEMENT_CASH_FLOW_REPORT,
    title: "Management Cash Flow",
    description: "Management cash movement from paid payment, income and expense evidence.",
    group: REPORT_GROUP.CASH_FLOW,
    order: 121,
    viewKind: "CASH_FLOW",
    columns: [
      field({ key: "cashIn", label: "Cash In", type: "money", source: "cashIn" }),
      field({ key: "cashOut", label: "Cash Out", type: "money", source: "cashOut" }),
      field({ key: "netMovement", label: "Net Movement", type: "money", source: "netMovement" })
    ],
    limitations: [
      "Opening and closing cash balances are unsupported until dedicated cash account ledger records exist."
    ]
  }),
  [REPORT_TYPE.INCOME_REPORT]: accountingReportDefinition({
    type: REPORT_TYPE.INCOME_REPORT,
    title: "Income Report",
    description: "Business income entries grouped by category and business unit.",
    group: REPORT_GROUP.BUSINESS_ACCOUNTING,
    order: 122,
    viewKind: "INCOME",
    filters: [REPORT_FILTER.INCOME_CATEGORY, REPORT_FILTER.FINANCIAL_ENTRY_STATUS]
  }),
  [REPORT_TYPE.OPERATING_EXPENSE_REPORT]: accountingReportDefinition({
    type: REPORT_TYPE.OPERATING_EXPENSE_REPORT,
    title: "Operating Expense Report",
    description: "Business operating expenses grouped by category, payment status and business unit.",
    group: REPORT_GROUP.EXPENSE,
    order: 123,
    viewKind: "OPERATING_EXPENSE",
    filters: [
      REPORT_FILTER.EXPENSE_CATEGORY,
      REPORT_FILTER.EXPENSE_PAYMENT_STATUS,
      REPORT_FILTER.FINANCIAL_ENTRY_STATUS
    ]
  }),
  [REPORT_TYPE.PAYROLL_SUMMARY]: accountingReportDefinition({
    type: REPORT_TYPE.PAYROLL_SUMMARY,
    title: "Payroll Summary",
    description: "Salary-category business expenses summarized as payroll evidence.",
    group: REPORT_GROUP.EXPENSE,
    order: 124,
    viewKind: "PAYROLL",
    filters: [
      REPORT_FILTER.EXPENSE_PAYMENT_STATUS,
      REPORT_FILTER.FINANCIAL_ENTRY_STATUS
    ],
    limitations: [
      "This is salary-expense evidence, not a full payroll subsystem."
    ]
  }),
  [REPORT_TYPE.SUPPLIER_EXPENSE_REPORT]: accountingReportDefinition({
    type: REPORT_TYPE.SUPPLIER_EXPENSE_REPORT,
    title: "Supplier Expense Report",
    description: "Business expenses grouped by supplier evidence.",
    group: REPORT_GROUP.SUPPLIER,
    order: 125,
    viewKind: "SUPPLIER_EXPENSE",
    filters: [
      REPORT_FILTER.EXPENSE_CATEGORY,
      REPORT_FILTER.EXPENSE_PAYMENT_STATUS,
      REPORT_FILTER.FINANCIAL_ENTRY_STATUS,
      REPORT_FILTER.SUPPLIER_ID
    ]
  }),
  [REPORT_TYPE.RECEIVABLES_AGING_REPORT]: accountingReportDefinition({
    type: REPORT_TYPE.RECEIVABLES_AGING_REPORT,
    title: "Receivables Aging Report",
    description: "Management receivables aging from invoice balance snapshots.",
    group: REPORT_GROUP.RECEIVABLES,
    order: 126,
    viewKind: "RECEIVABLES",
    filters: [REPORT_FILTER.PAYMENT_STATUS],
    columns: agingReportColumns,
    limitations: [
      "This is not a statutory AR sub-ledger; it uses invoice balance snapshots."
    ]
  }),
  [REPORT_TYPE.PAYABLES_AGING_REPORT]: accountingReportDefinition({
    type: REPORT_TYPE.PAYABLES_AGING_REPORT,
    title: "Payables Aging Report",
    description: "Management payables aging from unpaid BusinessExpense records.",
    group: REPORT_GROUP.PAYABLES,
    order: 127,
    viewKind: "PAYABLES",
    filters: [
      REPORT_FILTER.EXPENSE_CATEGORY,
      REPORT_FILTER.EXPENSE_PAYMENT_STATUS,
      REPORT_FILTER.FINANCIAL_ENTRY_STATUS,
      REPORT_FILTER.SUPPLIER_ID
    ],
    columns: agingReportColumns,
    limitations: [
      "This is not a statutory AP sub-ledger; it uses BusinessExpense payment status evidence."
    ]
  }),
  [REPORT_TYPE.ASSET_REGISTER]: accountingReportDefinition({
    type: REPORT_TYPE.ASSET_REGISTER,
    title: "Asset Register",
    description: "Asset register placeholder that remains disabled until a real asset model exists.",
    group: REPORT_GROUP.BUSINESS_ACCOUNTING,
    order: 128,
    viewKind: "ASSET_REGISTER",
    columns: [
      field({ key: "asset", label: "Asset", source: "rows.asset" }),
      field({ key: "status", label: "Status", source: "supported" })
    ],
    limitations: [
      "No fake asset values are generated from expenses."
    ]
  }),
  [REPORT_TYPE.TREND_SUMMARY]: {
    type: REPORT_TYPE.TREND_SUMMARY,
    title: "Trend Summary",
    description: "Operational and financial trends with separate Bokun and accounting date dimensions.",
    group: REPORT_GROUP.EXECUTIVE,
    order: 50,
    availability: REPORT_AVAILABILITY.AVAILABLE,
    runner: "trendAnalytics",
    canonicalServices: ["trendAnalyticsService.getTrendAnalytics"],
    sourceLayer: ANALYTICS_SOURCE_LAYER.ANALYTICS,
    sourceOfTruth: {
      operational: "Bokun/local Booking records",
      financial: "Business Accounting / AccountingPosting",
      duplicatesFinancialTruth: false
    },
    filters: [
      ...commonPeriodFilters,
      REPORT_FILTER.FINANCIAL_DATE_DIMENSION,
      REPORT_FILTER.OPERATIONAL_DATE_DIMENSION,
      REPORT_FILTER.GRANULARITY,
      REPORT_FILTER.CHANNEL,
      REPORT_FILTER.PRODUCT_ID,
      REPORT_FILTER.CURRENCY
    ],
    defaultFilters: {
      period: ANALYTICS_PERIOD.THIS_MONTH,
      compare: ANALYTICS_COMPARE_MODE.PREVIOUS_PERIOD,
      financialDateDimension: ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE,
      operationalDateDimension: ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE,
      granularity: ANALYTICS_GRANULARITY.MONTH
    },
    supportedExports: allExportFormats,
    permissions: [REPORT_PERMISSION.VIEW_REPORTS, REPORT_PERMISSION.VIEW_PROFIT],
    columns: [
      field({ key: "bucket", label: "Period", source: "trends.combined.bucket" }),
      field({ key: "bookings", label: "Bookings", type: "number", source: "trends.combined.totalBookings" }),
      field({ key: "participants", label: "Participants", type: "number", source: "trends.combined.participants" }),
      field({ key: "revenue", label: "Revenue", type: "money", source: "trends.combined.revenue" }),
      field({ key: "netProfit", label: "Net Profit", type: "money", source: "trends.combined.netProfit" })
    ],
    limitations: [
      "Operational and financial date dimensions are intentionally separate.",
      "This report wraps Trend Analytics and does not define separate financial formulas."
    ]
  },
  [REPORT_TYPE.BUSINESS_ACCOUNTING_FOUNDATION]: {
    type: REPORT_TYPE.BUSINESS_ACCOUNTING_FOUNDATION,
    title: "Business Accounting Foundation",
    description: "Management accounting foundation totals from counted Business Accounting postings.",
    group: REPORT_GROUP.BUSINESS_ACCOUNTING,
    order: 60,
    availability: REPORT_AVAILABILITY.AVAILABLE,
    runner: "businessAccountingFoundation",
    canonicalServices: ["businessAccountingService.getFoundationSummary"],
    sourceLayer: ANALYTICS_SOURCE_LAYER.BUSINESS_ACCOUNTING,
    sourceOfTruth: {
      financial: "Business Accounting / AccountingPosting",
      duplicatesFinancialTruth: false
    },
    filters: [
      REPORT_FILTER.PERIOD,
      REPORT_FILTER.FROM,
      REPORT_FILTER.TO,
      REPORT_FILTER.FINANCIAL_DATE_DIMENSION,
      REPORT_FILTER.CURRENCY,
      REPORT_FILTER.BUSINESS_UNIT
    ],
    defaultFilters: {
      period: ANALYTICS_PERIOD.THIS_MONTH,
      financialDateDimension: ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE
    },
    supportedExports: allExportFormats,
    permissions: [
      REPORT_PERMISSION.VIEW_REPORTS,
      REPORT_PERMISSION.VIEW_PROFIT,
      REPORT_PERMISSION.VIEW_COMPANY_PROFIT
    ],
    columns: [
      field({ key: "bookingNetContribution", label: "Booking Net Contribution", type: "money", source: "totals.bookingNetContribution" }),
      field({ key: "otherBusinessIncome", label: "Other Business Income", type: "money", source: "totals.otherBusinessIncome" }),
      field({ key: "companyContributionRevenue", label: "Company Contribution Revenue", type: "money", source: "totals.companyContributionRevenue" }),
      field({ key: "companyExpenses", label: "Company Expenses", type: "money", source: "totals.companyExpenses" }),
      field({ key: "companyNetProfit", label: "Company Net Profit", type: "money", source: "totals.companyNetProfit" })
    ],
    limitations: [
      "This is a management accounting report, not a statutory P&L, balance sheet, trial balance or general ledger.",
      "This report wraps Business Accounting foundation summary and does not define separate financial formulas."
    ]
  }
});

const serializeReportDefinition = (definition) => ({
  type: definition.type,
  title: definition.title,
  description: definition.description,
  group: definition.group,
  order: definition.order,
  availability: definition.availability,
  filters: definition.filters,
  defaultFilters: definition.defaultFilters,
  supportedExports: definition.supportedExports,
  permissions: definition.permissions,
  columns: definition.columns,
  periodProfile: definition.periodProfile || null,
  reportView: definition.reportView || null,
  sourceLayer: definition.sourceLayer,
  sourceOfTruth: definition.sourceOfTruth,
  canonicalServices: definition.canonicalServices,
  limitations: definition.limitations
});

const listReportDefinitions = () =>
  Object.values(reportDefinitions)
    .sort((left, right) => left.order - right.order)
    .map(serializeReportDefinition);

const getReportDefinition = (type) => reportDefinitions[String(type || "").trim().toUpperCase()] || null;

const listReportFilterOptions = () => ({
  periods: Object.values(ANALYTICS_PERIOD),
  compareModes: Object.values(ANALYTICS_COMPARE_MODE),
  granularities: Object.values(ANALYTICS_GRANULARITY),
  dateDimensions: listDateDimensions(),
  salesChannels: Object.values(SALES_CHANNEL),
  incomeCategories: Object.values(INCOME_CATEGORY),
  expenseCategories: Object.values(EXPENSE_CATEGORY),
  financialEntryStatuses: Object.values(FINANCIAL_ENTRY_STATUS),
  expensePaymentStatuses: Object.values(EXPENSE_PAYMENT_STATUS),
  exportFormats: allExportFormats
});

module.exports = {
  REPORT_FILTER,
  REPORT_GROUPS,
  getReportDefinition,
  listReportDefinitions,
  listReportFilterOptions,
  reportDefinitions,
  serializeReportDefinition
};
