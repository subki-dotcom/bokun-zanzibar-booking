process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/crm-alerts-core-test";
process.env.JWT_SECRET ||= "crm-alerts-core-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CRM_ALERT_SEVERITY,
  CRM_ALERT_TYPE,
  CRM_B2B_PARTNER_STATUS,
  CRM_COMMUNICATION_DIRECTION,
  CRM_COMMUNICATION_STATUS,
  CRM_FOLLOW_UP_STATUS,
  CRM_FOLLOW_UP_TYPE,
  CRM_LEAD_SOURCE,
  CRM_LEAD_STATUS,
  CRM_NOTIFICATION_DELIVERY_MODE,
  CRM_NOTIFICATION_TYPE,
  CRM_OPPORTUNITY_STAGE,
  CRM_QUOTE_STATUS,
  CUSTOMER_TIMELINE_EVENT_TYPE
} = require("../src/crm/constants");
const { createCrmAlertsService } = require("../src/services/crmAlerts");

const clone = (value) => JSON.parse(JSON.stringify(value));
const id = (index) => `66b70000000000000000${String(index).padStart(4, "0")}`.slice(0, 24);
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
      if (expected.$in && !expected.$in.includes(actual)) return false;
      if (expected.$lte !== undefined && comparable(actual) > comparable(expected.$lte)) return false;
      if (expected.$gte !== undefined && comparable(actual) < comparable(expected.$gte)) return false;
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
  const leads = [
    {
      _id: id(1),
      leadReference: "LEAD-001",
      fullName: "High Value Guest",
      source: CRM_LEAD_SOURCE.WEBSITE,
      status: CRM_LEAD_STATUS.NEW,
      assignedTo: {},
      travelIntent: {
        travelDate: "2026-08-18",
        budgetAmount: 900,
        budgetCurrency: "USD"
      },
      tags: [],
      tagsNormalized: [],
      createdAt: "2026-08-15T08:00:00.000Z",
      updatedAt: "2026-08-15T08:10:00.000Z"
    },
    {
      _id: id(2),
      leadReference: "LEAD-002",
      fullName: "VIP Guest",
      source: CRM_LEAD_SOURCE.WHATSAPP,
      status: CRM_LEAD_STATUS.CONTACTED,
      assignedTo: { id: "seller-1", email: "seller1@example.test", name: "Seller One" },
      travelIntent: {
        travelDate: "2026-09-15",
        budgetAmount: 200,
        budgetCurrency: "USD"
      },
      tags: ["VIP"],
      tagsNormalized: ["vip"],
      createdAt: "2026-08-13T08:00:00.000Z",
      updatedAt: "2026-08-14T08:10:00.000Z"
    }
  ];
  const followUps = [
    {
      _id: id(3),
      type: CRM_FOLLOW_UP_TYPE.CALL,
      status: CRM_FOLLOW_UP_STATUS.PENDING,
      dueAt: "2026-08-14T09:00:00.000Z",
      assignedTo: { id: "seller-1", email: "seller1@example.test", name: "Seller One" },
      createdAt: "2026-08-12T09:00:00.000Z"
    },
    {
      _id: id(4),
      type: CRM_FOLLOW_UP_TYPE.QUOTE_FOLLOW_UP,
      status: CRM_FOLLOW_UP_STATUS.PENDING,
      dueAt: "2026-08-16T09:00:00.000Z",
      assignedTo: { id: "seller-2", email: "seller2@example.test", name: "Seller Two" },
      createdAt: "2026-08-12T09:00:00.000Z"
    }
  ];
  const quotes = [
    {
      _id: id(5),
      quoteNumber: "Q-001",
      status: CRM_QUOTE_STATUS.SENT,
      total: 100,
      currency: "USD",
      sentAt: "2026-08-10T08:00:00.000Z",
      validUntil: "2026-08-17T08:00:00.000Z",
      createdAt: "2026-08-10T08:00:00.000Z",
      updatedAt: "2026-08-10T08:00:00.000Z"
    },
    {
      _id: id(6),
      quoteNumber: "Q-002",
      status: CRM_QUOTE_STATUS.ACCEPTED,
      total: 250,
      currency: "USD",
      acceptedAt: "2026-08-15T07:00:00.000Z",
      createdAt: "2026-08-13T08:00:00.000Z",
      updatedAt: "2026-08-15T07:00:00.000Z"
    }
  ];
  const opportunities = [
    {
      _id: id(7),
      opportunityNumber: "OPP-001",
      title: "Won family trip",
      stage: CRM_OPPORTUNITY_STAGE.WON,
      estimatedValue: 400,
      currency: "USD",
      assignedTo: { id: "seller-1", email: "seller1@example.test", name: "Seller One" },
      stageChangedAt: "2026-08-15T07:30:00.000Z",
      createdAt: "2026-08-10T08:00:00.000Z",
      updatedAt: "2026-08-15T07:30:00.000Z"
    },
    {
      _id: id(8),
      opportunityNumber: "OPP-002",
      title: "Lost private transfer",
      stage: CRM_OPPORTUNITY_STAGE.LOST,
      estimatedValue: 120,
      currency: "USD",
      assignedTo: { id: "seller-2", email: "seller2@example.test", name: "Seller Two" },
      lostReason: "NO_RESPONSE",
      lostAt: "2026-08-14T07:30:00.000Z",
      createdAt: "2026-08-10T08:00:00.000Z",
      updatedAt: "2026-08-14T07:30:00.000Z"
    }
  ];
  const timelineEvents = [
    {
      _id: id(9),
      eventType: CUSTOMER_TIMELINE_EVENT_TYPE.COMMUNICATION_LOGGED,
      summary: "Customer replied on WhatsApp.",
      reference: "MSG-1",
      actor: { id: "seller-1", email: "seller1@example.test" },
      occurredAt: "2026-08-15T10:00:00.000Z",
      createdAt: "2026-08-15T10:00:00.000Z",
      communication: {
        channel: "WHATSAPP",
        direction: CRM_COMMUNICATION_DIRECTION.INBOUND,
        status: CRM_COMMUNICATION_STATUS.MANUAL_LOGGED
      }
    }
  ];
  const b2bPartners = [
    {
      _id: id(10),
      partnerNumber: "B2B-001",
      companyName: "Safari Agent",
      status: CRM_B2B_PARTNER_STATUS.PROPOSAL_SENT,
      assignedManager: { id: "seller-1", email: "seller1@example.test", name: "Seller One" },
      createdAt: "2026-07-01T08:00:00.000Z",
      updatedAt: "2026-07-20T08:00:00.000Z"
    }
  ];
  const service = createCrmAlertsService({
    LeadModel: modelOf(leads),
    FollowUpModel: modelOf(followUps),
    QuoteModel: modelOf(quotes),
    SalesOpportunityModel: modelOf(opportunities),
    CustomerTimelineEventModel: modelOf(timelineEvents),
    B2BPartnerModel: modelOf(b2bPartners),
    thresholds: {
      highValueLeadAmount: 500,
      quoteExpiryDays: 3,
      staleQuoteDays: 3,
      upcomingFollowUpHours: 24,
      travelApproachingDays: 7,
      b2bFollowUpStaleDays: 14,
      recentNotificationDays: 7
    },
    now
  });
  return { service };
};

test("CRM alerts derive actionable queue without turning forecasts into accounting revenue", async () => {
  const { service } = createHarness();
  const result = await service.getCrmAlerts();
  const alertTypes = result.alerts.items.map((alert) => alert.type);
  const notificationTypes = result.notifications.items.map((notification) => notification.type);

  assert.equal(result.step, "7M");
  assert.equal(result.module, "CRM_ALERTS_NOTIFICATIONS");
  assert.equal(result.sourceOfTruth.actualRevenueSource, "Booking Accounting after Bokun confirmed booking");
  assert.match(result.sourceOfTruth.notificationDeliveryTruth, /does not claim email/);
  assert.ok(alertTypes.includes(CRM_ALERT_TYPE.FOLLOW_UP_OVERDUE));
  assert.ok(alertTypes.includes(CRM_ALERT_TYPE.FOLLOW_UP_DUE));
  assert.ok(alertTypes.includes(CRM_ALERT_TYPE.HIGH_VALUE_LEAD_UNASSIGNED));
  assert.ok(alertTypes.includes(CRM_ALERT_TYPE.QUOTE_EXPIRING));
  assert.ok(alertTypes.includes(CRM_ALERT_TYPE.QUOTE_NOT_RESPONDED));
  assert.ok(alertTypes.includes(CRM_ALERT_TYPE.TRAVEL_DATE_APPROACHING));
  assert.ok(alertTypes.includes(CRM_ALERT_TYPE.VIP_CUSTOMER_INQUIRY));
  assert.ok(alertTypes.includes(CRM_ALERT_TYPE.B2B_FOLLOW_UP_DUE));
  assert.ok(notificationTypes.includes(CRM_NOTIFICATION_TYPE.NEW_LEAD));
  assert.ok(notificationTypes.includes(CRM_NOTIFICATION_TYPE.FOLLOW_UP_DUE));
  assert.ok(notificationTypes.includes(CRM_NOTIFICATION_TYPE.QUOTE_ACCEPTED));
  assert.ok(notificationTypes.includes(CRM_NOTIFICATION_TYPE.CUSTOMER_REPLY_LOGGED));
  assert.ok(notificationTypes.includes(CRM_NOTIFICATION_TYPE.OPPORTUNITY_WON));
  assert.ok(notificationTypes.includes(CRM_NOTIFICATION_TYPE.OPPORTUNITY_LOST));
  assert.equal(result.notifications.items[0].delivery.mode, CRM_NOTIFICATION_DELIVERY_MODE.IN_APP_DERIVED);
  assert.equal(result.notifications.items[0].delivery.providerStatus, null);
});

test("CRM alerts support severity, type, assignee, and limit filters", async () => {
  const { service } = createHarness();
  const byType = await service.getCrmAlerts({ type: CRM_ALERT_TYPE.FOLLOW_UP_OVERDUE, severity: CRM_ALERT_SEVERITY.HIGH, limit: 1 });
  assert.equal(byType.alerts.items.length, 1);
  assert.equal(byType.alerts.items[0].type, CRM_ALERT_TYPE.FOLLOW_UP_OVERDUE);
  assert.equal(byType.alerts.items[0].severity, CRM_ALERT_SEVERITY.HIGH);

  const sellerOne = await service.getCrmAlerts({ assignedTo: "seller-1" });
  assert.ok(sellerOne.alerts.items.length > 0);
  assert.ok(sellerOne.alerts.items.every((alert) => alert.assignedTo.id === "seller-1"));
  assert.ok(sellerOne.notifications.items.every((notification) => !notification.recipient.id || notification.recipient.id === "seller-1"));
});

test("CRM alert notification type filter never fabricates outbound delivery", async () => {
  const { service } = createHarness();
  const result = await service.getCrmAlerts({ notificationType: CRM_NOTIFICATION_TYPE.QUOTE_ACCEPTED });

  assert.equal(result.notifications.items.length, 1);
  assert.equal(result.notifications.items[0].type, CRM_NOTIFICATION_TYPE.QUOTE_ACCEPTED);
  assert.equal(result.notifications.items[0].delivery.mode, CRM_NOTIFICATION_DELIVERY_MODE.IN_APP_DERIVED);
  assert.equal(result.notifications.items[0].delivery.sentAt, null);
  assert.ok(result.limitations.some((item) => item.includes("Outbound communication delivery")));
});
