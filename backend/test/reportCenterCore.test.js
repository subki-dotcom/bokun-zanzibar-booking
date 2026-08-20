process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/report-center-core-test";
process.env.JWT_SECRET ||= "report-center-core-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ANALYTICS_COMPARE_MODE,
  ANALYTICS_DATE_DIMENSION,
  ANALYTICS_GRANULARITY,
  ANALYTICS_PERIOD
} = require("../src/analytics/constants");
const { SALES_CHANNEL } = require("../src/integrations/bokun/salesChannel.adapter");
const {
  REPORT_EXPORT_FORMAT,
  REPORT_GROUP,
  REPORT_TYPE
} = require("../src/reportCenter/constants");
const { createReportCenterService } = require("../src/reportCenter/reportQueryService");
const { createReportExportService } = require("../src/reportCenter/exportService");
const { CHANNEL_RANKING } = require("../src/analytics/channelAnalyticsService");
const { PRODUCT_RANKING } = require("../src/analytics/productAnalyticsService");
const {
  EXPENSE_PAYMENT_STATUS,
  FINANCIAL_ENTRY_STATUS
} = require("../src/accounting/constants");

const fixedNow = new Date("2026-08-15T10:30:00.000Z");

const createServices = (overrides = {}) => ({
  executiveAnalyticsService: {
    getExecutiveDashboard: async (filters) => ({
      report: "EXECUTIVE_ANALYTICS",
      filters,
      dataQuality: { warnings: [] },
      drillDown: { accountingPostings: { route: "/api/admin/business-accounting/foundation" } }
    })
  },
  salesAnalyticsService: {
    getSalesAnalytics: async (filters) => ({
      report: "SALES_ANALYTICS",
      filters,
      dataQuality: { warnings: [{ code: "TEST_WARNING", severity: "INFO" }] },
      drillDown: { bookings: { route: "/api/bookings" } }
    })
  },
  productAnalyticsService: {
    getProductAnalytics: async (filters) => ({
      report: "PRODUCT_ANALYTICS",
      filters,
      dataQuality: { warnings: [] }
    })
  },
  channelAnalyticsService: {
    getChannelAnalytics: async (filters) => ({
      report: "CHANNEL_ANALYTICS",
      filters,
      dataQuality: { warnings: [] }
    })
  },
  trendAnalyticsService: {
    getTrendAnalytics: async (filters) => ({
      report: "TREND_ANALYTICS",
      filters,
      dataQuality: { warnings: [] }
    })
  },
  businessAccountingService: {
    getFoundationSummary: async (filters) => ({
      reportLabel: "Management Business Accounting Foundation",
      filters,
      totals: {
        bookingNetContribution: 0,
        otherBusinessIncome: 0,
        companyContributionRevenue: 0,
        companyExpenses: 0,
        companyNetProfit: 0
      }
    })
  },
  ...overrides
});

test("report center catalog exposes groups, canonical reports and export contracts", () => {
  const service = createReportCenterService({
    services: createServices(),
    now: () => fixedNow
  });

  const catalog = service.listCatalog();
  const executive = catalog.reports.find((report) => report.type === REPORT_TYPE.EXECUTIVE_BUSINESS_SUMMARY);

  assert.equal(catalog.generatedAt, "2026-08-15T10:30:00.000Z");
  assert.equal(catalog.queryRules.reportsUseCanonicalServices, true);
  assert.equal(catalog.queryRules.exportsUseSameQueryDefinition, true);
  assert.equal(catalog.queryRules.frontendRawDatabaseQueriesAllowed, false);
  assert.ok(catalog.groups.some((group) => group.key === REPORT_GROUP.REFUND));
  assert.ok(catalog.groups.some((group) => group.key === REPORT_GROUP.EXPORT_HISTORY));
  assert.ok(catalog.reports.some((report) => report.type === REPORT_TYPE.DAILY_MANAGEMENT_REPORT));
  assert.ok(catalog.reports.some((report) => report.type === REPORT_TYPE.MONTHLY_MANAGEMENT_REPORT));
  assert.ok(catalog.reports.some((report) => report.type === REPORT_TYPE.ANNUAL_MANAGEMENT_REPORT));
  assert.ok(catalog.reports.some((report) => report.type === REPORT_TYPE.PRODUCT_BEST_SELLERS));
  assert.ok(catalog.reports.some((report) => report.type === REPORT_TYPE.CHANNEL_COMPARISON_REPORT));
  assert.ok(catalog.reports.some((report) => report.type === REPORT_TYPE.PROFITABILITY_OVERVIEW));
  assert.ok(catalog.reports.some((report) => report.type === REPORT_TYPE.MANAGEMENT_CASH_FLOW_REPORT));
  assert.ok(catalog.reports.some((report) => report.type === REPORT_TYPE.RECEIVABLES_AGING_REPORT));
  assert.ok(catalog.reports.some((report) => report.type === REPORT_TYPE.PAYABLES_AGING_REPORT));
  assert.ok(executive);
  assert.equal(executive.sourceOfTruth.duplicatesFinancialTruth, false);
  assert.deepEqual(executive.supportedExports, Object.values(REPORT_EXPORT_FORMAT));
  assert.equal(Object.prototype.hasOwnProperty.call(executive, "runner"), false);
  const productBestSellers = catalog.reports.find((report) => report.type === REPORT_TYPE.PRODUCT_BEST_SELLERS);
  assert.equal(productBestSellers.reportView.rankingKey, PRODUCT_RANKING.BEST_SELLING_BY_BOOKINGS);
});

test("sales report delegates to canonical sales analytics and preserves normalized filters", async () => {
  let capturedFilters = null;
  const service = createReportCenterService({
    services: createServices({
      salesAnalyticsService: {
        getSalesAnalytics: async (filters) => {
          capturedFilters = filters;
          return {
            report: "SALES_ANALYTICS",
            filters,
            dataQuality: { warnings: [{ code: "MISSING_POSTINGS", severity: "WARNING" }] },
            drillDown: { bookings: { route: "/api/bookings" } }
          };
        }
      }
    }),
    now: () => fixedNow
  });

  const result = await service.runReport({
    reportType: REPORT_TYPE.SALES_SUMMARY,
    filters: {
      period: ANALYTICS_PERIOD.CUSTOM,
      from: "2026-08-01",
      to: "2026-08-31",
      compare: ANALYTICS_COMPARE_MODE.NONE,
      granularity: ANALYTICS_GRANULARITY.DAY,
      channel: SALES_CHANNEL.DIRECT_WEBSITE,
      productId: "P-1",
      refundStatus: "refunded"
    },
    auth: { id: "admin-1" },
    requestId: "req-1"
  });

  assert.equal(capturedFilters.period, ANALYTICS_PERIOD.CUSTOM);
  assert.equal(capturedFilters.dateDimension, ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE);
  assert.equal(capturedFilters.granularity, ANALYTICS_GRANULARITY.DAY);
  assert.equal(capturedFilters.channel, SALES_CHANNEL.DIRECT_WEBSITE);
  assert.equal(capturedFilters.productId, "P-1");
  assert.equal(Object.prototype.hasOwnProperty.call(capturedFilters, "refundStatus"), false);
  assert.equal(result.period.fromIso, "2026-07-31T21:00:00.000Z");
  assert.equal(result.period.toIso, "2026-08-31T21:00:00.000Z");
  assert.equal(result.generatedBy, "admin-1");
  assert.equal(result.requestId, "req-1");
  assert.equal(result.sourceIntegrity.formulasDuplicatedInReportCenter, false);
  assert.equal(result.exportPlan.usesSameQueryDefinition, true);
  assert.equal(result.exportPlan.status, "AVAILABLE");
  assert.equal(result.exportPlan.historyTracking, "ENABLED_RESPONSE_ONLY");
  assert.deepEqual(result.dataQuality.warnings, [{ code: "MISSING_POSTINGS", severity: "WARNING" }]);
});

test("daily management report composes canonical services with separate date dimensions", async () => {
  const salesCalls = [];
  let executiveCall = null;
  let trendCall = null;
  const service = createReportCenterService({
    services: createServices({
      executiveAnalyticsService: {
        getExecutiveDashboard: async (filters) => {
          executiveCall = filters;
          return {
            report: "EXECUTIVE_ANALYTICS",
            kpis: {
              collectedRevenue: { value: 80 },
              refundedAmount: { value: 10 },
              operatingExpenses: { value: 20 },
              grossProfit: { value: 50 },
              netProfit: { value: 30 },
              profitMargin: { value: 37.5, supported: true }
            },
            financialBreakdown: {
              bookedRevenue: 100,
              directBookingCosts: 30
            },
            dataQuality: { warnings: [{ code: "FINANCE_WARNING", severity: "WARNING" }] },
            drillDown: { accountingPostings: { route: "/api/admin/business-accounting/foundation" } }
          };
        }
      },
      salesAnalyticsService: {
        getSalesAnalytics: async (filters) => {
          salesCalls.push(filters);
          const isTravel = filters.dateDimension === ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE;
          return {
            report: "SALES_ANALYTICS",
            totals: {
              confirmedBookings: isTravel ? 3 : 2,
              participants: isTravel ? 7 : 5
            },
            dataQuality: {
              warnings: isTravel ? [{ code: "TRAVEL_WARNING", severity: "INFO" }] : []
            },
            drillDown: { bookings: { route: "/api/bookings", filters } }
          };
        }
      },
      trendAnalyticsService: {
        getTrendAnalytics: async (filters) => {
          trendCall = filters;
          return {
            report: "TREND_ANALYTICS",
            trends: { combined: [{ bucket: "2026-08-15" }] },
            dataQuality: { warnings: [] },
            drillDown: { operationalBookings: { route: "/api/bookings" } }
          };
        }
      }
    }),
    now: () => fixedNow
  });

  const result = await service.runReport({
    reportType: REPORT_TYPE.DAILY_MANAGEMENT_REPORT
  });

  assert.equal(result.filters.period, ANALYTICS_PERIOD.TODAY);
  assert.equal(result.filters.granularity, ANALYTICS_GRANULARITY.DAY);
  assert.equal(executiveCall.dateDimension, ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE);
  assert.equal(executiveCall.operationalDateDimension, ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE);
  assert.equal(salesCalls.length, 2);
  assert.equal(salesCalls[0].dateDimension, ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE);
  assert.equal(salesCalls[1].dateDimension, ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE);
  assert.equal(trendCall.financialDateDimension, ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE);
  assert.equal(trendCall.operationalDateDimension, ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE);
  assert.equal(result.data.profile.key, "DAILY");
  assert.equal(result.data.managementSummary.bookingsCreated.value, 2);
  assert.equal(result.data.managementSummary.toursOperating.value, 3);
  assert.equal(result.data.managementSummary.collectedRevenue.value, 80);
  assert.equal(result.data.managementSummary.netCashMovement.supported, false);
  assert.equal(result.data.sourceOfTruth.noSecondAccountingTruth, true);
  assert.deepEqual(
    result.dataQuality.warnings.map((warning) => warning.code),
    ["FINANCE_WARNING", "TRAVEL_WARNING"]
  );
  assert.ok(result.drillDown["financial.accountingPostings"]);
  assert.ok(result.drillDown["bookingsCreated.bookings"]);
  assert.ok(result.drillDown["toursOperating.bookings"]);
});

test("monthly management report defaults to monthly period with weekly breakdown", async () => {
  let trendCall = null;
  const service = createReportCenterService({
    services: createServices({
      trendAnalyticsService: {
        getTrendAnalytics: async (filters) => {
          trendCall = filters;
          return {
            report: "TREND_ANALYTICS",
            dataQuality: { warnings: [] }
          };
        }
      }
    }),
    now: () => fixedNow
  });

  const result = await service.runReport({
    reportType: REPORT_TYPE.MONTHLY_MANAGEMENT_REPORT
  });

  assert.equal(result.filters.period, ANALYTICS_PERIOD.THIS_MONTH);
  assert.equal(result.filters.granularity, ANALYTICS_GRANULARITY.WEEK);
  assert.equal(trendCall.granularity, ANALYTICS_GRANULARITY.WEEK);
  assert.equal(result.data.profile.key, "MONTHLY");
});

test("multi-year comparison requires explicit bounds and uses yearly trend buckets", async () => {
  let trendCall = null;
  const service = createReportCenterService({
    services: createServices({
      trendAnalyticsService: {
        getTrendAnalytics: async (filters) => {
          trendCall = filters;
          return {
            report: "TREND_ANALYTICS",
            dataQuality: { warnings: [] }
          };
        }
      }
    }),
    now: () => fixedNow
  });

  await assert.rejects(
    () => service.runReport({
      reportType: REPORT_TYPE.MULTI_YEAR_COMPARISON
    }),
    (error) => error.code === "ANALYTICS_MULTI_YEAR_RANGE_REQUIRED"
  );

  const result = await service.runReport({
    reportType: REPORT_TYPE.MULTI_YEAR_COMPARISON,
    filters: {
      from: "2024-01-01",
      to: "2026-12-31"
    }
  });

  assert.equal(result.filters.period, ANALYTICS_PERIOD.MULTI_YEAR);
  assert.equal(result.filters.granularity, ANALYTICS_GRANULARITY.YEAR);
  assert.equal(trendCall.granularity, ANALYTICS_GRANULARITY.YEAR);
  assert.equal(result.data.profile.key, "MULTI_YEAR");
  assert.equal(result.period.fromIso, "2023-12-31T21:00:00.000Z");
  assert.equal(result.period.toIso, "2026-12-31T21:00:00.000Z");
});

test("business accounting foundation receives period bounds instead of duplicate formulas", async () => {
  let capturedFilters = null;
  const service = createReportCenterService({
    services: createServices({
      businessAccountingService: {
        getFoundationSummary: async (filters) => {
          capturedFilters = filters;
          return {
            reportLabel: "Management Business Accounting Foundation",
            filters,
            totals: {
              bookingNetContribution: 10,
              otherBusinessIncome: 5,
              companyContributionRevenue: 15,
              companyExpenses: 4,
              companyNetProfit: 11
            }
          };
        }
      }
    }),
    now: () => fixedNow
  });

  const result = await service.runReport({
    reportType: REPORT_TYPE.BUSINESS_ACCOUNTING_FOUNDATION,
    filters: {
      period: ANALYTICS_PERIOD.THIS_MONTH
    }
  });

  assert.equal(capturedFilters.fromDate, "2026-07-31T21:00:00.000Z");
  assert.equal(capturedFilters.toDate, "2026-08-31T21:00:00.000Z");
  assert.equal(result.report.sourceOfTruth.duplicatesFinancialTruth, false);
  assert.equal(result.data.totals.companyNetProfit, 11);
  assert.equal(result.dataQuality.status, "NOT_REPORTED");
});

test("management profit and loss report wraps business accounting foundation without statutory labels", async () => {
  let capturedFilters = null;
  const service = createReportCenterService({
    services: createServices({
      businessAccountingService: {
        getFoundationSummary: async (filters) => {
          capturedFilters = filters;
          return {
            reportLabel: "Management Business Accounting Foundation",
            totals: {
              bookingNetContribution: 100,
              otherBusinessIncome: 25,
              companyContributionRevenue: 125,
              companyExpenses: 40,
              companyNetProfit: 85
            }
          };
        }
      }
    }),
    now: () => fixedNow
  });

  const result = await service.runReport({
    reportType: REPORT_TYPE.MANAGEMENT_PROFIT_LOSS_REPORT
  });

  assert.equal(capturedFilters.fromDate, "2026-07-31T21:00:00.000Z");
  assert.equal(result.data.report, "MANAGEMENT_PROFIT_LOSS_REPORT");
  assert.equal(result.data.statutoryReport, false);
  assert.equal(result.data.totals.companyNetProfit, 85);
  assert.equal(result.sourceIntegrity.formulasDuplicatedInReportCenter, false);
});

test("management cash flow reports movement without fabricating opening or closing balance", async () => {
  const service = createReportCenterService({
    services: createServices({
      PaymentModel: {
        find: () => [
          { status: "paid", accountingAmount: "100", providerFeeAmount: "3", paidAt: "2026-08-10T09:00:00.000Z" },
          { status: "paid", accountingAmount: "50", providerFeeAmount: "2", paidAt: "2026-08-11T09:00:00.000Z" }
        ]
      },
      businessAccountingService: {
        listBusinessIncome: async () => ({
          items: [
            { incomeReference: "BI-1", status: FINANCIAL_ENTRY_STATUS.PAID, baseCurrencyAmount: "20" }
          ]
        }),
        listBusinessExpenses: async () => ({
          items: [
            { expenseReference: "BE-1", status: FINANCIAL_ENTRY_STATUS.PAID, paymentStatus: EXPENSE_PAYMENT_STATUS.PAID, baseCurrencyAmount: "30" }
          ]
        }),
        getFoundationSummary: async () => ({ totals: {} })
      }
    }),
    now: () => fixedNow
  });

  const result = await service.runReport({
    reportType: REPORT_TYPE.MANAGEMENT_CASH_FLOW_REPORT
  });

  assert.equal(result.data.cashIn, 170);
  assert.equal(result.data.cashOut, 35);
  assert.equal(result.data.netMovement, 135);
  assert.equal(result.data.openingBalance.supported, false);
  assert.equal(result.data.closingBalance.supported, false);
  assert.equal(result.data.statutoryReport, false);
});

test("receivables aging report uses invoice balance snapshots and aging buckets", async () => {
  const service = createReportCenterService({
    services: createServices({
      InvoiceModel: {
        find: () => [
          {
            invoiceNumber: "INV-1",
            bookingReference: "ZNZ-1",
            clientName: "Asha",
            issueDate: "2026-08-01T09:00:00.000Z",
            paymentStatus: "pending",
            total: 100,
            amountPaid: 40,
            balanceDue: 60,
            accountingCurrency: "USD"
          },
          {
            invoiceNumber: "INV-PAID",
            issueDate: "2026-08-01T09:00:00.000Z",
            paymentStatus: "paid",
            total: 50,
            amountPaid: 50,
            balanceDue: 0
          }
        ]
      }
    }),
    now: () => fixedNow
  });

  const result = await service.runReport({
    reportType: REPORT_TYPE.RECEIVABLES_AGING_REPORT
  });

  assert.equal(result.data.report, "RECEIVABLES_AGING_REPORT");
  assert.equal(result.data.statutoryReport, false);
  assert.equal(result.data.rows.length, 1);
  assert.equal(result.data.rows[0].outstanding, 60);
  assert.equal(result.data.rows[0].agingBucket, "1_30");
  assert.equal(result.data.totals.outstanding, 60);
});

test("payables aging report uses unpaid BusinessExpense evidence", async () => {
  const service = createReportCenterService({
    services: createServices({
      BusinessExpenseModel: {
        find: () => [
          {
            expenseReference: "BE-UNPAID",
            supplier: { name: "Fuel Supplier" },
            category: "VEHICLE_OVERHEAD",
            paymentStatus: EXPENSE_PAYMENT_STATUS.UNPAID,
            status: FINANCIAL_ENTRY_STATUS.APPROVED,
            baseCurrencyAmount: "45",
            baseCurrency: "USD",
            dueDate: "2026-07-01T09:00:00.000Z"
          }
        ]
      }
    }),
    now: () => fixedNow
  });

  const result = await service.runReport({
    reportType: REPORT_TYPE.PAYABLES_AGING_REPORT
  });

  assert.equal(result.data.report, "PAYABLES_AGING_REPORT");
  assert.equal(result.data.rows[0].payee, "Fuel Supplier");
  assert.equal(result.data.rows[0].outstanding, 45);
  assert.equal(result.data.rows[0].agingBucket, "31_60");
  assert.equal(result.data.totals.outstanding, 45);
});

test("asset register remains unsupported instead of generating fake assets", async () => {
  const service = createReportCenterService({
    services: createServices(),
    now: () => fixedNow
  });

  const result = await service.runReport({
    reportType: REPORT_TYPE.ASSET_REGISTER
  });

  assert.equal(result.data.report, "ASSET_REGISTER");
  assert.equal(result.data.supported, false);
  assert.deepEqual(result.data.rows, []);
});

test("product best sellers report returns the selected Product Analytics ranking", async () => {
  let capturedFilters = null;
  const bestSellers = [
    { productId: "PROD-1", productTitle: "Spice Tour", confirmedBookings: 12, participants: 30 },
    { productId: "PROD-2", productTitle: "Stone Town", confirmedBookings: 7, participants: 18 }
  ];
  const service = createReportCenterService({
    services: createServices({
      productAnalyticsService: {
        getProductAnalytics: async (filters) => {
          capturedFilters = filters;
          return {
            report: "PRODUCT_ANALYTICS",
            sourceOfTruth: { noSecondAccountingTruth: true },
            totals: { confirmedBookings: 19 },
            rankings: {
              [PRODUCT_RANKING.BEST_SELLING_BY_BOOKINGS]: bestSellers
            },
            products: [],
            dataQuality: { warnings: [] },
            drillDown: { bookings: { route: "/api/bookings" } },
            limitations: ["Product analytics limitation"]
          };
        }
      }
    }),
    now: () => fixedNow
  });

  const result = await service.runReport({
    reportType: REPORT_TYPE.PRODUCT_BEST_SELLERS,
    filters: {
      period: ANALYTICS_PERIOD.THIS_MONTH,
      channel: SALES_CHANNEL.VIATOR,
      productId: "PROD-1"
    }
  });

  assert.equal(capturedFilters.channel, SALES_CHANNEL.VIATOR);
  assert.equal(capturedFilters.productId, "PROD-1");
  assert.equal(capturedFilters.dateDimension, ANALYTICS_DATE_DIMENSION.BOKUN_BOOKING_CREATED_DATE);
  assert.equal(result.data.report, "PRODUCT_REPORT_VIEW");
  assert.equal(result.data.view.rankingKey, PRODUCT_RANKING.BEST_SELLING_BY_BOOKINGS);
  assert.deepEqual(result.data.rows, bestSellers);
  assert.equal(result.sourceIntegrity.formulasDuplicatedInReportCenter, false);
});

test("channel net profit report answers which channel makes the most net profit", async () => {
  const rows = [
    { channel: SALES_CHANNEL.GETYOURGUIDE, label: "GetYourGuide", netProfit: 900 },
    { channel: SALES_CHANNEL.DIRECT_WEBSITE, label: "Direct Website", netProfit: 700 }
  ];
  const service = createReportCenterService({
    services: createServices({
      channelAnalyticsService: {
        getChannelAnalytics: async () => ({
          report: "CHANNEL_ANALYTICS",
          answers: {
            mostNetProfitableChannel: rows[0],
            highestSalesChannel: rows[1]
          },
          rankings: {
            [CHANNEL_RANKING.HIGHEST_NET_PROFIT]: rows
          },
          channels: rows,
          totals: { netProfit: 1600 },
          dataQuality: { warnings: [] },
          drillDown: { bookings: { route: "/api/bookings" } }
        })
      }
    }),
    now: () => fixedNow
  });

  const result = await service.runReport({
    reportType: REPORT_TYPE.CHANNEL_NET_PROFIT_REPORT
  });

  assert.equal(result.data.report, "CHANNEL_REPORT_VIEW");
  assert.equal(result.data.view.rankingKey, CHANNEL_RANKING.HIGHEST_NET_PROFIT);
  assert.equal(result.data.answers.mostNetProfitableChannel.channel, SALES_CHANNEL.GETYOURGUIDE);
  assert.deepEqual(result.data.rows, rows);
});

test("product cost evidence report does not fabricate estimated-vs-actual variance", async () => {
  const service = createReportCenterService({
    services: createServices({
      productAnalyticsService: {
        getProductAnalytics: async () => ({
          report: "PRODUCT_ANALYTICS",
          rankings: {},
          products: [
            {
              productId: "PROD-1",
              productTitle: "Safari Blue",
              directCosts: 55,
              dataQuality: { missingCostRecords: 2, missingAccountingPostings: 1 }
            }
          ],
          dataQuality: {
            warnings: [{ code: "PRODUCT_COSTS_INCOMPLETE", severity: "WARNING" }]
          }
        })
      }
    }),
    now: () => fixedNow
  });

  const result = await service.runReport({
    reportType: REPORT_TYPE.PRODUCT_COST_VARIANCE_REPORT
  });

  assert.equal(result.data.view.kind, "PRODUCT_COST_VARIANCE");
  assert.equal(result.data.rows[0].varianceSupported, false);
  assert.equal(result.data.rows[0].missingCostRecords, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(result.data.rows[0], "estimatedCost"), false);
  assert.equal(result.dataQuality.warnings[0].code, "PRODUCT_COSTS_INCOMPLETE");
});

test("profitability overview composes product, channel and trend analytics with explicit grouping support", async () => {
  const lossProduct = { productId: "PROD-LOSS", netContribution: -25 };
  const lossChannel = { channel: SALES_CHANNEL.OTHER, netProfit: -10 };
  const service = createReportCenterService({
    services: createServices({
      productAnalyticsService: {
        getProductAnalytics: async () => ({
          report: "PRODUCT_ANALYTICS",
          rankings: { [PRODUCT_RANKING.LOSS_MAKING]: [lossProduct] },
          products: [lossProduct],
          totals: { netContribution: -25 },
          dataQuality: { warnings: [] },
          drillDown: { bookings: { route: "/api/bookings" } }
        })
      },
      channelAnalyticsService: {
        getChannelAnalytics: async () => ({
          report: "CHANNEL_ANALYTICS",
          answers: { mostNetProfitableChannel: null },
          rankings: { [CHANNEL_RANKING.LOSS_MAKING]: [lossChannel] },
          channels: [lossChannel],
          totals: { netProfit: -10 },
          dataQuality: { warnings: [{ code: "CHANNEL_WARNING", severity: "INFO" }] },
          drillDown: { bookings: { route: "/api/bookings" } }
        })
      },
      trendAnalyticsService: {
        getTrendAnalytics: async (filters) => ({
          report: "TREND_ANALYTICS",
          filters,
          totals: { financial: { netProfit: -35 } },
          trends: { combined: [{ bucket: "2026-08" }] },
          dataQuality: { warnings: [] },
          drillDown: { accountingPostings: { route: "/api/admin/business-accounting/foundation" } }
        })
      }
    }),
    now: () => fixedNow
  });

  const result = await service.runReport({
    reportType: REPORT_TYPE.PROFITABILITY_OVERVIEW,
    filters: {
      granularity: ANALYTICS_GRANULARITY.MONTH
    }
  });

  assert.equal(result.data.report, "PROFITABILITY_OVERVIEW");
  assert.deepEqual(result.data.lossSummary.products, [lossProduct]);
  assert.deepEqual(result.data.lossSummary.channels, [lossChannel]);
  assert.ok(result.data.supportedGroupings.some((grouping) => grouping.grouping === "PRODUCT" && grouping.status === "SUPPORTED"));
  assert.ok(result.data.supportedGroupings.some((grouping) => grouping.grouping === "AGENT" && grouping.status === "PLANNED"));
  assert.equal(result.dataQuality.warnings[0].code, "CHANNEL_WARNING");
  assert.ok(result.drillDown["product.bookings"]);
  assert.ok(result.drillDown["channel.bookings"]);
  assert.ok(result.drillDown["trend.accountingPostings"]);
});

test("executive report keeps financial and operational date dimensions separate", async () => {
  let capturedFilters = null;
  const service = createReportCenterService({
    services: createServices({
      executiveAnalyticsService: {
        getExecutiveDashboard: async (filters) => {
          capturedFilters = filters;
          return {
            report: "EXECUTIVE_ANALYTICS",
            filters,
            dataQuality: { warnings: [] }
          };
        }
      }
    }),
    now: () => fixedNow
  });

  await service.runReport({
    reportType: REPORT_TYPE.EXECUTIVE_BUSINESS_SUMMARY,
    filters: {
      financialDateDimension: ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE,
      operationalDateDimension: ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE
    }
  });

  assert.equal(capturedFilters.dateDimension, ANALYTICS_DATE_DIMENSION.ACCOUNTING_TRANSACTION_DATE);
  assert.equal(capturedFilters.operationalDateDimension, ANALYTICS_DATE_DIMENSION.BOKUN_TRAVEL_DATE);
});

test("report center rejects unsupported report types and invalid periods", async () => {
  const service = createReportCenterService({
    services: createServices(),
    now: () => fixedNow
  });

  await assert.rejects(
    () => service.runReport({ reportType: "UNKNOWN_REPORT" }),
    (error) => error.code === "REPORT_TYPE_NOT_SUPPORTED"
  );

  await assert.rejects(
    () => service.runReport({
      reportType: REPORT_TYPE.SALES_SUMMARY,
      filters: { period: "NEXT_CENTURY" }
    }),
    (error) => error.code === "REPORT_PERIOD_INVALID"
  );
});

const createExportReportResult = () => ({
  report: {
    type: REPORT_TYPE.PRODUCT_BEST_SELLERS,
    title: "Product Best Sellers",
    columns: [
      { key: "product", label: "Product", source: "rows.productTitle" },
      { key: "bookings", label: "Bookings", source: "rows.confirmedBookings" },
      { key: "revenue", label: "Revenue", source: "rows.bookedRevenue" }
    ]
  },
  generatedAt: "2026-08-15T10:30:00.000Z",
  generatedBy: "admin-1",
  requestId: "req-export-1",
  filters: {
    period: ANALYTICS_PERIOD.THIS_MONTH,
    productId: "PROD-1"
  },
  period: {
    label: "This Month",
    fromIso: "2026-07-31T21:00:00.000Z",
    toIso: "2026-08-31T21:00:00.000Z"
  },
  data: {
    report: "PRODUCT_REPORT_VIEW",
    rows: [
      { productTitle: "Spice Tour", confirmedBookings: 2, bookedRevenue: 100 },
      { productTitle: "Stone Town", confirmedBookings: 1, bookedRevenue: 50 }
    ],
    totals: { bookedRevenue: 150 }
  }
});

test("report export service renders CSV from the same report query and records history", async () => {
  const createdHistory = [];
  let capturedRunArgs = null;
  const service = createReportExportService({
    reportService: {
      runReport: async (args) => {
        capturedRunArgs = args;
        return createExportReportResult();
      }
    },
    ExportModel: {
      create: async (payload) => {
        createdHistory.push(payload);
        return { _id: "export-1", ...payload };
      }
    },
    now: () => fixedNow
  });

  const result = await service.exportReport({
    reportType: REPORT_TYPE.PRODUCT_BEST_SELLERS,
    format: REPORT_EXPORT_FORMAT.CSV,
    filters: { period: ANALYTICS_PERIOD.THIS_MONTH, productId: "PROD-1" },
    auth: { id: "admin-1" },
    requestId: "req-export-1"
  });

  assert.equal(capturedRunArgs.reportType, REPORT_TYPE.PRODUCT_BEST_SELLERS);
  assert.deepEqual(capturedRunArgs.filters, { period: ANALYTICS_PERIOD.THIS_MONTH, productId: "PROD-1" });
  assert.equal(result.contentType, "text/csv; charset=utf-8");
  assert.equal(result.disposition, "attachment");
  assert.match(result.filename, /PRODUCT_BEST_SELLERS-2026-08-15T10-30-00-000Z\.csv$/);
  assert.match(result.content, /Product Best Sellers/);
  assert.match(result.content, /Product,Bookings,Revenue/);
  assert.match(result.content, /Spice Tour,2,100/);
  assert.equal(result.rowCount, 2);
  assert.equal(createdHistory.length, 1);
  assert.equal(createdHistory[0].status, "completed");
  assert.equal(createdHistory[0].rowCount, 2);
  assert.equal(createdHistory[0].metadata.usesSameQueryDefinition, true);
  assert.equal(result.history.id, "export-1");
});

test("report export service renders Excel XML, print HTML and simple PDF", async () => {
  const service = createReportExportService({
    reportService: {
      runReport: async () => createExportReportResult()
    },
    ExportModel: {
      create: async (payload) => ({ _id: `${payload.format}-1`, ...payload })
    },
    now: () => fixedNow
  });

  const excel = await service.exportReport({
    reportType: REPORT_TYPE.PRODUCT_BEST_SELLERS,
    format: REPORT_EXPORT_FORMAT.EXCEL
  });
  assert.match(excel.content, /^<\?xml version="1.0"\?>/);
  assert.match(excel.content, /Workbook/);
  assert.match(excel.content, /Spice Tour/);

  const print = await service.exportReport({
    reportType: REPORT_TYPE.PRODUCT_BEST_SELLERS,
    format: REPORT_EXPORT_FORMAT.PRINT
  });
  assert.equal(print.disposition, "inline");
  assert.match(print.content, /<!doctype html>/);
  assert.match(print.content, /<table>/);

  const pdf = await service.exportReport({
    reportType: REPORT_TYPE.PRODUCT_BEST_SELLERS,
    format: REPORT_EXPORT_FORMAT.PDF
  });
  assert.ok(Buffer.isBuffer(pdf.content));
  assert.equal(pdf.content.subarray(0, 8).toString("latin1"), "%PDF-1.4");
  assert.equal(pdf.contentType, "application/pdf");
});

test("report export history supports report, format and limit filters", async () => {
  let capturedQuery = null;
  let capturedSort = null;
  let capturedLimit = null;
  const service = createReportExportService({
    ExportModel: {
      find: (query) => {
        capturedQuery = query;
        return {
          sort: (sortValue) => {
            capturedSort = sortValue;
            return {
              limit: (limitValue) => {
                capturedLimit = limitValue;
                return {
                  lean: async () => [
                    {
                      _id: "export-history-1",
                      reportType: REPORT_TYPE.SALES_SUMMARY,
                      format: REPORT_EXPORT_FORMAT.CSV,
                      status: "completed",
                      generatedAt: "2026-08-15T10:30:00.000Z",
                      rowCount: 3
                    }
                  ]
                };
              }
            };
          }
        };
      }
    }
  });

  const result = await service.listExportHistory({
    reportType: REPORT_TYPE.SALES_SUMMARY,
    format: REPORT_EXPORT_FORMAT.CSV,
    limit: 10
  });

  assert.deepEqual(capturedQuery, {
    reportType: REPORT_TYPE.SALES_SUMMARY,
    format: REPORT_EXPORT_FORMAT.CSV
  });
  assert.deepEqual(capturedSort, { generatedAt: -1 });
  assert.equal(capturedLimit, 10);
  assert.equal(result.count, 1);
  assert.equal(result.items[0].id, "export-history-1");
  assert.equal(result.retainedFilesSupported, false);
});
