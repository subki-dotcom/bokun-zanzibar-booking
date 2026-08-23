const crypto = require("crypto");
const Lead = require("../../models/Lead");
const Customer = require("../../models/Customer");
const AuditLog = require("../../models/AuditLog");
const CustomerTimelineEvent = require("../../models/CustomerTimelineEvent");
const customersService = require("../customers");
const AppError = require("../../utils/AppError");
const {
  CRM_LEAD_SOURCE,
  CRM_LEAD_STATUS,
  CUSTOMER_LIFECYCLE_STAGE,
  CUSTOMER_TIMELINE_EVENT_TYPE
} = require("../../crm/constants");

const cleanText = (value = "", maxLength = 240) => String(value || "").trim().slice(0, maxLength);
const normalizeEmail = (value = "") => cleanText(value, 240).toLowerCase();
const normalizeTag = (value = "") => cleanText(value, 80).toLowerCase();
const normalizePhone = (value = "") => {
  const text = cleanText(value, 80);
  if (!text) return "";
  const prefix = text.startsWith("+") ? "+" : "";
  const digits = text.replace(/[^\d]/g, "");
  return digits ? `${prefix}${digits}` : "";
};
const toPlain = (value) => {
  if (!value) return value;
  if (typeof value.toObject === "function") return value.toObject();
  return value;
};
const idOf = (value) => String(value?._id || value?.id || value || "");
const escapeRegExp = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalizeDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const actorSnapshot = (auth = {}) => ({
  id: cleanText(auth.id || auth.userId || "", 120),
  role: cleanText(auth.role || "system", 80),
  email: cleanText(auth.email || "", 160)
});

const dedupeTags = (tags = []) => {
  const seen = new Set();
  return (tags || []).map((tag) => cleanText(tag, 80)).filter((tag) => {
    const normalized = normalizeTag(tag);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
};

const normalizeExternalReference = (reference = {}) => ({
  provider: cleanText(reference.provider, 80).toLowerCase(),
  reference: cleanText(reference.reference, 180),
  rawReference: cleanText(reference.rawReference || reference.reference, 180),
  metadata: reference.metadata && typeof reference.metadata === "object" ? reference.metadata : undefined
});

const buildLeadReference = () =>
  `LED-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;

const executeQuery = async (query, { sort, limit, skip, populate } = {}) => {
  let next = query;
  if (next && populate && typeof next.populate === "function") next = next.populate(populate);
  if (next && sort && typeof next.sort === "function") next = next.sort(sort);
  if (next && Number.isFinite(skip) && typeof next.skip === "function") next = next.skip(skip);
  if (next && Number.isFinite(limit) && typeof next.limit === "function") next = next.limit(limit);
  if (next && typeof next.lean === "function") next = next.lean();
  return next && typeof next.then === "function" ? next : Promise.resolve(next);
};

const normalizeInterestedProducts = (items = []) =>
  (items || []).slice(0, 20).map((item = {}) => ({
    productId: cleanText(item.productId, 120),
    productTitle: cleanText(item.productTitle, 180),
    optionId: cleanText(item.optionId, 120),
    optionTitle: cleanText(item.optionTitle, 180)
  }));

const buildLeadPatch = (payload = {}, auth = {}) => {
  const emailNormalized = normalizeEmail(payload.email);
  const phoneNormalized = normalizePhone(payload.phone);
  const whatsappNormalized = normalizePhone(payload.whatsappNumber || payload.whatsapp);
  const tags = dedupeTags(payload.tags || []);
  const adults = Math.max(Number(payload.travelIntent?.adults || 0), 0);
  const children = Math.max(Number(payload.travelIntent?.children || 0), 0);
  const totalParticipants = Math.max(Number(payload.travelIntent?.totalParticipants || adults + children || 0), 0);

  return {
    firstName: cleanText(payload.firstName, 120),
    lastName: cleanText(payload.lastName, 120),
    email: emailNormalized,
    emailNormalized,
    phone: cleanText(payload.phone, 80),
    phoneNormalized,
    whatsappNumber: cleanText(payload.whatsappNumber || payload.whatsapp, 80),
    whatsappNormalized,
    source: Object.values(CRM_LEAD_SOURCE).includes(payload.source) ? payload.source : CRM_LEAD_SOURCE.WEBSITE,
    sourceDetails: cleanText(payload.sourceDetails, 240),
    status: Object.values(CRM_LEAD_STATUS).includes(payload.status) ? payload.status : CRM_LEAD_STATUS.NEW,
    assignedTo: {
      id: cleanText(payload.assignedTo?.id, 120),
      role: cleanText(payload.assignedTo?.role, 80),
      email: cleanText(payload.assignedTo?.email, 160),
      name: cleanText(payload.assignedTo?.name, 160)
    },
    interestedProducts: normalizeInterestedProducts(payload.interestedProducts || []),
    travelIntent: {
      travelDate: cleanText(payload.travelIntent?.travelDate, 30),
      startTime: cleanText(payload.travelIntent?.startTime, 30),
      adults,
      children,
      totalParticipants,
      budgetAmount:
        payload.travelIntent?.budgetAmount === null || payload.travelIntent?.budgetAmount === undefined
          ? null
          : Number(payload.travelIntent.budgetAmount),
      budgetCurrency: cleanText(payload.travelIntent?.budgetCurrency || "USD", 3).toUpperCase() || "USD"
    },
    customerId: payload.customerId || null,
    lostReason: cleanText(payload.lostReason, 1000),
    unqualifiedReason: cleanText(payload.unqualifiedReason, 1000),
    lastContactedAt: normalizeDate(payload.lastContactedAt),
    nextFollowUpAt: normalizeDate(payload.nextFollowUpAt),
    notes: cleanText(payload.notes, 2000),
    tags,
    tagsNormalized: [...new Set(tags.map(normalizeTag).filter(Boolean))],
    externalReferences: (payload.externalReferences || [])
      .map(normalizeExternalReference)
      .filter((reference) => reference.provider && reference.reference),
    rawPayload: payload.rawPayload && typeof payload.rawPayload === "object" ? payload.rawPayload : undefined,
    updatedBy: actorSnapshot(auth)
  };
};

const buildExactLeadClauses = ({ emailNormalized = "", externalReferences = [] } = {}) => {
  const clauses = [];
  if (emailNormalized) clauses.push({ emailNormalized, status: { $nin: [CRM_LEAD_STATUS.CONVERTED, CRM_LEAD_STATUS.ARCHIVED] } });
  externalReferences.forEach((reference) => {
    clauses.push({
      status: { $nin: [CRM_LEAD_STATUS.CONVERTED, CRM_LEAD_STATUS.ARCHIVED] },
      externalReferences: {
        $elemMatch: {
          provider: reference.provider,
          reference: reference.reference
        }
      }
    });
  });
  return clauses;
};

const buildPossibleLeadClauses = ({ phoneNormalized = "", whatsappNormalized = "" } = {}) => {
  const clauses = [];
  if (phoneNormalized) clauses.push({ phoneNormalized, status: { $nin: [CRM_LEAD_STATUS.CONVERTED, CRM_LEAD_STATUS.ARCHIVED] } });
  if (whatsappNormalized) clauses.push({ whatsappNormalized, status: { $nin: [CRM_LEAD_STATUS.CONVERTED, CRM_LEAD_STATUS.ARCHIVED] } });
  return clauses;
};

const resolveLeadDuplicateFields = (left = {}, right = {}) => {
  const fields = [];
  if (left.emailNormalized && left.emailNormalized === (right.emailNormalized || normalizeEmail(right.email))) fields.push("email");
  if (left.phoneNormalized && left.phoneNormalized === (right.phoneNormalized || normalizePhone(right.phone))) fields.push("phone");
  if (left.whatsappNormalized && left.whatsappNormalized === (right.whatsappNormalized || normalizePhone(right.whatsappNumber))) {
    fields.push("whatsapp");
  }
  (left.externalReferences || []).forEach((leftReference) => {
    const found = (right.externalReferences || []).some(
      (rightReference) =>
        String(rightReference.provider || "").toLowerCase() === leftReference.provider &&
        String(rightReference.reference || "") === leftReference.reference
    );
    if (found) fields.push(`external:${leftReference.provider}`);
  });
  return [...new Set(fields)];
};

const summarizeLead = (lead = {}) => {
  const plain = toPlain(lead) || {};
  return {
    _id: plain._id,
    id: idOf(plain),
    leadReference: plain.leadReference || "",
    firstName: plain.firstName || "",
    lastName: plain.lastName || "",
    fullName: plain.fullName || `${plain.firstName || ""} ${plain.lastName || ""}`.trim(),
    email: plain.email || "",
    emailNormalized: plain.emailNormalized || normalizeEmail(plain.email),
    phone: plain.phone || "",
    phoneNormalized: plain.phoneNormalized || normalizePhone(plain.phone),
    whatsappNumber: plain.whatsappNumber || "",
    whatsappNormalized: plain.whatsappNormalized || normalizePhone(plain.whatsappNumber),
    source: plain.source || CRM_LEAD_SOURCE.WEBSITE,
    sourceDetails: plain.sourceDetails || "",
    status: plain.status || CRM_LEAD_STATUS.NEW,
    assignedTo: plain.assignedTo || {},
    interestedProducts: plain.interestedProducts || [],
    travelIntent: plain.travelIntent || {},
    customerId: plain.customerId || null,
    convertedCustomerId: plain.convertedCustomerId || null,
    convertedAt: plain.convertedAt || null,
    duplicateLeadOf: plain.duplicateLeadOf || null,
    duplicateReasons: plain.duplicateReasons || [],
    lastContactedAt: plain.lastContactedAt || null,
    nextFollowUpAt: plain.nextFollowUpAt || null,
    lostReason: plain.lostReason || "",
    unqualifiedReason: plain.unqualifiedReason || "",
    notes: plain.notes || "",
    tags: plain.tags || [],
    externalReferences: plain.externalReferences || [],
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null
  };
};

const createCrmLeadService = ({
  LeadModel = Lead,
  CustomerModel = Customer,
  AuditLogModel = AuditLog,
  CustomerTimelineEventModel = CustomerTimelineEvent,
  customerService = customersService,
  now = () => new Date()
} = {}) => {
  const recordAudit = async ({ action, entityId, before = null, after = null, auth = {}, requestId = "", metadata = {} }) =>
    AuditLogModel.create({
      actorId: actorSnapshot(auth).id || null,
      actorRole: actorSnapshot(auth).role || "system",
      action,
      entityType: "Lead",
      entityId: String(entityId || ""),
      requestId,
      before,
      after,
      metadata
    });

  const findCustomerForLead = async (patch = {}) => {
    const clauses = [];
    if (patch.emailNormalized) clauses.push({ emailNormalized: patch.emailNormalized }, { email: patch.emailNormalized });
    if (patch.phoneNormalized) clauses.push({ phoneNormalized: patch.phoneNormalized });
    if (patch.whatsappNormalized) clauses.push({ whatsappNormalized: patch.whatsappNormalized });
    if (!clauses.length) return null;
    return executeQuery(CustomerModel.findOne({ $or: clauses }));
  };

  const getLead = async (id) => {
    const lead = await executeQuery(LeadModel.findById(id), {
      populate: { path: "customerId", select: "fullName email phone crmCustomerNumber lifecycleStage" }
    });
    if (!lead) {
      throw new AppError("Lead not found", 404, "CRM_LEAD_NOT_FOUND");
    }
    return lead;
  };

  const listLeads = async (filters = {}) => {
    const withMeta = Boolean(filters.withMeta);
    const page = Math.max(Number(filters.page || 1), 1);
    const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 500);
    const query = {};

    if (filters.status) query.status = filters.status;
    if (filters.source) query.source = filters.source;
    if (filters.assignedTo) query["assignedTo.id"] = cleanText(filters.assignedTo, 120);
    if (filters.tag) query.tagsNormalized = normalizeTag(filters.tag);
    if (filters.search) {
      const regex = new RegExp(escapeRegExp(cleanText(filters.search, 160)), "i");
      query.$or = [
        { leadReference: regex },
        { fullName: regex },
        { email: regex },
        { phone: regex },
        { whatsappNumber: regex },
        { sourceDetails: regex }
      ];
    }

    const [items, count] = await Promise.all([
      executeQuery(LeadModel.find(query), {
        sort: { updatedAt: -1, createdAt: -1 },
        skip: (page - 1) * limit,
        limit,
        populate: { path: "customerId", select: "fullName email phone crmCustomerNumber lifecycleStage" }
      }),
      typeof LeadModel.countDocuments === "function" ? LeadModel.countDocuments(query) : Promise.resolve(0)
    ]);

    const formatted = (items || []).map(summarizeLead);
    if (!withMeta) return formatted;
    return {
      items: formatted,
      count,
      page,
      limit,
      filters: {
        search: filters.search || "",
        status: filters.status || "",
        source: filters.source || "",
        assignedTo: filters.assignedTo || "",
        tag: filters.tag || ""
      }
    };
  };

  const createLead = async ({ payload = {}, auth = {}, requestId = "" } = {}) => {
    const patch = buildLeadPatch(payload, auth);
    if (!patch.firstName || !patch.lastName || (!patch.emailNormalized && !patch.phoneNormalized && !patch.whatsappNormalized)) {
      throw new AppError(
        "Lead first name, last name, and at least one contact identifier are required.",
        422,
        "CRM_LEAD_REQUIRED_FIELDS"
      );
    }

    const exactClauses = buildExactLeadClauses(patch);
    const exactMatch = exactClauses.length ? await executeQuery(LeadModel.findOne({ $or: exactClauses })) : null;
    if (exactMatch) {
      await recordAudit({
        action: "crm_lead_duplicate_prevented",
        entityId: idOf(exactMatch),
        after: summarizeLead(exactMatch),
        auth,
        requestId,
        metadata: { attemptedEmail: patch.emailNormalized }
      });
      return {
        action: "existing",
        duplicateReviewRequired: false,
        lead: summarizeLead(exactMatch)
      };
    }

    const possibleClauses = buildPossibleLeadClauses(patch);
    const possibleMatches = possibleClauses.length
      ? await executeQuery(LeadModel.find({ $or: possibleClauses }), { limit: 10 })
      : [];
    const duplicateReasons = (possibleMatches || []).flatMap((match) => resolveLeadDuplicateFields(patch, match));
    const customer = await findCustomerForLead(patch);
    const lead = await LeadModel.create({
      ...patch,
      leadReference: payload.leadReference || buildLeadReference(),
      customerId: customer?._id || null,
      duplicateLeadOf: possibleMatches?.[0]?._id || null,
      duplicateReasons: [...new Set(duplicateReasons)],
      createdBy: actorSnapshot(auth),
      updatedBy: actorSnapshot(auth)
    });
    const plainLead = toPlain(lead);

    await recordAudit({
      action: "crm_lead_created",
      entityId: idOf(plainLead),
      after: summarizeLead(plainLead),
      auth,
      requestId,
      metadata: {
        linkedCustomerId: idOf(customer),
        duplicateLeadOf: idOf(plainLead.duplicateLeadOf),
        duplicateReasons: plainLead.duplicateReasons || []
      }
    });

    return {
      action: "created",
      duplicateReviewRequired: Boolean(plainLead.duplicateLeadOf),
      lead: summarizeLead(plainLead)
    };
  };

  const updateLead = async ({ leadId, payload = {}, auth = {}, requestId = "" } = {}) => {
    const lead = await LeadModel.findById(leadId);
    if (!lead) {
      throw new AppError("Lead not found", 404, "CRM_LEAD_NOT_FOUND");
    }

    const before = summarizeLead(lead);
    const patch = buildLeadPatch(
      {
        ...before,
        ...payload,
        assignedTo: payload.assignedTo || before.assignedTo || {},
        interestedProducts: payload.interestedProducts || before.interestedProducts || [],
        travelIntent: payload.travelIntent || before.travelIntent || {},
        externalReferences: payload.externalReferences || before.externalReferences || [],
        tags: payload.tags || before.tags || []
      },
      auth
    );
    Object.assign(lead, patch, { updatedBy: actorSnapshot(auth) });
    if (patch.status !== CRM_LEAD_STATUS.LOST) lead.lostReason = "";
    if (patch.status !== CRM_LEAD_STATUS.UNQUALIFIED) lead.unqualifiedReason = "";
    await lead.save();
    const after = summarizeLead(lead);

    await recordAudit({
      action: "crm_lead_updated",
      entityId: leadId,
      before,
      after,
      auth,
      requestId
    });

    return {
      action: "updated",
      lead: after
    };
  };

  const convertLeadToCustomer = async ({ leadId, payload = {}, auth = {}, requestId = "" } = {}) => {
    const lead = await LeadModel.findById(leadId);
    if (!lead) {
      throw new AppError("Lead not found", 404, "CRM_LEAD_NOT_FOUND");
    }
    const before = summarizeLead(lead);
    if (before.status === CRM_LEAD_STATUS.CONVERTED && before.convertedCustomerId) {
      return {
        action: "already_converted",
        lead: before,
        customerId: before.convertedCustomerId
      };
    }

    let customerId = payload.customerId || before.customerId || null;
    let customerResult = null;
    if (!customerId) {
      if (!before.email) {
        throw new AppError(
          "Lead conversion requires an email or an existing customer ID.",
          422,
          "CRM_LEAD_CONVERSION_CUSTOMER_EVIDENCE_REQUIRED"
        );
      }
      customerResult = await customerService.createCustomer({
        payload: {
          firstName: before.firstName,
          lastName: before.lastName,
          email: before.email,
          phone: before.phone,
          whatsappNumber: before.whatsappNumber,
          source: before.source,
          sourceDetails: before.sourceDetails,
          lifecycleStage: CUSTOMER_LIFECYCLE_STAGE.LEAD,
          tags: before.tags,
          notes: before.notes,
          externalReferences: [
            ...(before.externalReferences || []),
            { provider: "crm_lead", reference: before.leadReference }
          ]
        },
        auth,
        requestId
      });
      customerId = customerResult.customer?.id || customerResult.customer?._id || null;
    }

    lead.status = CRM_LEAD_STATUS.CONVERTED;
    lead.customerId = customerId;
    lead.convertedCustomerId = customerId;
    lead.convertedAt = now();
    lead.updatedBy = actorSnapshot(auth);
    await lead.save();
    const after = summarizeLead(lead);

    await recordAudit({
      action: "crm_lead_converted_to_customer",
      entityId: leadId,
      before,
      after,
      auth,
      requestId,
      metadata: { customerId }
    });

    if (customerId) {
      await CustomerTimelineEventModel.create({
        customerId,
        eventType: CUSTOMER_TIMELINE_EVENT_TYPE.LEAD_CONVERTED_TO_CUSTOMER,
        sourceModule: "CRM",
        sourceEntityType: "Lead",
        sourceEntityId: leadId,
        reference: before.leadReference,
        summary: "CRM lead converted to a customer master record.",
        occurredAt: now(),
        actor: actorSnapshot(auth),
        metadata: {
          requestId,
          leadReference: before.leadReference,
          source: before.source
        }
      });
    }

    return {
      action: "converted",
      lead: after,
      customerId,
      customerResult,
      timelineEventType: CUSTOMER_TIMELINE_EVENT_TYPE.LEAD_CONVERTED_TO_CUSTOMER
    };
  };

  const getLeadDashboardMetrics = async () => {
    const [
      leadCount,
      newLeadCount,
      qualifiedLeadCount,
      convertedLeadCount,
      lostLeadCount,
      statusBreakdown,
      sourceBreakdown
    ] = await Promise.all([
      typeof LeadModel.countDocuments === "function" ? LeadModel.countDocuments({}) : Promise.resolve(0),
      typeof LeadModel.countDocuments === "function" ? LeadModel.countDocuments({ status: CRM_LEAD_STATUS.NEW }) : Promise.resolve(0),
      typeof LeadModel.countDocuments === "function" ? LeadModel.countDocuments({ status: CRM_LEAD_STATUS.QUALIFIED }) : Promise.resolve(0),
      typeof LeadModel.countDocuments === "function" ? LeadModel.countDocuments({ status: CRM_LEAD_STATUS.CONVERTED }) : Promise.resolve(0),
      typeof LeadModel.countDocuments === "function" ? LeadModel.countDocuments({ status: CRM_LEAD_STATUS.LOST }) : Promise.resolve(0),
      typeof LeadModel.aggregate === "function"
        ? LeadModel.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }, { $sort: { count: -1 } }])
        : Promise.resolve([]),
      typeof LeadModel.aggregate === "function"
        ? LeadModel.aggregate([{ $group: { _id: "$source", count: { $sum: 1 } } }, { $sort: { count: -1 } }])
        : Promise.resolve([])
    ]);

    return {
      leadCount,
      newLeadCount,
      qualifiedLeadCount,
      convertedLeadCount,
      lostLeadCount,
      statusBreakdown,
      sourceBreakdown
    };
  };

  return {
    convertLeadToCustomer,
    createLead,
    getLead,
    getLeadDashboardMetrics,
    listLeads,
    updateLead
  };
};

const service = createCrmLeadService();

module.exports = {
  ...service,
  createCrmLeadService,
  __testables: {
    buildExactLeadClauses,
    buildLeadPatch,
    buildPossibleLeadClauses,
    normalizeEmail,
    normalizePhone,
    resolveLeadDuplicateFields,
    summarizeLead
  }
};
