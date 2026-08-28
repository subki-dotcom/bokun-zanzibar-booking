const AuditLog = require("../../models/AuditLog");
const B2BPartner = require("../../models/B2BPartner");
const Booking = require("../../models/Booking");
const CrmTask = require("../../models/CrmTask");
const Customer = require("../../models/Customer");
const CustomerDuplicateCandidate = require("../../models/CustomerDuplicateCandidate");
const FollowUp = require("../../models/FollowUp");
const Lead = require("../../models/Lead");
const Quote = require("../../models/Quote");
const SalesOpportunity = require("../../models/SalesOpportunity");
const { ROLES } = require("../../config/constants");
const {
  CRM_CONTROL_SEVERITY,
  CRM_DATA_QUALITY_ISSUE,
  CRM_FOLLOW_UP_STATUS,
  CRM_LEAD_STATUS,
  CRM_OPPORTUNITY_STAGE,
  CUSTOMER_DUPLICATE_STATUS,
  DUPLICATE_CANDIDATE_STATUS
} = require("../../crm/constants");
const { PERMISSIONS, getPermissionsForRole } = require("../../security/permissions");

const DEFAULT_LIMITS = Object.freeze({
  sourceLimit: 1000,
  issueLimit: 100,
  auditLimit: 5000
});

const OPEN_LEAD_STATUSES = Object.freeze([
  CRM_LEAD_STATUS.NEW,
  CRM_LEAD_STATUS.CONTACTED,
  CRM_LEAD_STATUS.QUALIFIED
]);

const OPEN_OPPORTUNITY_STAGES = Object.freeze(
  Object.values(CRM_OPPORTUNITY_STAGE).filter((stage) => ![CRM_OPPORTUNITY_STAGE.WON, CRM_OPPORTUNITY_STAGE.LOST].includes(stage))
);

const ACTIVE_QUOTE_STATUSES = Object.freeze([
  "DRAFT",
  "INTERNAL_REVIEW",
  "APPROVED",
  "SENT",
  "VIEWED",
  "ACCEPTED",
  "CONVERTED"
]);

const CRM_ENTITY_TYPES = Object.freeze([
  "B2BPartner",
  "Customer",
  "CustomerDuplicateCandidate",
  "FollowUp",
  "Lead",
  "Quote",
  "SalesOpportunity"
]);

const ISSUE_DEFINITION = Object.freeze({
  [CRM_DATA_QUALITY_ISSUE.LEAD_MISSING_CONTACT]: {
    severity: CRM_CONTROL_SEVERITY.ERROR,
    category: "LEAD_CONTACT",
    recommendedAction: "Add an email, phone, or WhatsApp number before assigning sales follow-up."
  },
  [CRM_DATA_QUALITY_ISSUE.LEAD_MISSING_OWNER]: {
    severity: CRM_CONTROL_SEVERITY.WARNING,
    category: "LEAD_OWNERSHIP",
    recommendedAction: "Assign the lead to a sales owner."
  },
  [CRM_DATA_QUALITY_ISSUE.OPPORTUNITY_MISSING_VALUE]: {
    severity: CRM_CONTROL_SEVERITY.WARNING,
    category: "PIPELINE_VALUE",
    recommendedAction: "Record an estimated opportunity value for pipeline forecasting."
  },
  [CRM_DATA_QUALITY_ISSUE.QUOTE_MISSING_CUSTOMER]: {
    severity: CRM_CONTROL_SEVERITY.WARNING,
    category: "QUOTE_CUSTOMER",
    recommendedAction: "Link the quote to the customer master where possible."
  },
  [CRM_DATA_QUALITY_ISSUE.DUPLICATE_CUSTOMER_SUSPICION]: {
    severity: CRM_CONTROL_SEVERITY.WARNING,
    category: "CUSTOMER_DEDUPE",
    recommendedAction: "Review the duplicate candidate before relying on customer-level CRM reporting."
  },
  [CRM_DATA_QUALITY_ISSUE.CONVERTED_OPPORTUNITY_WITHOUT_BOOKING]: {
    severity: CRM_CONTROL_SEVERITY.ERROR,
    category: "CRM_TO_BOOKING",
    recommendedAction: "Link the won opportunity to the canonical local booking."
  },
  [CRM_DATA_QUALITY_ISSUE.WON_OPPORTUNITY_WITHOUT_BOKUN_CONFIRMATION]: {
    severity: CRM_CONTROL_SEVERITY.ERROR,
    category: "BOKUN_CONFIRMATION",
    recommendedAction: "Confirm or resync the Bokun booking before treating the opportunity as operationally won."
  },
  [CRM_DATA_QUALITY_ISSUE.OVERDUE_FOLLOW_UP]: {
    severity: CRM_CONTROL_SEVERITY.WARNING,
    category: "FOLLOW_UP",
    recommendedAction: "Complete, reschedule, or cancel the overdue follow-up."
  }
});

const REQUIRED_CRM_PERMISSIONS = Object.freeze([
  { key: "CRM_VIEW", purpose: "View the CRM workspace." },
  { key: "CRM_MANAGE_LEADS", purpose: "Create and edit sales leads." },
  { key: "CRM_ASSIGN_LEADS", purpose: "Assign lead ownership." },
  { key: "CRM_MANAGE_OPPORTUNITIES", purpose: "Create, edit, and move opportunities through pipeline stages." },
  { key: "CRM_MANAGE_QUOTES", purpose: "Create, edit, issue, and convert quotes." },
  { key: "CRM_APPROVE_QUOTES", purpose: "Approve quotes before issue where required." },
  { key: "CRM_VIEW_CUSTOMERS", purpose: "Read customer master records and relationship timeline." },
  { key: "CRM_MANAGE_CUSTOMERS", purpose: "Create, edit, merge/review, and log customer communications." },
  { key: "CRM_MANAGE_FOLLOWUPS", purpose: "Create, complete, and manage follow-ups and CRM tasks." },
  { key: "CRM_VIEW_SALES_ANALYTICS", purpose: "View CRM analytics, reports, and control summaries." },
  { key: "CRM_VIEW_CUSTOMER_FINANCIALS", purpose: "View customer financial summaries from accounting records." },
  { key: "CRM_MANAGE_B2B", purpose: "Manage B2B and agent CRM partner records." }
]);

const SENSITIVE_CRM_PERMISSIONS = Object.freeze([
  "CRM_MANAGE_CUSTOMERS",
  "CRM_VIEW_CUSTOMER_FINANCIALS",
  "CRM_VIEW_SALES_ANALYTICS",
  "CRM_MANAGE_QUOTES",
  "CRM_MANAGE_B2B"
]);

const AUDIT_COVERAGE_REQUIREMENTS = Object.freeze([
  {
    key: "lead_creation",
    label: "Lead creation",
    actions: ["crm_lead_created"],
    entityTypes: ["Lead"]
  },
  {
    key: "lead_reassignment",
    label: "Lead reassignment",
    actions: ["crm_lead_updated"],
    entityTypes: ["Lead"],
    evidence: "Lead updates persist before/after state, including assignedTo changes."
  },
  {
    key: "stage_change",
    label: "Opportunity stage change",
    actions: ["crm_opportunity_stage_changed"],
    entityTypes: ["SalesOpportunity"]
  },
  {
    key: "quote_creation",
    label: "Quote creation",
    actions: ["crm_quote_created"],
    entityTypes: ["Quote"]
  },
  {
    key: "quote_price_change",
    label: "Quote price change",
    actions: ["crm_quote_updated"],
    entityTypes: ["Quote"],
    evidence: "Quote updates persist before/after line items, totals, tax, and discount."
  },
  {
    key: "quote_issue",
    label: "Quote issue",
    actions: ["crm_quote_sent"],
    entityTypes: ["Quote"]
  },
  {
    key: "quote_acceptance",
    label: "Quote acceptance",
    actions: ["crm_quote_accepted"],
    entityTypes: ["Quote"]
  },
  {
    key: "opportunity_conversion",
    label: "Opportunity conversion",
    actions: ["crm_lead_converted_to_opportunity", "crm_opportunity_won_from_quote_conversion"],
    entityTypes: ["SalesOpportunity", "Lead"]
  },
  {
    key: "lost_reason",
    label: "Lost opportunity reason",
    actions: ["crm_opportunity_stage_changed", "crm_opportunity_updated"],
    entityTypes: ["SalesOpportunity"],
    evidence: "Lost reason and lost reason note are included in before/after opportunity state."
  },
  {
    key: "customer_merge",
    label: "Customer duplicate review",
    actions: ["crm_customer_duplicate_reviewed"],
    entityTypes: ["CustomerDuplicateCandidate"],
    limited: true,
    evidence: "Current CRM records duplicate review/dismissal audit. A true merge command is not present in the existing workflow."
  },
  {
    key: "follow_up_completion",
    label: "Follow-up completion",
    actions: ["crm_follow_up_status_changed"],
    entityTypes: ["FollowUp"]
  }
]);

const REQUIRED_CRM_INDEXES = Object.freeze([
  { model: "Lead", key: "lead_status", fields: ["status", "updatedAt"], purpose: "Lead status lists and CRM dashboard counts." },
  { model: "Lead", key: "lead_owner", fields: ["assignedTo.id", "status", "nextFollowUpAt"], purpose: "Owner queues and follow-up routing." },
  { model: "Customer", key: "customer_email", fields: ["emailNormalized"], purpose: "Customer dedupe by email." },
  { model: "Customer", key: "customer_phone", fields: ["phoneNormalized"], purpose: "Customer phone search and duplicate review." },
  { model: "Customer", key: "customer_whatsapp", fields: ["whatsappNormalized"], purpose: "Customer WhatsApp duplicate review." },
  { model: "SalesOpportunity", key: "opportunity_stage", fields: ["stage", "updatedAt"], purpose: "Pipeline stage lists." },
  { model: "SalesOpportunity", key: "opportunity_owner", fields: ["assignedTo.id", "stage", "expectedCloseDate"], purpose: "Pipeline owner work queues." },
  { model: "Quote", key: "quote_status", fields: ["status", "updatedAt"], purpose: "Quote status lists." },
  { model: "Quote", key: "quote_valid_until", fields: ["validUntil", "status"], purpose: "Expiring quote alerts." },
  { model: "FollowUp", key: "follow_up_due", fields: ["status", "dueAt"], purpose: "Overdue and due follow-up queues." },
  { model: "FollowUp", key: "follow_up_owner", fields: ["assignedTo.id", "status", "dueAt"], purpose: "Assigned follow-up lists." },
  { model: "CrmTask", key: "task_due", fields: ["status", "dueDate"], purpose: "CRM task queues." },
  { model: "B2BPartner", key: "b2b_status", fields: ["status", "updatedAt"], purpose: "B2B partner pipeline lists." },
  { model: "B2BPartner", key: "b2b_manager", fields: ["assignedManager.id", "status"], purpose: "B2B manager work queues." }
]);

const SEVERITY_WEIGHT = Object.freeze({
  [CRM_CONTROL_SEVERITY.CRITICAL]: 4,
  [CRM_CONTROL_SEVERITY.ERROR]: 3,
  [CRM_CONTROL_SEVERITY.WARNING]: 2,
  [CRM_CONTROL_SEVERITY.INFO]: 1
});

const toPlain = (value) => {
  if (!value) return value;
  if (typeof value.toObject === "function") return value.toObject();
  return value;
};

const asArray = (value) => (Array.isArray(value) ? value : []);
const normalizeText = (value = "") => String(value || "").trim();
const normalizeUpper = (value = "") => normalizeText(value).toUpperCase();
const idOf = (value) => normalizeText(value?._id || value?.id || value);
const toMoney = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(number, 0) : 0;
};
const parseDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const toIso = (value) => {
  const date = parseDate(value);
  return date ? date.toISOString() : null;
};
const maskEmailReference = (value = "") =>
  normalizeText(value).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (email) => {
    const [name = "", domain = ""] = email.split("@");
    const visible = name.slice(0, Math.min(2, name.length));
    return `${visible || "*"}***@${domain}`;
  });
const numberFrom = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
};

const executeFind = async (query, { sort, limit, select } = {}) => {
  let next = query;
  if (Array.isArray(next)) return next.map(toPlain).slice(0, limit || next.length);
  if (next && select && typeof next.select === "function") next = next.select(select);
  if (next && sort && typeof next.sort === "function") next = next.sort(sort);
  if (next && limit && typeof next.limit === "function") next = next.limit(limit);
  if (next && typeof next.lean === "function") next = next.lean();
  const rows = next && typeof next.then === "function" ? await next : next;
  return asArray(rows).map(toPlain);
};

const countBy = (rows = [], mapper = () => "") => {
  const counts = new Map();
  rows.forEach((row) => {
    const key = normalizeText(typeof mapper === "function" ? mapper(row) : row?.[mapper]) || "UNKNOWN";
    const current = counts.get(key) || { value: key, count: 0 };
    current.count += 1;
    counts.set(key, current);
  });
  return [...counts.values()].sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
};

const hasAssignedUser = (actor = {}) =>
  Boolean(normalizeText(actor.id) || normalizeText(actor.email) || normalizeText(actor.name));

const hasContact = (record = {}) =>
  Boolean(
    normalizeText(record.emailNormalized || record.email) ||
      normalizeText(record.phoneNormalized || record.phone) ||
      normalizeText(record.whatsappNormalized || record.whatsappNumber || record.whatsapp)
  );

const bookingHasBokunEvidence = (booking = {}) =>
  Boolean(
    normalizeText(booking.bokunBookingId) ||
      normalizeText(booking.bokunConfirmationCode) ||
      normalizeText(booking.bokunStatus?.normalized) === "confirmed"
  );

const addIssue = (issues, { code, entityType, entityId, reference = "", message, evidence = {}, severity = "", recommendedAction = "" }) => {
  const definition = ISSUE_DEFINITION[code] || {};
  issues.push({
    issueKey: `CRM_DATA_QUALITY::${code}::${entityType}::${entityId}`,
    code,
    severity: severity || definition.severity || CRM_CONTROL_SEVERITY.WARNING,
    category: definition.category || "CRM_DATA_QUALITY",
    entityType,
    entityId: normalizeText(entityId),
    reference: maskEmailReference(reference),
    message,
    evidence,
    recommendedAction: recommendedAction || definition.recommendedAction || ""
  });
};

const sortIssues = (issues = []) =>
  [...issues].sort((left, right) => {
    const severityDelta = (SEVERITY_WEIGHT[right.severity] || 0) - (SEVERITY_WEIGHT[left.severity] || 0);
    if (severityDelta) return severityDelta;
    return `${left.code}:${left.reference}`.localeCompare(`${right.code}:${right.reference}`);
  });

const filterIssues = (issues = [], filters = {}) =>
  issues
    .filter((issue) => !filters.severity || issue.severity === filters.severity)
    .filter((issue) => !filters.code || issue.code === filters.code)
    .filter((issue) => !filters.entityType || issue.entityType === filters.entityType)
    .filter((issue) => {
      if (!filters.reference) return true;
      const reference = filters.reference.toLowerCase();
      return [issue.reference, issue.entityId, issue.message, issue.code]
        .map((value) => normalizeText(value).toLowerCase())
        .some((value) => value.includes(reference));
    });

const normalizeFilters = (filters = {}) => {
  const severity = normalizeUpper(filters.severity);
  const code = normalizeUpper(filters.code);
  return {
    severity: Object.values(CRM_CONTROL_SEVERITY).includes(severity) ? severity : "",
    code: Object.values(CRM_DATA_QUALITY_ISSUE).includes(code) ? code : "",
    entityType: CRM_ENTITY_TYPES.includes(normalizeText(filters.entityType)) ? normalizeText(filters.entityType) : "",
    reference: normalizeText(filters.reference),
    issueLimit: numberFrom(filters.issueLimit ?? filters.limit, DEFAULT_LIMITS.issueLimit, { min: 1, max: 500 }),
    sourceLimit: numberFrom(filters.sourceLimit, DEFAULT_LIMITS.sourceLimit, { min: 50, max: 5000 })
  };
};

const scanCrmDataQuality = ({ leads = [], opportunities = [], quotes = [], customers = [], duplicateCandidates = [], followUps = [], bookings = [], now = new Date() } = {}) => {
  const issues = [];
  const bookingById = new Map(bookings.map((booking) => [idOf(booking), booking]));

  leads.forEach((lead) => {
    const status = lead.status || CRM_LEAD_STATUS.NEW;
    if (OPEN_LEAD_STATUSES.includes(status) && !hasContact(lead)) {
      addIssue(issues, {
        code: CRM_DATA_QUALITY_ISSUE.LEAD_MISSING_CONTACT,
        entityType: "Lead",
        entityId: idOf(lead),
        reference: lead.leadReference,
        message: "Open lead has no email, phone, or WhatsApp contact.",
        evidence: { status, hasEmail: Boolean(normalizeText(lead.email)), hasPhone: Boolean(normalizeText(lead.phone)), hasWhatsApp: Boolean(normalizeText(lead.whatsappNumber)) }
      });
    }

    if (OPEN_LEAD_STATUSES.includes(status) && !hasAssignedUser(lead.assignedTo)) {
      addIssue(issues, {
        code: CRM_DATA_QUALITY_ISSUE.LEAD_MISSING_OWNER,
        entityType: "Lead",
        entityId: idOf(lead),
        reference: lead.leadReference,
        message: "Open lead has no assigned owner.",
        evidence: { status, assignedTo: lead.assignedTo || {} }
      });
    }
  });

  opportunities.forEach((opportunity) => {
    const stage = opportunity.stage || CRM_OPPORTUNITY_STAGE.NEW;
    const value = toMoney(opportunity.estimatedValue);
    const linkedBooking = bookingById.get(idOf(opportunity.wonBookingId)) || null;
    const hasLocalBooking = Boolean(idOf(opportunity.wonBookingId));
    const hasBokunEvidence = Boolean(normalizeText(opportunity.wonBokunBookingId) || bookingHasBokunEvidence(linkedBooking || {}));

    if (OPEN_OPPORTUNITY_STAGES.includes(stage) && value <= 0) {
      addIssue(issues, {
        code: CRM_DATA_QUALITY_ISSUE.OPPORTUNITY_MISSING_VALUE,
        entityType: "SalesOpportunity",
        entityId: idOf(opportunity),
        reference: opportunity.opportunityNumber,
        message: "Open opportunity has no estimated value for pipeline forecasting.",
        evidence: { stage, estimatedValue: opportunity.estimatedValue, currency: opportunity.currency || "" }
      });
    }

    if (stage === CRM_OPPORTUNITY_STAGE.WON && !hasLocalBooking) {
      addIssue(issues, {
        code: CRM_DATA_QUALITY_ISSUE.CONVERTED_OPPORTUNITY_WITHOUT_BOOKING,
        entityType: "SalesOpportunity",
        entityId: idOf(opportunity),
        reference: opportunity.opportunityNumber,
        message: "Won opportunity is not linked to a canonical local booking.",
        evidence: { stage, wonBookingId: idOf(opportunity.wonBookingId), wonBokunBookingId: normalizeText(opportunity.wonBokunBookingId) }
      });
    }

    if (stage === CRM_OPPORTUNITY_STAGE.WON && !hasBokunEvidence) {
      addIssue(issues, {
        code: CRM_DATA_QUALITY_ISSUE.WON_OPPORTUNITY_WITHOUT_BOKUN_CONFIRMATION,
        entityType: "SalesOpportunity",
        entityId: idOf(opportunity),
        reference: opportunity.opportunityNumber,
        message: "Won opportunity has no Bokun confirmation evidence.",
        evidence: {
          stage,
          wonBookingId: idOf(opportunity.wonBookingId),
          wonBokunBookingId: normalizeText(opportunity.wonBokunBookingId),
          linkedBookingBokunId: normalizeText(linkedBooking?.bokunBookingId),
          linkedBookingBokunStatus: normalizeText(linkedBooking?.bokunStatus?.normalized)
        }
      });
    }
  });

  quotes.forEach((quote) => {
    const status = quote.status || "";
    if (!ACTIVE_QUOTE_STATUSES.includes(status)) return;
    if (normalizeText(quote.customerId)) return;
    addIssue(issues, {
      code: CRM_DATA_QUALITY_ISSUE.QUOTE_MISSING_CUSTOMER,
      entityType: "Quote",
      entityId: idOf(quote),
      reference: quote.quoteNumber,
      message: "Active quote is not linked to a customer master record.",
      evidence: {
        status,
        leadId: idOf(quote.leadId),
        opportunityId: idOf(quote.opportunityId),
        hasLeadOrOpportunityContext: Boolean(idOf(quote.leadId) || idOf(quote.opportunityId))
      }
    });
  });

  customers.forEach((customer) => {
    const hasPossibleDuplicate =
      customer.deduplicationStatus === CUSTOMER_DUPLICATE_STATUS.POSSIBLE_DUPLICATE ||
      Boolean(idOf(customer.possibleDuplicateOf)) ||
      asArray(customer.possibleDuplicateReasons).length > 0;
    if (!hasPossibleDuplicate) return;
    addIssue(issues, {
      code: CRM_DATA_QUALITY_ISSUE.DUPLICATE_CUSTOMER_SUSPICION,
      entityType: "Customer",
      entityId: idOf(customer),
      reference: customer.crmCustomerNumber || customer.emailNormalized || customer.email,
      message: "Customer master record is flagged as a possible duplicate.",
      evidence: {
        deduplicationStatus: customer.deduplicationStatus,
        possibleDuplicateOf: idOf(customer.possibleDuplicateOf),
        possibleDuplicateReasons: asArray(customer.possibleDuplicateReasons)
      }
    });
  });

  duplicateCandidates.forEach((candidate) => {
    if (candidate.status !== DUPLICATE_CANDIDATE_STATUS.OPEN) return;
    addIssue(issues, {
      code: CRM_DATA_QUALITY_ISSUE.DUPLICATE_CUSTOMER_SUSPICION,
      entityType: "CustomerDuplicateCandidate",
      entityId: idOf(candidate),
      reference: candidate.candidateKey,
      message: "Open customer duplicate candidate needs review.",
      evidence: {
        primaryCustomerId: idOf(candidate.primaryCustomerId),
        duplicateCustomerId: idOf(candidate.duplicateCustomerId),
        confidence: candidate.confidence,
        matchFields: asArray(candidate.matchFields)
      }
    });
  });

  followUps.forEach((followUp) => {
    const dueAt = parseDate(followUp.dueAt);
    if (followUp.status !== CRM_FOLLOW_UP_STATUS.PENDING || !dueAt || dueAt > now) return;
    addIssue(issues, {
      code: CRM_DATA_QUALITY_ISSUE.OVERDUE_FOLLOW_UP,
      entityType: "FollowUp",
      entityId: idOf(followUp),
      reference: followUp.type || "FOLLOW_UP",
      message: "Pending CRM follow-up is overdue.",
      evidence: {
        status: followUp.status,
        dueAt: dueAt.toISOString(),
        assignedTo: followUp.assignedTo || {}
      }
    });
  });

  return sortIssues(issues);
};

const buildAuditCoverage = (auditLogs = []) => {
  const actionCounts = new Map();
  auditLogs.forEach((log) => {
    const action = normalizeText(log.action);
    if (!action) return;
    actionCounts.set(action, (actionCounts.get(action) || 0) + 1);
  });

  const items = AUDIT_COVERAGE_REQUIREMENTS.map((requirement) => {
    const observedCount = requirement.actions.reduce((total, action) => total + (actionCounts.get(action) || 0), 0);
    return {
      key: requirement.key,
      label: requirement.label,
      status: observedCount > 0 ? "OBSERVED" : requirement.limited ? "LIMITED" : "CONFIGURED",
      actions: requirement.actions,
      entityTypes: requirement.entityTypes,
      observedCount,
      evidence: requirement.evidence || "AuditLog stores actor, action, entity, before/after state, metadata, and request correlation.",
      limitation: requirement.limited ? requirement.evidence : ""
    };
  });

  return {
    totalRequirements: items.length,
    observed: items.filter((item) => item.status === "OBSERVED").length,
    configured: items.filter((item) => item.status === "CONFIGURED").length,
    limited: items.filter((item) => item.status === "LIMITED").length,
    immutableAuditLog: true,
    storesBeforeAfter: true,
    items
  };
};

const buildPermissionPosture = () => {
  const rolePermissions = {
    [ROLES.SUPER_ADMIN]: getPermissionsForRole(ROLES.SUPER_ADMIN),
    [ROLES.ADMIN]: getPermissionsForRole(ROLES.ADMIN),
    [ROLES.STAFF]: getPermissionsForRole(ROLES.STAFF)
  };
  const items = REQUIRED_CRM_PERMISSIONS.map(({ key, purpose }) => {
    const permission = PERMISSIONS[key] || "";
    return {
      key,
      permission,
      purpose,
      declared: Boolean(permission),
      superAdminHasPermission: permission ? rolePermissions[ROLES.SUPER_ADMIN].includes(permission) : false,
      adminHasPermission: permission ? rolePermissions[ROLES.ADMIN].includes(permission) : false,
      staffHasPermission: permission ? rolePermissions[ROLES.STAFF].includes(permission) : false
    };
  });
  const sensitiveItems = items.filter((item) => SENSITIVE_CRM_PERMISSIONS.includes(item.key));

  return {
    requiredCount: items.length,
    declaredCount: items.filter((item) => item.declared).length,
    adminCoverageComplete: items.every((item) => item.adminHasPermission || item.superAdminHasPermission),
    staffSensitiveAccessDenied: sensitiveItems.every((item) => !item.staffHasPermission),
    rolePermissions,
    sensitivePermissions: sensitiveItems,
    items
  };
};

const buildPrivacyControls = (permissionPosture) => ({
  customerFinancials: {
    status: permissionPosture.items.find((item) => item.key === "CRM_VIEW_CUSTOMER_FINANCIALS")?.staffHasPermission ? "FAILED" : "CONFIGURED",
    permission: PERMISSIONS.CRM_VIEW_CUSTOMER_FINANCIALS,
    evidence: "CRM customer profile only includes accounting financial summary when crm.view_customer_financials is present."
  },
  customerContactAccess: {
    status: permissionPosture.items.find((item) => item.key === "CRM_VIEW_CUSTOMERS")?.declared ? "CONFIGURED" : "FAILED",
    permission: PERMISSIONS.CRM_VIEW_CUSTOMERS,
    evidence: "Customer and timeline routes are protected by CRM customer permissions."
  },
  providerSecrets: {
    status: "CONFIGURED",
    evidence: "CRM controls do not expose provider metadata; audit-control sanitizes token, secret, card, authorization, and signature fields."
  },
  communicationDelivery: {
    status: "CONFIGURED",
    evidence: "CRM communication status remains manual/in-app unless a real provider delivery integration supplies verified delivery state."
  }
});

const buildDuplicateProtection = () => ({
  leadConversion: {
    status: "CONFIGURED",
    evidence: "Converted leads return already_converted instead of creating another customer conversion."
  },
  quoteConversion: {
    status: "CONFIGURED",
    evidence: "Converted quotes return existing when the same booking evidence is provided and reject conflicting booking links."
  },
  bookingLink: {
    status: "CONFIGURED",
    evidence: "Quote conversion checks existing convertedBookingId before linking a confirmed booking to another CRM quote."
  },
  wonOpportunity: {
    status: "CONFIGURED",
    evidence: "WON opportunities require confirmed booking or Bokun booking evidence at the service boundary."
  }
});

const collectIndexKeys = (Model) => {
  const indexes = [];
  const schema = Model?.schema;
  if (!schema) return indexes;

  if (typeof schema.indexes === "function") {
    indexes.push(...schema.indexes().map(([fields]) => Object.keys(fields || {})));
  }

  Object.entries(schema.paths || {}).forEach(([pathName, path]) => {
    if (path?.options?.index || path?.options?.unique) indexes.push([pathName]);
  });

  return indexes;
};

const indexCoversFields = (indexFields = [], requiredFields = []) => {
  if (!requiredFields.length) return true;
  const joined = indexFields.join("|");
  return requiredFields.every((field) => indexFields.includes(field) || joined.includes(`${field}.`));
};

const buildPerformancePosture = (models = {}) => {
  const modelIndexes = Object.fromEntries(
    Object.entries(models).map(([modelName, Model]) => [modelName, collectIndexKeys(Model)])
  );
  const items = REQUIRED_CRM_INDEXES.map((requirement) => {
    const indexes = modelIndexes[requirement.model] || [];
    const matchingIndex = indexes.find((indexFields) => indexCoversFields(indexFields, requirement.fields));
    return {
      ...requirement,
      status: matchingIndex ? "CONFIGURED" : "MISSING",
      matchedIndex: matchingIndex || []
    };
  });

  return {
    paginationConfigured: true,
    scannedFromSchema: true,
    totalRequirements: items.length,
    configured: items.filter((item) => item.status === "CONFIGURED").length,
    missing: items.filter((item) => item.status === "MISSING").length,
    items
  };
};

const allAuditActions = () => [...new Set(AUDIT_COVERAGE_REQUIREMENTS.flatMap((requirement) => requirement.actions))];

const createCrmControlsService = ({
  AuditLogModel = AuditLog,
  B2BPartnerModel = B2BPartner,
  BookingModel = Booking,
  CrmTaskModel = CrmTask,
  CustomerModel = Customer,
  CustomerDuplicateCandidateModel = CustomerDuplicateCandidate,
  FollowUpModel = FollowUp,
  LeadModel = Lead,
  QuoteModel = Quote,
  SalesOpportunityModel = SalesOpportunity,
  now = () => new Date()
} = {}) => {
  const getCrmControls = async (filters = {}) => {
    const normalizedFilters = normalizeFilters(filters);
    const current = parseDate(now()) || new Date();
    const sourceLimit = normalizedFilters.sourceLimit;

    const [leads, opportunities, quotes, customers, duplicateCandidates, followUps, bookings, auditLogs] = await Promise.all([
      executeFind(LeadModel.find({}), { sort: { updatedAt: -1 }, limit: sourceLimit }),
      executeFind(SalesOpportunityModel.find({}), { sort: { updatedAt: -1 }, limit: sourceLimit }),
      executeFind(QuoteModel.find({}), { sort: { updatedAt: -1 }, limit: sourceLimit }),
      executeFind(CustomerModel.find({}), { sort: { updatedAt: -1 }, limit: sourceLimit }),
      executeFind(CustomerDuplicateCandidateModel.find({}), { sort: { updatedAt: -1 }, limit: sourceLimit }),
      executeFind(FollowUpModel.find({}), { sort: { dueAt: 1 }, limit: sourceLimit }),
      executeFind(BookingModel.find({}), {
        sort: { updatedAt: -1 },
        limit: sourceLimit,
        select: "bookingReference bokunBookingId bokunConfirmationCode bokunStatus"
      }),
      executeFind(AuditLogModel.find({ action: { $in: allAuditActions() } }), {
        sort: { createdAt: -1 },
        limit: DEFAULT_LIMITS.auditLimit,
        select: "action entityType entityId reference createdAt"
      })
    ]);

    const allIssues = scanCrmDataQuality({
      leads,
      opportunities,
      quotes,
      customers,
      duplicateCandidates,
      followUps,
      bookings,
      now: current
    });
    const filteredIssues = filterIssues(allIssues, normalizedFilters).slice(0, normalizedFilters.issueLimit);
    const permissionPosture = buildPermissionPosture();

    return {
      step: "7N",
      module: "CRM_AUDIT_PERMISSIONS_DATA_QUALITY",
      generatedAt: current.toISOString(),
      filters: normalizedFilters,
      sourceOfTruth: {
        crmSource: "CRM owns pre-booking leads, opportunities, quotes, follow-ups, communications, and customer relationship records.",
        operationalBookingSource: "Bokun confirmed bookings remain operational booking truth after conversion.",
        financialSource: "Local accounting remains financial truth after a Bokun-confirmed booking enters accounting.",
        forecastGuardrail: "CRM pipeline and quote values are forecasts and are not posted as accounting revenue."
      },
      dataQuality: {
        totalDetected: allIssues.length,
        total: filteredIssues.length,
        bySeverity: countBy(allIssues, "severity"),
        byCode: countBy(allIssues, "code"),
        items: filteredIssues
      },
      auditCoverage: buildAuditCoverage(auditLogs),
      permissions: permissionPosture,
      performance: buildPerformancePosture({
        B2BPartner: B2BPartnerModel,
        CrmTask: CrmTaskModel,
        Customer: CustomerModel,
        FollowUp: FollowUpModel,
        Lead: LeadModel,
        Quote: QuoteModel,
        SalesOpportunity: SalesOpportunityModel
      }),
      privacy: buildPrivacyControls(permissionPosture),
      duplicateProtection: buildDuplicateProtection(),
      limitations: [
        "This control endpoint is read-only and does not merge customers or mutate CRM records.",
        "Customer duplicate merge is not a separate implemented command in the current CRM workflow; duplicate review is audited.",
        "Observed audit counts depend on existing AuditLog history. A zero count means no matching event was observed in the scanned log window, not that the code path is unavailable.",
        "CRM data-quality scans are bounded by sourceLimit to protect production response time."
      ]
    };
  };

  return {
    getCrmControls
  };
};

const service = createCrmControlsService();

module.exports = {
  ...service,
  createCrmControlsService,
  __testables: {
    AUDIT_COVERAGE_REQUIREMENTS,
    REQUIRED_CRM_PERMISSIONS,
    REQUIRED_CRM_INDEXES,
    buildPerformancePosture,
    filterIssues,
    normalizeFilters,
    scanCrmDataQuality
  }
};
