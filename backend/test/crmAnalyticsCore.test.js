process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/crm-analytics-core-test";
process.env.JWT_SECRET ||= "crm-analytics-core-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CRM_B2B_PARTNER_STATUS,
  CRM_B2B_PARTNER_TYPE,
  CRM_FOLLOW_UP_STATUS,
  CRM_LEAD_SOURCE,
  CRM_LEAD_STATUS,
  CRM_OPPORTUNITY_STAGE,
  CRM_QUOTE_STATUS,
  CRM_TASK_STATUS
} = require("../src/crm/constants");
const { createCrmAnalyticsService } = require("../src/services/crmAnalytics");

const clone = (value) => JSON.parse(JSON.stringify(value));
const id = (index) => `66a70000000000000000${String(index).padStart(4, "0")}`.slice(0, 24);
const valueAtPath = (row, path = "") =>
  path.split(".").reduce((current, part) => (current === undefined || current === null ? undefined : current[part]), row);
const comparable = (value) => {
  if (value instanceof Date) return value.getTime();
  const date = new Date(value);
  if (!Number.isNaN(date.getTime()) && /T|\d{4}-\d{2}-\d{2}/.test(String(value))) return date.getTime();
  return value;
};
const matches = (row, query = {}) =>
  Object.entries(query || {}).every(([key, expected]) => {
    const actual = valueAtPath(row, key);
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if (expected.$gte !== undefined && comparable(actual) < comparable(expected.$gte)) return false;
      if (expected.$lt !== undefined && comparable(actual) >= comparable(expected.$lt)) return false;
      if (expected.$in && !expected.$in.includes(actual)) return false;
      return true;
    }
    return String(actual || "") === String(expected || "");
  });
const queryResult = (rows = []) => ({
  select() {
    return this;
  },
  sort() {
    return this;
  },
  async lean() {
    return clone(rows);
  }
});
const modelOf = (rows = []) => ({
  find: (query = {}) => queryResult(rows.filter((row) => matches(row, query)))
});
const createHarness = () => {
  const leads = [
    {
      _id: id(1),
      fullName: "Asha Direct",
      source: CRM_LEAD_SOURCE.WEBSITE,
      status: CRM_LEAD_STATUS.QUALIFIED,
      assignedTo: { id: "seller-1" },
      interestedProducts: [{ productId: "P-1", productTitle: "Stone Town Tour", optionId: "O-1", optionTitle: "Morning" }],
      createdAt: "2026-08-01T09:00:00.000Z"
    },
    {
      _id: id(2),
      fullName: "B2B Buyer",
      source: CRM_LEAD_SOURCE.B2B,
      status: CRM_LEAD_STATUS.CONVERTED,
      assignedTo: { id: "seller-2" },
      interestedProducts: [{ productId: "P-2", productTitle: "Spice Farm", optionId: "O-2", optionTitle: "Private" }],
      createdAt: "2026-08-02T09:00:00.000Z"
    },
    {
      _id: id(3),
      fullName: "Unqualified Lead",
      source: CRM_LEAD_SOURCE.WEBSITE,
      status: CRM_LEAD_STATUS.NEW,
      assignedTo: { id: "seller-1" },
      interestedProducts: [],
      createdAt: "2026-08-03T09:00:00.000Z"
    }
  ];
  const opportunities = [
    {
      _id: id(4),
      leadId: id(1),
      title: "Direct Stone Town",
      stage: CRM_OPPORTUNITY_STAGE.NEGOTIATION,
      estimatedValue: 100,
      currency: "USD",
      probability: 50,
      source: CRM_LEAD_SOURCE.WEBSITE,
      assignedTo: { id: "seller-1" },
      interestedProducts: [{ productId: "P-1", productTitle: "Stone Town Tour", optionId: "O-1", optionTitle: "Morning" }],
      createdAt: "2026-08-04T09:00:00.000Z"
    },
    {
      _id: id(5),
      leadId: id(2),
      title: "B2B Spice",
      stage: CRM_OPPORTUNITY_STAGE.WON,
      estimatedValue: 200,
      currency: "USD",
      probability: 100,
      source: CRM_LEAD_SOURCE.B2B,
      assignedTo: { id: "seller-2" },
      wonBokunBookingId: "BOK-1",
      interestedProducts: [{ productId: "P-2", productTitle: "Spice Farm", optionId: "O-2", optionTitle: "Private" }],
      createdAt: "2026-08-05T09:00:00.000Z"
    },
    {
      _id: id(6),
      leadId: id(1),
      title: "Lost Direct",
      stage: CRM_OPPORTUNITY_STAGE.LOST,
      estimatedValue: 30,
      currency: "USD",
      probability: 0,
      source: CRM_LEAD_SOURCE.WEBSITE,
      assignedTo: { id: "seller-1" },
      lostReason: "PRICE_TOO_HIGH",
      interestedProducts: [{ productId: "P-1", productTitle: "Stone Town Tour", optionId: "O-1", optionTitle: "Morning" }],
      createdAt: "2026-08-06T09:00:00.000Z"
    }
  ];
  const quotes = [
    {
      _id: id(7),
      leadId: id(1),
      opportunityId: id(4),
      status: CRM_QUOTE_STATUS.SENT,
      total: 100,
      currency: "USD",
      lineItems: [{ productId: "P-1", productOptionId: "O-1", description: "Stone Town Tour", lineTotal: 100 }],
      createdAt: "2026-08-07T09:00:00.000Z"
    },
    {
      _id: id(8),
      leadId: id(2),
      opportunityId: id(5),
      status: CRM_QUOTE_STATUS.CONVERTED,
      total: 200,
      currency: "USD",
      convertedBookingId: id(9),
      bokunBookingId: "BOK-1",
      lineItems: [{ productId: "P-2", productOptionId: "O-2", description: "Spice Farm", lineTotal: 200 }],
      createdAt: "2026-08-08T09:00:00.000Z"
    }
  ];
  const followUps = [
    { _id: id(10), status: CRM_FOLLOW_UP_STATUS.PENDING, dueAt: "2026-08-10T09:00:00.000Z", assignedTo: { id: "seller-1" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { _id: id(11), status: CRM_FOLLOW_UP_STATUS.COMPLETED, dueAt: "2026-08-20T09:00:00.000Z", assignedTo: { id: "seller-2" }, createdAt: "2026-08-09T09:00:00.000Z" }
  ];
  const tasks = [
    { _id: id(12), status: CRM_TASK_STATUS.TODO, dueDate: "2026-08-10T09:00:00.000Z", assignedTo: { id: "seller-1" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { _id: id(13), status: CRM_TASK_STATUS.DONE, dueDate: "2026-08-10T09:00:00.000Z", assignedTo: { id: "seller-1" }, createdAt: "2026-08-09T09:00:00.000Z" }
  ];
  const partners = [
    {
      _id: id(14),
      partnerType: CRM_B2B_PARTNER_TYPE.TRAVEL_AGENT,
      status: CRM_B2B_PARTNER_STATUS.ACTIVE_PARTNER,
      assignedManager: { id: "seller-2" },
      createdAt: "2026-08-01T09:00:00.000Z"
    }
  ];
  const service = createCrmAnalyticsService({
    LeadModel: modelOf(leads),
    SalesOpportunityModel: modelOf(opportunities),
    QuoteModel: modelOf(quotes),
    FollowUpModel: modelOf(followUps),
    CrmTaskModel: modelOf(tasks),
    B2BPartnerModel: modelOf(partners),
    now: () => new Date("2026-08-15T12:00:00.000Z")
  });
  return { service };
};

test("CRM analytics calculates forecast funnel without claiming accounting revenue", async () => {
  const { service } = createHarness();
  const analytics = await service.getCrmAnalytics({ currency: "USD" });

  assert.equal(analytics.step, "7J");
  assert.equal(analytics.sourceOfTruth.pipelineValueIsForecastOnly, true);
  assert.equal(analytics.sourceOfTruth.quoteValueIsForecastOnly, true);
  assert.equal(analytics.sourceOfTruth.crmLostValueIsNotAccountingLoss, true);
  assert.equal(analytics.sourceOfTruth.actualRevenueSource, "Booking Accounting after Bokun confirmed booking");
  assert.equal(analytics.totals.leadCount, 3);
  assert.equal(analytics.totals.qualifiedLeadCount, 2);
  assert.equal(analytics.totals.openOpportunityCount, 1);
  assert.equal(analytics.totals.openPipelineValue, 100);
  assert.equal(analytics.totals.weightedPipelineValue, 50);
  assert.equal(analytics.totals.totalQuotedValue, 300);
  assert.equal(analytics.totals.acceptedQuoteValue, 200);
  assert.equal(analytics.totals.wonBookingEvidenceCount, 1);
  assert.equal(analytics.lost.totalEstimatedValue, 30);
  assert.equal(analytics.activities.overdueWorkCount, 2);
  assert.ok(analytics.limitations.some((item) => item.includes("Actual revenue")));
});

test("CRM analytics source filter derives quote attribution from linked leads and opportunities", async () => {
  const { service } = createHarness();
  const analytics = await service.getCrmAnalytics({ source: CRM_LEAD_SOURCE.WEBSITE, currency: "USD" });

  assert.equal(analytics.filters.source, CRM_LEAD_SOURCE.WEBSITE);
  assert.equal(analytics.totals.leadCount, 2);
  assert.equal(analytics.totals.opportunityCount, 2);
  assert.equal(analytics.totals.quoteCount, 1);
  assert.equal(analytics.totals.totalQuotedValue, 100);
  assert.equal(analytics.totals.acceptedQuoteValue, 0);
  assert.ok(analytics.limitations.some((item) => item.includes("Quote source attribution")));
});

test("CRM analytics reports product interest and B2B pipeline without ledger postings", async () => {
  const { service } = createHarness();
  const analytics = await service.getCrmAnalytics();
  const stoneTown = analytics.productInterest.find((row) => row.productId === "P-1");

  assert.ok(stoneTown);
  assert.equal(stoneTown.leadInterestCount, 1);
  assert.equal(stoneTown.opportunityCount, 2);
  assert.equal(stoneTown.quoteLineItemCount, 1);
  assert.equal(stoneTown.weightedPipelineValue, 50);
  assert.equal(analytics.b2b.partnerCount, 1);
  assert.equal(analytics.b2b.activePartnerCount, 1);
  assert.equal(analytics.b2b.accountingPostsLedgerEntries, false);
});
