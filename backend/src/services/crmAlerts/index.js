const B2BPartner = require("../../models/B2BPartner");
const CustomerTimelineEvent = require("../../models/CustomerTimelineEvent");
const FollowUp = require("../../models/FollowUp");
const Lead = require("../../models/Lead");
const Quote = require("../../models/Quote");
const SalesOpportunity = require("../../models/SalesOpportunity");
const {
  CRM_ALERT_SEVERITY,
  CRM_ALERT_TYPE,
  CRM_B2B_PARTNER_STATUS,
  CRM_COMMUNICATION_DIRECTION,
  CRM_FOLLOW_UP_STATUS,
  CRM_LEAD_STATUS,
  CRM_NOTIFICATION_DELIVERY_MODE,
  CRM_NOTIFICATION_TYPE,
  CRM_OPPORTUNITY_STAGE,
  CRM_QUOTE_STATUS,
  CUSTOMER_SEGMENT,
  CUSTOMER_TIMELINE_EVENT_TYPE
} = require("../../crm/constants");

const OPEN_LEAD_STATUSES = Object.freeze([
  CRM_LEAD_STATUS.NEW,
  CRM_LEAD_STATUS.CONTACTED,
  CRM_LEAD_STATUS.QUALIFIED
]);
const ACTIVE_QUOTE_STATUSES = Object.freeze([
  CRM_QUOTE_STATUS.APPROVED,
  CRM_QUOTE_STATUS.SENT,
  CRM_QUOTE_STATUS.VIEWED
]);
const STALE_QUOTE_STATUSES = Object.freeze([
  CRM_QUOTE_STATUS.SENT,
  CRM_QUOTE_STATUS.VIEWED
]);
const ACCEPTED_QUOTE_STATUSES = Object.freeze([
  CRM_QUOTE_STATUS.ACCEPTED,
  CRM_QUOTE_STATUS.CONVERTED
]);
const CLOSED_OPPORTUNITY_STAGES = Object.freeze([
  CRM_OPPORTUNITY_STAGE.WON,
  CRM_OPPORTUNITY_STAGE.LOST
]);
const OPEN_B2B_STATUSES = Object.freeze([
  CRM_B2B_PARTNER_STATUS.PROSPECT,
  CRM_B2B_PARTNER_STATUS.CONTACTED,
  CRM_B2B_PARTNER_STATUS.PROPOSAL_SENT,
  CRM_B2B_PARTNER_STATUS.NEGOTIATION,
  CRM_B2B_PARTNER_STATUS.AGREEMENT
]);
const DEFAULT_THRESHOLDS = Object.freeze({
  highValueLeadAmount: 500,
  quoteExpiryDays: 3,
  staleQuoteDays: 3,
  upcomingFollowUpHours: 24,
  travelApproachingDays: 7,
  b2bFollowUpStaleDays: 14,
  recentNotificationDays: 7,
  maxSourceRows: 500
});
const SEVERITY_WEIGHT = Object.freeze({
  [CRM_ALERT_SEVERITY.CRITICAL]: 4,
  [CRM_ALERT_SEVERITY.HIGH]: 3,
  [CRM_ALERT_SEVERITY.WARNING]: 2,
  [CRM_ALERT_SEVERITY.INFO]: 1
});

const toPlain = (value) => {
  if (!value) return value;
  if (typeof value.toObject === "function") return value.toObject();
  return value;
};
const asArray = (value) => (Array.isArray(value) ? value : []);
const normalizeText = (value = "") => String(value || "").trim();
const normalizeUpper = (value = "") => normalizeText(value).toUpperCase();
const idOf = (value) => String(value?._id || value?.id || value || "");
const toMoney = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(number, 0) : 0;
};
const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const startOfDay = (date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const addDays = (date, days = 0) => new Date(date.getTime() + Number(days || 0) * 24 * 60 * 60 * 1000);
const addHours = (date, hours = 0) => new Date(date.getTime() + Number(hours || 0) * 60 * 60 * 1000);
const numberFrom = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
};
const normalizeThresholds = (overrides = {}) => ({
  highValueLeadAmount: numberFrom(
    overrides.highValueLeadAmount ?? process.env.CRM_ALERT_HIGH_VALUE_LEAD_AMOUNT,
    DEFAULT_THRESHOLDS.highValueLeadAmount,
    { min: 0 }
  ),
  quoteExpiryDays: numberFrom(
    overrides.quoteExpiryDays ?? process.env.CRM_ALERT_QUOTE_EXPIRY_DAYS,
    DEFAULT_THRESHOLDS.quoteExpiryDays,
    { min: 1, max: 30 }
  ),
  staleQuoteDays: numberFrom(
    overrides.staleQuoteDays ?? process.env.CRM_ALERT_STALE_QUOTE_DAYS,
    DEFAULT_THRESHOLDS.staleQuoteDays,
    { min: 1, max: 60 }
  ),
  upcomingFollowUpHours: numberFrom(
    overrides.upcomingFollowUpHours ?? process.env.CRM_ALERT_UPCOMING_FOLLOW_UP_HOURS,
    DEFAULT_THRESHOLDS.upcomingFollowUpHours,
    { min: 1, max: 168 }
  ),
  travelApproachingDays: numberFrom(
    overrides.travelApproachingDays ?? process.env.CRM_ALERT_TRAVEL_APPROACHING_DAYS,
    DEFAULT_THRESHOLDS.travelApproachingDays,
    { min: 1, max: 90 }
  ),
  b2bFollowUpStaleDays: numberFrom(
    overrides.b2bFollowUpStaleDays ?? process.env.CRM_ALERT_B2B_FOLLOW_UP_STALE_DAYS,
    DEFAULT_THRESHOLDS.b2bFollowUpStaleDays,
    { min: 1, max: 180 }
  ),
  recentNotificationDays: numberFrom(
    overrides.recentNotificationDays ?? process.env.CRM_ALERT_RECENT_NOTIFICATION_DAYS,
    DEFAULT_THRESHOLDS.recentNotificationDays,
    { min: 1, max: 90 }
  ),
  maxSourceRows: numberFrom(
    overrides.maxSourceRows ?? process.env.CRM_ALERT_MAX_SOURCE_ROWS,
    DEFAULT_THRESHOLDS.maxSourceRows,
    { min: 50, max: 5000 }
  )
});
const executeFind = async (query, { sort, limit, select } = {}) => {
  let next = query;
  if (next && select && typeof next.select === "function") next = next.select(select);
  if (next && sort && typeof next.sort === "function") next = next.sort(sort);
  if (next && limit && typeof next.limit === "function") next = next.limit(limit);
  if (next && typeof next.lean === "function") next = next.lean();
  const rows = next && typeof next.then === "function" ? await next : next;
  return asArray(rows).map(toPlain);
};
const actorSnapshot = (actor = {}) => ({
  id: normalizeText(actor.id),
  role: normalizeText(actor.role),
  email: normalizeText(actor.email),
  name: normalizeText(actor.name)
});
const actorLabel = (actor = {}) =>
  normalizeText(actor.name) || normalizeText(actor.email) || normalizeText(actor.id) || "Unassigned";
const hasAssignedUser = (actor = {}) =>
  Boolean(normalizeText(actor.id) || normalizeText(actor.email) || normalizeText(actor.name));
const countBy = (rows = [], key = "") => {
  const counts = new Map();
  rows.forEach((row) => {
    const value = normalizeText(row[key]) || "UNKNOWN";
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
};
const sortAlerts = (items = []) =>
  [...items].sort((left, right) => {
    const severityDelta = (SEVERITY_WEIGHT[right.severity] || 0) - (SEVERITY_WEIGHT[left.severity] || 0);
    if (severityDelta) return severityDelta;
    const leftDate = parseDate(left.dueAt || left.occurredAt || left.createdAt) || new Date(0);
    const rightDate = parseDate(right.dueAt || right.occurredAt || right.createdAt) || new Date(0);
    return leftDate.getTime() - rightDate.getTime() || left.alertKey.localeCompare(right.alertKey);
  });
const sortNotifications = (items = []) =>
  [...items].sort((left, right) => {
    const leftDate = parseDate(left.occurredAt || left.createdAt) || new Date(0);
    const rightDate = parseDate(right.occurredAt || right.createdAt) || new Date(0);
    return rightDate.getTime() - leftDate.getTime() || left.notificationKey.localeCompare(right.notificationKey);
  });
const baseAlert = ({
  type,
  severity,
  title,
  message,
  assignedTo = {},
  sourceType,
  sourceId,
  reference = "",
  dueAt = null,
  occurredAt = null,
  createdAt = null,
  action = {},
  evidence = {}
}) => ({
  alertKey: `CRM_ALERT::${type}::${sourceType}::${sourceId}`,
  type,
  severity,
  title,
  message,
  assignedTo: actorSnapshot(assignedTo),
  assigneeLabel: actorLabel(assignedTo),
  sourceType,
  sourceId: normalizeText(sourceId),
  reference: normalizeText(reference),
  dueAt: dueAt ? parseDate(dueAt)?.toISOString() || null : null,
  occurredAt: occurredAt ? parseDate(occurredAt)?.toISOString() || null : null,
  createdAt: createdAt ? parseDate(createdAt)?.toISOString() || null : null,
  action,
  evidence
});
const baseNotification = ({
  type,
  title,
  message,
  recipient = {},
  sourceType,
  sourceId,
  reference = "",
  occurredAt = null,
  createdAt = null,
  evidence = {}
}) => ({
  notificationKey: `CRM_NOTIFICATION::${type}::${sourceType}::${sourceId}`,
  type,
  title,
  message,
  recipient: actorSnapshot(recipient),
  recipientLabel: actorLabel(recipient),
  sourceType,
  sourceId: normalizeText(sourceId),
  reference: normalizeText(reference),
  occurredAt: occurredAt ? parseDate(occurredAt)?.toISOString() || null : null,
  createdAt: createdAt ? parseDate(createdAt)?.toISOString() || null : null,
  delivery: {
    mode: CRM_NOTIFICATION_DELIVERY_MODE.IN_APP_DERIVED,
    providerStatus: null,
    sentAt: null,
    evidence: "Derived from CRM records for the admin workspace; no external message delivery is claimed."
  },
  evidence
});
const leadDisplayName = (lead = {}) =>
  normalizeText(lead.fullName) || [lead.firstName, lead.lastName].map(normalizeText).filter(Boolean).join(" ") || "Lead";
const quoteReference = (quote = {}) => normalizeText(quote.quoteNumber) || idOf(quote);
const opportunityReference = (opportunity = {}) => normalizeText(opportunity.opportunityNumber) || idOf(opportunity);
const buildFollowUpAlerts = ({ followUps = [], current, upcomingUntil } = {}) =>
  followUps
    .map((followUp) => {
      const dueAt = parseDate(followUp.dueAt);
      if (!dueAt) return null;
      const overdue = dueAt <= current;
      const type = overdue ? CRM_ALERT_TYPE.FOLLOW_UP_OVERDUE : CRM_ALERT_TYPE.FOLLOW_UP_DUE;
      return baseAlert({
        type,
        severity: overdue ? CRM_ALERT_SEVERITY.HIGH : CRM_ALERT_SEVERITY.WARNING,
        title: overdue ? "Follow-up overdue" : "Follow-up due soon",
        message: `${normalizeText(followUp.type) || "Follow-up"} is ${overdue ? "overdue" : "due soon"} for ${actorLabel(followUp.assignedTo)}.`,
        assignedTo: followUp.assignedTo,
        sourceType: "FOLLOW_UP",
        sourceId: idOf(followUp),
        reference: normalizeText(followUp.type) || "FOLLOW_UP",
        dueAt,
        createdAt: followUp.createdAt,
        action: { label: "Open follow-ups", path: "/admin/crm/follow-ups" },
        evidence: {
          status: followUp.status,
          dueAt: dueAt.toISOString(),
          upcomingUntil: upcomingUntil.toISOString()
        }
      });
    })
    .filter(Boolean);
const buildLeadAlerts = ({ leads = [], current, thresholds } = {}) => {
  const travelStart = startOfDay(current);
  const travelEnd = addDays(travelStart, thresholds.travelApproachingDays + 1);
  const alerts = [];

  leads.forEach((lead) => {
    const sourceId = idOf(lead);
    const assignedTo = lead.assignedTo || {};
    const leadName = leadDisplayName(lead);
    const budgetAmount = toMoney(lead.travelIntent?.budgetAmount);
    const tags = new Set([
      ...asArray(lead.tags).map((tag) => normalizeText(tag).toLowerCase()),
      ...asArray(lead.tagsNormalized).map((tag) => normalizeText(tag).toLowerCase())
    ]);
    const isVip = tags.has("vip") || asArray(lead.segments).includes(CUSTOMER_SEGMENT.VIP);
    const travelDate = parseDate(lead.travelIntent?.travelDate);

    if (budgetAmount >= thresholds.highValueLeadAmount && !hasAssignedUser(assignedTo)) {
      alerts.push(baseAlert({
        type: CRM_ALERT_TYPE.HIGH_VALUE_LEAD_UNASSIGNED,
        severity: CRM_ALERT_SEVERITY.HIGH,
        title: "High-value lead unassigned",
        message: `${leadName} has a ${lead.travelIntent?.budgetCurrency || "USD"} ${budgetAmount.toFixed(2)} budget and no assigned owner.`,
        assignedTo,
        sourceType: "LEAD",
        sourceId,
        reference: lead.leadReference,
        occurredAt: lead.createdAt,
        createdAt: lead.createdAt,
        action: { label: "Open leads", path: "/admin/crm/leads" },
        evidence: {
          status: lead.status,
          budgetAmount,
          budgetCurrency: lead.travelIntent?.budgetCurrency || "USD",
          assignmentPresent: false
        }
      }));
    }

    if (isVip && OPEN_LEAD_STATUSES.includes(lead.status)) {
      alerts.push(baseAlert({
        type: CRM_ALERT_TYPE.VIP_CUSTOMER_INQUIRY,
        severity: CRM_ALERT_SEVERITY.WARNING,
        title: "VIP customer inquiry",
        message: `${leadName} is tagged as VIP and is still in the CRM pre-booking flow.`,
        assignedTo,
        sourceType: "LEAD",
        sourceId,
        reference: lead.leadReference,
        occurredAt: lead.createdAt,
        createdAt: lead.createdAt,
        action: { label: "Open leads", path: "/admin/crm/leads" },
        evidence: {
          status: lead.status,
          tags: asArray(lead.tags),
          tagsNormalized: asArray(lead.tagsNormalized)
        }
      }));
    }

    if (travelDate && travelDate >= travelStart && travelDate < travelEnd && OPEN_LEAD_STATUSES.includes(lead.status)) {
      alerts.push(baseAlert({
        type: CRM_ALERT_TYPE.TRAVEL_DATE_APPROACHING,
        severity: CRM_ALERT_SEVERITY.WARNING,
        title: "CRM travel intent approaching",
        message: `${leadName} has a pre-booking travel intent date approaching. Operational travel dates still come from Bokun after confirmation.`,
        assignedTo,
        sourceType: "LEAD",
        sourceId,
        reference: lead.leadReference,
        dueAt: travelDate,
        createdAt: lead.createdAt,
        action: { label: "Open leads", path: "/admin/crm/leads" },
        evidence: {
          status: lead.status,
          travelIntentDate: normalizeText(lead.travelIntent?.travelDate),
          bokunOperationalDateSource: "Bokun confirmed booking after conversion"
        }
      }));
    }
  });

  return alerts;
};
const buildQuoteAlerts = ({ quotes = [], current, thresholds } = {}) => {
  const expiryEnd = addDays(current, thresholds.quoteExpiryDays);
  const staleCutoff = addDays(current, -thresholds.staleQuoteDays);
  const alerts = [];

  quotes.forEach((quote) => {
    const sourceId = idOf(quote);
    const reference = quoteReference(quote);
    const validUntil = parseDate(quote.validUntil);
    const sentAt = parseDate(quote.sentAt || quote.issueDate || quote.createdAt);

    if (validUntil && ACTIVE_QUOTE_STATUSES.includes(quote.status) && validUntil >= current && validUntil <= expiryEnd) {
      alerts.push(baseAlert({
        type: CRM_ALERT_TYPE.QUOTE_EXPIRING,
        severity: CRM_ALERT_SEVERITY.WARNING,
        title: "Quote expiring",
        message: `${reference} expires soon. Quote value remains sales forecast until a Bokun-confirmed booking enters accounting.`,
        sourceType: "QUOTE",
        sourceId,
        reference,
        dueAt: validUntil,
        createdAt: quote.createdAt,
        action: { label: "Open quotes", path: "/admin/crm/quotes" },
        evidence: {
          status: quote.status,
          total: toMoney(quote.total),
          currency: quote.currency || "USD",
          quoteValueIsForecastOnly: true
        }
      }));
    }

    if (sentAt && STALE_QUOTE_STATUSES.includes(quote.status) && sentAt <= staleCutoff) {
      alerts.push(baseAlert({
        type: CRM_ALERT_TYPE.QUOTE_NOT_RESPONDED,
        severity: CRM_ALERT_SEVERITY.WARNING,
        title: "Quote not responded",
        message: `${reference} has been sent or viewed without acceptance, rejection, or conversion.`,
        sourceType: "QUOTE",
        sourceId,
        reference,
        occurredAt: sentAt,
        createdAt: quote.createdAt,
        action: { label: "Open quotes", path: "/admin/crm/quotes" },
        evidence: {
          status: quote.status,
          sentAt: sentAt.toISOString(),
          staleQuoteDays: thresholds.staleQuoteDays
        }
      }));
    }
  });

  return alerts;
};
const buildB2BAlerts = ({ partners = [], current, thresholds } = {}) => {
  const staleCutoff = addDays(current, -thresholds.b2bFollowUpStaleDays);
  return partners
    .map((partner) => {
      const lastTouchedAt = parseDate(partner.statusChangedAt || partner.updatedAt || partner.createdAt);
      if (!lastTouchedAt || lastTouchedAt > staleCutoff) return null;
      const staleDays = Math.floor((current.getTime() - lastTouchedAt.getTime()) / (24 * 60 * 60 * 1000));
      return baseAlert({
        type: CRM_ALERT_TYPE.B2B_FOLLOW_UP_DUE,
        severity: staleDays >= thresholds.b2bFollowUpStaleDays * 2 ? CRM_ALERT_SEVERITY.HIGH : CRM_ALERT_SEVERITY.WARNING,
        title: "B2B follow-up due",
        message: `${normalizeText(partner.companyName) || "B2B partner"} has had no CRM status movement for ${staleDays} days.`,
        assignedTo: partner.assignedManager,
        sourceType: "B2B_PARTNER",
        sourceId: idOf(partner),
        reference: partner.partnerNumber,
        occurredAt: lastTouchedAt,
        createdAt: partner.createdAt,
        action: { label: "Open B2B partners", path: "/admin/crm/b2b-agents" },
        evidence: {
          status: partner.status,
          lastTouchedAt: lastTouchedAt.toISOString(),
          b2bFollowUpStaleDays: thresholds.b2bFollowUpStaleDays
        }
      });
    })
    .filter(Boolean);
};
const buildNotifications = ({ leads = [], followUps = [], quotes = [], opportunities = [], timelineEvents = [], current, thresholds } = {}) => {
  const recentCutoff = addDays(current, -thresholds.recentNotificationDays);
  const expiryEnd = addDays(current, thresholds.quoteExpiryDays);
  const notifications = [];

  leads.forEach((lead) => {
    const createdAt = parseDate(lead.createdAt);
    if (createdAt && createdAt >= recentCutoff) {
      notifications.push(baseNotification({
        type: CRM_NOTIFICATION_TYPE.NEW_LEAD,
        title: "New lead",
        message: `${leadDisplayName(lead)} entered CRM from ${normalizeText(lead.source) || "UNKNOWN"}.`,
        recipient: lead.assignedTo,
        sourceType: "LEAD",
        sourceId: idOf(lead),
        reference: lead.leadReference,
        occurredAt: createdAt,
        createdAt,
        evidence: { source: lead.source, status: lead.status }
      }));
    }

    if (hasAssignedUser(lead.assignedTo) && OPEN_LEAD_STATUSES.includes(lead.status)) {
      notifications.push(baseNotification({
        type: CRM_NOTIFICATION_TYPE.LEAD_ASSIGNMENT,
        title: "Lead assignment",
        message: `${leadDisplayName(lead)} is assigned to ${actorLabel(lead.assignedTo)}.`,
        recipient: lead.assignedTo,
        sourceType: "LEAD",
        sourceId: idOf(lead),
        reference: lead.leadReference,
        occurredAt: lead.updatedAt || lead.createdAt,
        createdAt: lead.createdAt,
        evidence: { source: lead.source, status: lead.status }
      }));
    }
  });

  followUps.forEach((followUp) => {
    const dueAt = parseDate(followUp.dueAt);
    if (!dueAt || dueAt > addHours(current, thresholds.upcomingFollowUpHours)) return;
    notifications.push(baseNotification({
      type: CRM_NOTIFICATION_TYPE.FOLLOW_UP_DUE,
      title: "Follow-up due",
      message: `${normalizeText(followUp.type) || "Follow-up"} is due for ${actorLabel(followUp.assignedTo)}.`,
      recipient: followUp.assignedTo,
      sourceType: "FOLLOW_UP",
      sourceId: idOf(followUp),
      reference: followUp.type,
      occurredAt: dueAt,
      createdAt: followUp.createdAt,
      evidence: { status: followUp.status, dueAt: dueAt.toISOString() }
    }));
  });

  quotes.forEach((quote) => {
    const reference = quoteReference(quote);
    const validUntil = parseDate(quote.validUntil);
    if (ACCEPTED_QUOTE_STATUSES.includes(quote.status)) {
      const occurredAt = parseDate(quote.acceptedAt || quote.convertedAt || quote.updatedAt || quote.createdAt);
      if (occurredAt && occurredAt >= recentCutoff) {
        notifications.push(baseNotification({
          type: CRM_NOTIFICATION_TYPE.QUOTE_ACCEPTED,
          title: "Quote accepted",
          message: `${reference} is accepted or converted. Accounting revenue still requires a Bokun-confirmed booking.`,
          sourceType: "QUOTE",
          sourceId: idOf(quote),
          reference,
          occurredAt,
          createdAt: quote.createdAt,
          evidence: {
            status: quote.status,
            total: toMoney(quote.total),
            currency: quote.currency || "USD",
            quoteValueIsForecastOnly: true
          }
        }));
      }
    }
    if (validUntil && ACTIVE_QUOTE_STATUSES.includes(quote.status) && validUntil >= current && validUntil <= expiryEnd) {
      notifications.push(baseNotification({
        type: CRM_NOTIFICATION_TYPE.QUOTE_EXPIRING,
        title: "Quote expiring",
        message: `${reference} expires soon.`,
        sourceType: "QUOTE",
        sourceId: idOf(quote),
        reference,
        occurredAt: validUntil,
        createdAt: quote.createdAt,
        evidence: { status: quote.status, validUntil: validUntil.toISOString() }
      }));
    }
  });

  opportunities.forEach((opportunity) => {
    const won = opportunity.stage === CRM_OPPORTUNITY_STAGE.WON;
    const lost = opportunity.stage === CRM_OPPORTUNITY_STAGE.LOST;
    const occurredAt = parseDate(opportunity.wonAt || opportunity.lostAt || opportunity.stageChangedAt || opportunity.updatedAt);
    if (!occurredAt || occurredAt < recentCutoff || (!won && !lost)) return;
    notifications.push(baseNotification({
      type: won ? CRM_NOTIFICATION_TYPE.OPPORTUNITY_WON : CRM_NOTIFICATION_TYPE.OPPORTUNITY_LOST,
      title: won ? "Opportunity won" : "Opportunity lost",
      message: `${normalizeText(opportunity.title) || opportunityReference(opportunity)} moved to ${opportunity.stage}.`,
      recipient: opportunity.assignedTo,
      sourceType: "OPPORTUNITY",
      sourceId: idOf(opportunity),
      reference: opportunityReference(opportunity),
      occurredAt,
      createdAt: opportunity.createdAt,
      evidence: {
        stage: opportunity.stage,
        estimatedValue: toMoney(opportunity.estimatedValue),
        currency: opportunity.currency || "USD",
        lostReason: opportunity.lostReason || ""
      }
    }));
  });

  timelineEvents.forEach((event) => {
    const occurredAt = parseDate(event.occurredAt || event.createdAt);
    if (!occurredAt || occurredAt < recentCutoff) return;
    if (event.communication?.direction !== CRM_COMMUNICATION_DIRECTION.INBOUND) return;
    notifications.push(baseNotification({
      type: CRM_NOTIFICATION_TYPE.CUSTOMER_REPLY_LOGGED,
      title: "Customer reply logged",
      message: event.summary || "Inbound customer communication was logged.",
      recipient: event.actor,
      sourceType: "CUSTOMER_TIMELINE",
      sourceId: idOf(event),
      reference: event.reference,
      occurredAt,
      createdAt: event.createdAt,
      evidence: {
        eventType: event.eventType,
        channel: event.communication?.channel || "",
        communicationStatus: event.communication?.status || ""
      }
    }));
  });

  return notifications;
};
const normalizeFilters = (filters = {}) => {
  const type = normalizeUpper(filters.type);
  const severity = normalizeUpper(filters.severity);
  const notificationType = normalizeUpper(filters.notificationType);
  return {
    type: Object.values(CRM_ALERT_TYPE).includes(type) ? type : "",
    severity: Object.values(CRM_ALERT_SEVERITY).includes(severity) ? severity : "",
    notificationType: Object.values(CRM_NOTIFICATION_TYPE).includes(notificationType) ? notificationType : "",
    assignedTo: normalizeText(filters.assignedTo),
    limit: numberFrom(filters.limit, 50, { min: 1, max: 200 })
  };
};
const filterByAssignee = (rows = [], assignee = "") => {
  if (!assignee) return rows;
  return rows.filter((row) =>
    [row.assignedTo?.id, row.assignedTo?.email, row.recipient?.id, row.recipient?.email]
      .map(normalizeText)
      .includes(assignee)
  );
};

const createCrmAlertsService = ({
  LeadModel = Lead,
  FollowUpModel = FollowUp,
  QuoteModel = Quote,
  SalesOpportunityModel = SalesOpportunity,
  CustomerTimelineEventModel = CustomerTimelineEvent,
  B2BPartnerModel = B2BPartner,
  thresholds: thresholdOverrides = {},
  now = () => new Date()
} = {}) => {
  const getCrmAlerts = async (filters = {}) => {
    const normalizedFilters = normalizeFilters(filters);
    const thresholds = normalizeThresholds(thresholdOverrides);
    const current = parseDate(now()) || new Date();
    const upcomingFollowUpUntil = addHours(current, thresholds.upcomingFollowUpHours);
    const recentNotificationCutoff = addDays(current, -thresholds.recentNotificationDays);
    const sourceLimit = thresholds.maxSourceRows;
    const assignedFilter = normalizedFilters.assignedTo ? { "assignedTo.id": normalizedFilters.assignedTo } : {};
    const managerFilter = normalizedFilters.assignedTo ? { "assignedManager.id": normalizedFilters.assignedTo } : {};

    const [leads, followUps, quotes, opportunities, timelineEvents, b2bPartners] = await Promise.all([
      executeFind(LeadModel.find({ status: { $in: OPEN_LEAD_STATUSES }, ...assignedFilter }), {
        sort: { createdAt: -1 },
        limit: sourceLimit
      }),
      executeFind(FollowUpModel.find({
        status: CRM_FOLLOW_UP_STATUS.PENDING,
        dueAt: { $lte: upcomingFollowUpUntil },
        ...assignedFilter
      }), { sort: { dueAt: 1 }, limit: sourceLimit }),
      executeFind(QuoteModel.find({
        status: { $in: [...new Set([...ACTIVE_QUOTE_STATUSES, ...STALE_QUOTE_STATUSES, ...ACCEPTED_QUOTE_STATUSES])] }
      }), { sort: { updatedAt: -1 }, limit: sourceLimit }),
      executeFind(SalesOpportunityModel.find({
        stage: { $in: CLOSED_OPPORTUNITY_STAGES },
        ...assignedFilter
      }), { sort: { stageChangedAt: -1, updatedAt: -1 }, limit: sourceLimit }),
      executeFind(CustomerTimelineEventModel.find({
        eventType: CUSTOMER_TIMELINE_EVENT_TYPE.COMMUNICATION_LOGGED,
        occurredAt: { $gte: recentNotificationCutoff }
      }), { sort: { occurredAt: -1 }, limit: sourceLimit }),
      executeFind(B2BPartnerModel.find({
        status: { $in: OPEN_B2B_STATUSES },
        ...managerFilter
      }), { sort: { updatedAt: 1 }, limit: sourceLimit })
    ]);

    const rawAlerts = [
      ...buildFollowUpAlerts({ followUps, current, upcomingUntil: upcomingFollowUpUntil }),
      ...buildLeadAlerts({ leads, current, thresholds }),
      ...buildQuoteAlerts({ quotes, current, thresholds }),
      ...buildB2BAlerts({ partners: b2bPartners, current, thresholds })
    ];
    const rawNotifications = buildNotifications({
      leads,
      followUps,
      quotes,
      opportunities,
      timelineEvents,
      current,
      thresholds
    });

    const filteredAlerts = sortAlerts(filterByAssignee(rawAlerts, normalizedFilters.assignedTo))
      .filter((alert) => !normalizedFilters.type || alert.type === normalizedFilters.type)
      .filter((alert) => !normalizedFilters.severity || alert.severity === normalizedFilters.severity);
    const filteredNotifications = sortNotifications(filterByAssignee(rawNotifications, normalizedFilters.assignedTo))
      .filter((notification) => !normalizedFilters.notificationType || notification.type === normalizedFilters.notificationType);

    return {
      step: "7M",
      module: "CRM_ALERTS_NOTIFICATIONS",
      generatedAt: current.toISOString(),
      filters: normalizedFilters,
      thresholds,
      sourceOfTruth: {
        crmSource: "CRM records own pre-booking alerts, follow-ups, quotes, opportunity events, and relationship notifications.",
        operationalBookingSource: "Bokun confirmed bookings remain operational truth after CRM conversion.",
        actualRevenueSource: "Booking Accounting after Bokun confirmed booking",
        notificationDeliveryTruth: "This endpoint returns in-app notifications derived from CRM records only; it does not claim email, SMS, WhatsApp, or provider delivery."
      },
      alerts: {
        total: filteredAlerts.length,
        bySeverity: countBy(filteredAlerts, "severity"),
        byType: countBy(filteredAlerts, "type"),
        items: filteredAlerts.slice(0, normalizedFilters.limit)
      },
      notifications: {
        total: filteredNotifications.length,
        byType: countBy(filteredNotifications, "type"),
        items: filteredNotifications.slice(0, normalizedFilters.limit)
      },
      limitations: [
        "CRM alert dates are pre-booking operational prompts; confirmed booking travel dates remain sourced from Bokun.",
        "CRM pipeline and quote values are forecasts, not booking accounting revenue.",
        "Outbound communication delivery requires a real provider integration and is not inferred by this module.",
        "Customer reply notifications are derived from manually logged inbound CRM timeline events."
      ]
    };
  };

  return {
    getCrmAlerts
  };
};

const service = createCrmAlertsService();

module.exports = {
  ...service,
  createCrmAlertsService,
  __testables: {
    buildB2BAlerts,
    buildFollowUpAlerts,
    buildLeadAlerts,
    buildNotifications,
    buildQuoteAlerts,
    normalizeFilters,
    normalizeThresholds
  }
};
