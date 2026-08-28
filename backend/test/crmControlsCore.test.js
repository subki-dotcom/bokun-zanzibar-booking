process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/crm-controls-core-test";
process.env.JWT_SECRET ||= "crm-controls-core-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CRM_CONTROL_SEVERITY,
  CRM_DATA_QUALITY_ISSUE,
  CRM_FOLLOW_UP_STATUS,
  CRM_LEAD_STATUS,
  CRM_OPPORTUNITY_STAGE,
  CUSTOMER_DUPLICATE_STATUS,
  DUPLICATE_CANDIDATE_STATUS
} = require("../src/crm/constants");
const { createCrmControlsService } = require("../src/services/crmControls");

const clone = (value) => JSON.parse(JSON.stringify(value));
const id = (index) => `66c70000000000000000${String(index).padStart(4, "0")}`.slice(0, 24);
const valueAtPath = (row, path = "") =>
  path.split(".").reduce((current, part) => (current === undefined || current === null ? undefined : current[part]), row);
const matches = (row, query = {}) =>
  Object.entries(query || {}).every(([key, expected]) => {
    const actual = valueAtPath(row, key);
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
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
  limit(count) {
    rows = rows.slice(0, count);
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
  const now = () => new Date("2026-08-15T12:00:00.000Z");
  const linkedBookingId = id(20);
  const leads = [
    {
      _id: id(1),
      leadReference: "LEAD-001",
      status: CRM_LEAD_STATUS.NEW,
      assignedTo: {},
      email: "",
      phone: "",
      whatsappNumber: "",
      createdAt: "2026-08-12T09:00:00.000Z"
    }
  ];
  const opportunities = [
    {
      _id: id(2),
      opportunityNumber: "OPP-OPEN-001",
      stage: CRM_OPPORTUNITY_STAGE.NEGOTIATION,
      estimatedValue: 0,
      currency: "USD"
    },
    {
      _id: id(3),
      opportunityNumber: "OPP-WON-001",
      stage: CRM_OPPORTUNITY_STAGE.WON,
      estimatedValue: 100,
      currency: "USD",
      wonBookingId: linkedBookingId,
      wonBokunBookingId: ""
    },
    {
      _id: id(4),
      opportunityNumber: "OPP-WON-002",
      stage: CRM_OPPORTUNITY_STAGE.WON,
      estimatedValue: 150,
      currency: "USD",
      wonBookingId: null,
      wonBokunBookingId: "BOK-001"
    }
  ];
  const quotes = [
    {
      _id: id(5),
      quoteNumber: "QTE-001",
      status: "SENT",
      leadId: id(1),
      opportunityId: id(2),
      customerId: null,
      total: 100,
      currency: "USD"
    }
  ];
  const customers = [
    {
      _id: id(6),
      crmCustomerNumber: "CRM-001",
      email: "guest@example.test",
      deduplicationStatus: CUSTOMER_DUPLICATE_STATUS.POSSIBLE_DUPLICATE,
      possibleDuplicateReasons: ["email"]
    }
  ];
  const duplicateCandidates = [
    {
      _id: id(7),
      candidateKey: "email::guest@example.test",
      primaryCustomerId: id(6),
      duplicateCustomerId: id(8),
      status: DUPLICATE_CANDIDATE_STATUS.OPEN,
      confidence: 0.95,
      matchFields: ["email"]
    }
  ];
  const followUps = [
    {
      _id: id(9),
      type: "CALL",
      status: CRM_FOLLOW_UP_STATUS.PENDING,
      dueAt: "2026-08-14T10:00:00.000Z",
      assignedTo: { id: "seller-1" }
    }
  ];
  const bookings = [
    {
      _id: linkedBookingId,
      bookingReference: "ZNZ-CONF-001",
      bokunBookingId: "",
      bokunConfirmationCode: "",
      bokunStatus: { normalized: "unknown" }
    }
  ];
  const auditLogs = [
    { _id: id(10), action: "crm_lead_created", entityType: "Lead", entityId: id(1), createdAt: "2026-08-12T09:00:00.000Z" },
    { _id: id(11), action: "crm_quote_sent", entityType: "Quote", entityId: id(5), createdAt: "2026-08-12T09:10:00.000Z" },
    { _id: id(12), action: "crm_follow_up_status_changed", entityType: "FollowUp", entityId: id(9), createdAt: "2026-08-12T09:20:00.000Z" }
  ];

  const service = createCrmControlsService({
    AuditLogModel: modelOf(auditLogs),
    BookingModel: modelOf(bookings),
    CustomerModel: modelOf(customers),
    CustomerDuplicateCandidateModel: modelOf(duplicateCandidates),
    FollowUpModel: modelOf(followUps),
    LeadModel: modelOf(leads),
    QuoteModel: modelOf(quotes),
    SalesOpportunityModel: modelOf(opportunities),
    now
  });
  return { service };
};

test("CRM controls report audit, permission, privacy, and CRM data-quality posture", async () => {
  const { service } = createHarness();
  const result = await service.getCrmControls();
  const issueCodes = result.dataQuality.items.map((issue) => issue.code);

  assert.equal(result.step, "7N");
  assert.equal(result.module, "CRM_AUDIT_PERMISSIONS_DATA_QUALITY");
  assert.equal(result.sourceOfTruth.operationalBookingSource, "Bokun confirmed bookings remain operational booking truth after conversion.");
  assert.equal(result.sourceOfTruth.forecastGuardrail, "CRM pipeline and quote values are forecasts and are not posted as accounting revenue.");
  assert.ok(issueCodes.includes(CRM_DATA_QUALITY_ISSUE.LEAD_MISSING_CONTACT));
  assert.ok(issueCodes.includes(CRM_DATA_QUALITY_ISSUE.LEAD_MISSING_OWNER));
  assert.ok(issueCodes.includes(CRM_DATA_QUALITY_ISSUE.OPPORTUNITY_MISSING_VALUE));
  assert.ok(issueCodes.includes(CRM_DATA_QUALITY_ISSUE.QUOTE_MISSING_CUSTOMER));
  assert.ok(issueCodes.includes(CRM_DATA_QUALITY_ISSUE.DUPLICATE_CUSTOMER_SUSPICION));
  assert.ok(issueCodes.includes(CRM_DATA_QUALITY_ISSUE.CONVERTED_OPPORTUNITY_WITHOUT_BOOKING));
  assert.ok(issueCodes.includes(CRM_DATA_QUALITY_ISSUE.WON_OPPORTUNITY_WITHOUT_BOKUN_CONFIRMATION));
  assert.ok(issueCodes.includes(CRM_DATA_QUALITY_ISSUE.OVERDUE_FOLLOW_UP));
  assert.equal(result.permissions.requiredCount, 12);
  assert.equal(result.permissions.declaredCount, 12);
  assert.equal(result.permissions.staffSensitiveAccessDenied, true);
  assert.equal(result.privacy.customerFinancials.status, "CONFIGURED");
  assert.equal(result.privacy.communicationDelivery.status, "CONFIGURED");
  assert.equal(result.duplicateProtection.quoteConversion.status, "CONFIGURED");
  assert.ok(result.auditCoverage.items.find((item) => item.key === "lead_creation").observedCount > 0);
  assert.equal(result.auditCoverage.items.find((item) => item.key === "customer_merge").status, "LIMITED");
});

test("CRM controls filter issues without mutating source records", async () => {
  const { service } = createHarness();
  const result = await service.getCrmControls({
    code: CRM_DATA_QUALITY_ISSUE.WON_OPPORTUNITY_WITHOUT_BOKUN_CONFIRMATION,
    severity: CRM_CONTROL_SEVERITY.ERROR,
    issueLimit: 1
  });

  assert.equal(result.filters.code, CRM_DATA_QUALITY_ISSUE.WON_OPPORTUNITY_WITHOUT_BOKUN_CONFIRMATION);
  assert.equal(result.filters.severity, CRM_CONTROL_SEVERITY.ERROR);
  assert.equal(result.dataQuality.items.length, 1);
  assert.equal(result.dataQuality.items[0].code, CRM_DATA_QUALITY_ISSUE.WON_OPPORTUNITY_WITHOUT_BOKUN_CONFIRMATION);
  assert.ok(result.limitations.some((item) => item.includes("read-only")));
});
