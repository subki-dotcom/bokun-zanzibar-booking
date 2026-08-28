process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/crm-reports-core-test";
process.env.JWT_SECRET ||= "crm-reports-core-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const { CRM_REPORT_EXPORT_FORMAT, CRM_REPORT_TYPE } = require("../src/crm/constants");
const { createCrmReportsService } = require("../src/services/crmReports");

const analyticsPayload = {
  step: "7J",
  module: "CRM_ANALYTICS",
  generatedAt: "2026-08-15T12:00:00.000Z",
  filters: {
    source: "WEBSITE",
    currency: "USD"
  },
  sourceOfTruth: {
    actualRevenueSource: "Booking Accounting after Bokun confirmed booking",
    pipelineValueIsForecastOnly: true,
    quoteValueIsForecastOnly: true,
    crmLostValueIsNotAccountingLoss: true
  },
  totals: {
    leadCount: 3,
    qualifiedLeadCount: 2,
    openOpportunityCount: 1,
    openPipelineValue: 100,
    weightedPipelineValue: 50,
    quoteCount: 2,
    quoteAcceptanceRate: 50,
    totalQuotedValue: 300,
    acceptedQuoteValue: 200,
    lostOpportunityCount: 1,
    b2bPartnerCount: 2,
    activeB2BPartnerCount: 1,
    wonBookingEvidenceCount: 1
  },
  funnel: [
    { key: "LEADS", label: "Leads", count: 3, basis: "CRM lead records" },
    { key: "OPEN_OPPORTUNITIES", label: "Open opportunities", count: 1, value: 100, weightedValue: 50, rateFromPrevious: 50, basis: "CRM opportunity forecast" }
  ],
  leads: {
    bySource: [{ _id: "WEBSITE", count: 3 }]
  },
  pipeline: {
    byStage: [{ _id: "NEGOTIATION", count: 1, totalEstimatedValue: 100, weightedValue: 50 }],
    bySource: [{ _id: "WEBSITE", count: 1, totalEstimatedValue: 100 }]
  },
  quotes: {
    byStatus: [{ _id: "SENT", count: 1 }, { _id: "CONVERTED", count: 1 }]
  },
  lost: {
    byReason: [{ _id: "PRICE_TOO_HIGH", count: 1, totalEstimatedValue: 30 }]
  },
  b2b: {
    byStatus: [{ _id: "ACTIVE_PARTNER", count: 1 }],
    byType: [{ _id: "TRAVEL_AGENT", count: 2 }]
  },
  productInterest: [
    {
      productTitle: "Stone Town Tour",
      optionTitle: "Morning",
      totalSignals: 3,
      leadInterestCount: 1,
      opportunityCount: 1,
      quoteLineItemCount: 1,
      weightedPipelineValue: 50,
      quotedValue: 100
    }
  ],
  limitations: [
    "CRM pipeline and quote values are forecasts until a Bokun-confirmed booking enters local accounting."
  ]
};

const createHarness = () => {
  const calls = [];
  const service = createCrmReportsService({
    analyticsService: {
      getCrmAnalytics: async (filters = {}) => {
        calls.push(filters);
        return analyticsPayload;
      }
    },
    now: () => new Date("2026-08-16T09:00:00.000Z")
  });
  return { calls, service };
};

test("CRM report catalog exposes active CRM reports with CSV export only", () => {
  const { service } = createHarness();
  const catalog = service.listCatalog();

  assert.equal(catalog.step, "7K");
  assert.equal(catalog.module, "CRM_REPORTS");
  assert.ok(catalog.reports.find((report) => report.type === CRM_REPORT_TYPE.CRM_PIPELINE_FORECAST));
  assert.ok(catalog.reports.find((report) => report.type === CRM_REPORT_TYPE.CRM_B2B_PIPELINE));
  assert.deepEqual(catalog.filterOptions.exportFormats, [CRM_REPORT_EXPORT_FORMAT.CSV]);
  assert.equal(catalog.sourceOfTruth.pipelineValueIsForecastOnly, true);
});

test("CRM pipeline report delegates to analytics and preserves forecast guardrails", async () => {
  const { calls, service } = createHarness();
  const report = await service.runCrmReport({
    reportType: CRM_REPORT_TYPE.CRM_PIPELINE_FORECAST,
    filters: { source: "WEBSITE", currency: "USD" }
  });

  assert.deepEqual(calls[0], { source: "WEBSITE", currency: "USD" });
  assert.equal(report.step, "7K");
  assert.equal(report.report.type, CRM_REPORT_TYPE.CRM_PIPELINE_FORECAST);
  assert.equal(report.summary.weightedPipelineValue, 50);
  assert.equal(report.sourceOfTruth.actualRevenueSource, "Booking Accounting after Bokun confirmed booking");
  assert.equal(report.rows[0].stage, "NEGOTIATION");
  assert.equal(report.rows[0].forecastOnly, true);
  assert.ok(report.dataQuality.warnings[0].includes("forecasts"));
});

test("CRM report export renders CSV without requiring accounting writes", async () => {
  const { service } = createHarness();
  const exported = await service.exportCrmReport({
    reportType: CRM_REPORT_TYPE.CRM_CONVERSION_FUNNEL,
    format: CRM_REPORT_EXPORT_FORMAT.CSV,
    filters: { source: "WEBSITE" }
  });

  assert.equal(exported.format, CRM_REPORT_EXPORT_FORMAT.CSV);
  assert.equal(exported.contentType, "text/csv; charset=utf-8");
  assert.match(exported.filename, /^crm_conversion_funnel-2026-08-16\.csv$/);
  assert.match(exported.content, /Report,CRM Conversion Funnel/);
  assert.match(exported.content, /Source Of Truth,Booking Accounting after Bokun confirmed booking/);
  assert.match(exported.content, /Open opportunities,1,100,50,50,CRM opportunity forecast/);
});

test("CRM report service rejects unsupported report types and export formats", async () => {
  const { service } = createHarness();

  await assert.rejects(
    () => service.runCrmReport({ reportType: "MADE_UP_REPORT" }),
    (error) => error.code === "CRM_REPORT_TYPE_INVALID"
  );
  await assert.rejects(
    () => service.exportCrmReport({ reportType: CRM_REPORT_TYPE.CRM_PIPELINE_FORECAST, format: "PDF" }),
    (error) => error.code === "CRM_REPORT_EXPORT_FORMAT_INVALID"
  );
});
