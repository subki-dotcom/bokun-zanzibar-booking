const FollowUp = require("../../models/FollowUp");
const CrmTask = require("../../models/CrmTask");
const Lead = require("../../models/Lead");
const SalesOpportunity = require("../../models/SalesOpportunity");
const Customer = require("../../models/Customer");
const Quote = require("../../models/Quote");
const CustomerTimelineEvent = require("../../models/CustomerTimelineEvent");
const AuditLog = require("../../models/AuditLog");
const AppError = require("../../utils/AppError");
const {
  CRM_FOLLOW_UP_STATUS,
  CRM_FOLLOW_UP_TYPE,
  CRM_PRIORITY,
  CRM_TASK_RELATED_ENTITY_TYPE,
  CRM_TASK_STATUS,
  CUSTOMER_TIMELINE_EVENT_TYPE
} = require("../../crm/constants");

const OPEN_TASK_STATUSES = Object.freeze([CRM_TASK_STATUS.TODO, CRM_TASK_STATUS.IN_PROGRESS]);
const OPEN_FOLLOW_UP_STATUSES = Object.freeze([CRM_FOLLOW_UP_STATUS.PENDING, CRM_FOLLOW_UP_STATUS.MISSED]);

const cleanText = (value = "", maxLength = 240) => String(value || "").trim().slice(0, maxLength);
const idOf = (value) => String(value?._id || value?.id || value || "");
const toPlain = (value) => {
  if (!value) return value;
  if (typeof value.toObject === "function") return value.toObject();
  return value;
};
const escapeRegExp = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalizeDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const actorSnapshot = (auth = {}) => ({
  id: cleanText(auth.id || auth.userId || "", 120),
  role: cleanText(auth.role || "system", 80),
  email: cleanText(auth.email || "", 160),
  name: cleanText(auth.name || "", 160)
});

const executeQuery = async (query, { sort, limit, skip, populate } = {}) => {
  let next = query;
  if (next && populate && typeof next.populate === "function") next = next.populate(populate);
  if (next && sort && typeof next.sort === "function") next = next.sort(sort);
  if (next && Number.isFinite(skip) && typeof next.skip === "function") next = next.skip(skip);
  if (next && Number.isFinite(limit) && typeof next.limit === "function") next = next.limit(limit);
  if (next && typeof next.lean === "function") next = next.lean();
  return next && typeof next.then === "function" ? next : Promise.resolve(next);
};

const normalizeAssignedTo = (value = {}, auth = {}) => ({
  id: cleanText(value.id || value.userId || auth.id || auth.userId || "", 120),
  role: cleanText(value.role || auth.role || "", 80),
  email: cleanText(value.email || auth.email || "", 160),
  name: cleanText(value.name || auth.name || "", 160)
});

const normalizePriority = (value = CRM_PRIORITY.NORMAL) =>
  Object.values(CRM_PRIORITY).includes(value) ? value : CRM_PRIORITY.NORMAL;

const summarizeFollowUp = (followUp = {}, now = new Date()) => {
  const plain = toPlain(followUp) || {};
  const dueAt = plain.dueAt || null;
  const status = plain.status || CRM_FOLLOW_UP_STATUS.PENDING;
  const dueDate = dueAt ? new Date(dueAt) : null;
  const overdue = status === CRM_FOLLOW_UP_STATUS.PENDING && dueDate && dueDate.getTime() < now.getTime();
  return {
    _id: plain._id,
    id: idOf(plain),
    leadId: plain.leadId || null,
    opportunityId: plain.opportunityId || null,
    customerId: plain.customerId || null,
    type: plain.type || CRM_FOLLOW_UP_TYPE.CALL,
    dueAt,
    status,
    assignedTo: plain.assignedTo || {},
    priority: plain.priority || CRM_PRIORITY.NORMAL,
    notes: plain.notes || "",
    completedAt: plain.completedAt || null,
    outcome: plain.outcome || "",
    overdue: Boolean(overdue),
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null
  };
};

const summarizeTask = (task = {}, now = new Date()) => {
  const plain = toPlain(task) || {};
  const dueDate = plain.dueDate || null;
  const status = plain.status || CRM_TASK_STATUS.TODO;
  const due = dueDate ? new Date(dueDate) : null;
  const overdue = OPEN_TASK_STATUSES.includes(status) && due && due.getTime() < now.getTime();
  return {
    _id: plain._id,
    id: idOf(plain),
    title: plain.title || "",
    description: plain.description || "",
    relatedEntityType: plain.relatedEntityType || CRM_TASK_RELATED_ENTITY_TYPE.OTHER,
    relatedEntityId: plain.relatedEntityId || "",
    assignedTo: plain.assignedTo || {},
    dueDate,
    priority: plain.priority || CRM_PRIORITY.NORMAL,
    status,
    completedAt: plain.completedAt || null,
    outcome: plain.outcome || "",
    overdue: Boolean(overdue),
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null
  };
};

const buildFollowUpListQuery = (filters = {}) => {
  const query = {};
  if (filters.status) query.status = filters.status;
  if (filters.type) query.type = filters.type;
  if (filters.priority) query.priority = filters.priority;
  if (filters.assignedTo) query["assignedTo.id"] = cleanText(filters.assignedTo, 120);
  if (filters.leadId) query.leadId = filters.leadId;
  if (filters.opportunityId) query.opportunityId = filters.opportunityId;
  if (filters.customerId) query.customerId = filters.customerId;
  if (filters.dueBefore) query.dueAt = { ...(query.dueAt || {}), $lte: normalizeDate(filters.dueBefore) };
  if (filters.dueAfter) query.dueAt = { ...(query.dueAt || {}), $gte: normalizeDate(filters.dueAfter) };
  if (filters.search) {
    const regex = new RegExp(escapeRegExp(cleanText(filters.search, 160)), "i");
    query.$or = [{ notes: regex }, { outcome: regex }];
  }
  return query;
};

const buildTaskListQuery = (filters = {}) => {
  const query = {};
  if (filters.status) query.status = filters.status;
  if (filters.priority) query.priority = filters.priority;
  if (filters.assignedTo) query["assignedTo.id"] = cleanText(filters.assignedTo, 120);
  if (filters.relatedEntityType) query.relatedEntityType = filters.relatedEntityType;
  if (filters.relatedEntityId) query.relatedEntityId = cleanText(filters.relatedEntityId, 180);
  if (filters.dueBefore) query.dueDate = { ...(query.dueDate || {}), $lte: normalizeDate(filters.dueBefore) };
  if (filters.dueAfter) query.dueDate = { ...(query.dueDate || {}), $gte: normalizeDate(filters.dueAfter) };
  if (filters.search) {
    const regex = new RegExp(escapeRegExp(cleanText(filters.search, 160)), "i");
    query.$or = [{ title: regex }, { description: regex }, { outcome: regex }];
  }
  return query;
};

const createCrmFollowUpService = ({
  FollowUpModel = FollowUp,
  CrmTaskModel = CrmTask,
  LeadModel = Lead,
  SalesOpportunityModel = SalesOpportunity,
  CustomerModel = Customer,
  QuoteModel = Quote,
  AuditLogModel = AuditLog,
  CustomerTimelineEventModel = CustomerTimelineEvent,
  now = () => new Date()
} = {}) => {
  const recordAudit = async ({ action, entityType, entityId, before = null, after = null, auth = {}, requestId = "", metadata = {} }) =>
    AuditLogModel.create({
      actorId: actorSnapshot(auth).id || null,
      actorRole: actorSnapshot(auth).role || "system",
      action,
      entityType,
      entityId: String(entityId || ""),
      requestId,
      before,
      after,
      metadata
    });

  const createTimelineEvent = async ({ customerId, sourceEntityType, sourceEntityId, reference = "", eventType, summary, auth = {}, requestId = "", metadata = {} }) => {
    if (!customerId) return null;
    return CustomerTimelineEventModel.create({
      customerId,
      eventType,
      sourceModule: "CRM",
      sourceEntityType,
      sourceEntityId,
      reference,
      summary,
      occurredAt: now(),
      actor: actorSnapshot(auth),
      metadata: {
        requestId,
        ...metadata
      }
    });
  };

  const hydrateFollowUpRelations = async (patch = {}) => {
    const next = { ...patch };
    if (next.leadId) {
      const lead = await LeadModel.findById(next.leadId);
      if (!lead) throw new AppError("Lead not found", 404, "CRM_LEAD_NOT_FOUND");
      const plainLead = toPlain(lead) || lead;
      if (!next.customerId && plainLead.customerId) next.customerId = plainLead.customerId;
    }
    if (next.opportunityId) {
      const opportunity = await SalesOpportunityModel.findById(next.opportunityId);
      if (!opportunity) throw new AppError("Opportunity not found", 404, "CRM_OPPORTUNITY_NOT_FOUND");
      const plainOpportunity = toPlain(opportunity) || opportunity;
      if (!next.leadId && plainOpportunity.leadId) next.leadId = plainOpportunity.leadId;
      if (!next.customerId && plainOpportunity.customerId) next.customerId = plainOpportunity.customerId;
    }
    if (next.customerId) {
      const customer = await CustomerModel.findById(next.customerId);
      if (!customer) throw new AppError("Customer not found", 404, "CRM_CUSTOMER_NOT_FOUND");
    }
    if (!next.leadId && !next.opportunityId && !next.customerId) {
      throw new AppError(
        "Follow-up must be linked to a lead, opportunity, or customer.",
        422,
        "CRM_FOLLOW_UP_RELATION_REQUIRED"
      );
    }
    return next;
  };

  const validateTaskRelation = async (patch = {}) => {
    if (!patch.relatedEntityId || patch.relatedEntityType === CRM_TASK_RELATED_ENTITY_TYPE.OTHER) return patch;
    const relationChecks = {
      [CRM_TASK_RELATED_ENTITY_TYPE.LEAD]: LeadModel,
      [CRM_TASK_RELATED_ENTITY_TYPE.OPPORTUNITY]: SalesOpportunityModel,
      [CRM_TASK_RELATED_ENTITY_TYPE.CUSTOMER]: CustomerModel,
      [CRM_TASK_RELATED_ENTITY_TYPE.QUOTE]: QuoteModel
    };
    const model = relationChecks[patch.relatedEntityType];
    if (!model?.findById) return patch;
    const found = await model.findById(patch.relatedEntityId);
    if (!found) {
      throw new AppError("Related CRM entity not found", 404, "CRM_TASK_RELATED_ENTITY_NOT_FOUND");
    }
    return patch;
  };

  const buildFollowUpPatch = (payload = {}, auth = {}, existing = {}) => {
    const base = toPlain(existing) || {};
    const status = Object.values(CRM_FOLLOW_UP_STATUS).includes(payload.status)
      ? payload.status
      : base.status || CRM_FOLLOW_UP_STATUS.PENDING;
    const completedAt = status === CRM_FOLLOW_UP_STATUS.COMPLETED
      ? normalizeDate(payload.completedAt) || base.completedAt || now()
      : null;
    return {
      leadId: payload.leadId ?? base.leadId ?? null,
      opportunityId: payload.opportunityId ?? base.opportunityId ?? null,
      customerId: payload.customerId ?? base.customerId ?? null,
      type: Object.values(CRM_FOLLOW_UP_TYPE).includes(payload.type) ? payload.type : base.type || CRM_FOLLOW_UP_TYPE.CALL,
      dueAt: normalizeDate(payload.dueAt) || base.dueAt || null,
      status,
      assignedTo: normalizeAssignedTo(payload.assignedTo || base.assignedTo || {}, auth),
      priority: normalizePriority(payload.priority || base.priority),
      notes: Object.prototype.hasOwnProperty.call(payload, "notes") ? cleanText(payload.notes, 2000) : base.notes || "",
      completedAt,
      outcome: Object.prototype.hasOwnProperty.call(payload, "outcome") ? cleanText(payload.outcome, 2000) : base.outcome || "",
      updatedBy: actorSnapshot(auth)
    };
  };

  const validateFollowUpPatch = (patch = {}) => {
    if (!patch.dueAt) {
      throw new AppError("Follow-up due date is required.", 422, "CRM_FOLLOW_UP_DUE_DATE_REQUIRED");
    }
  };

  const buildTaskPatch = (payload = {}, auth = {}, existing = {}) => {
    const base = toPlain(existing) || {};
    const status = Object.values(CRM_TASK_STATUS).includes(payload.status)
      ? payload.status
      : base.status || CRM_TASK_STATUS.TODO;
    const completedAt = status === CRM_TASK_STATUS.DONE
      ? normalizeDate(payload.completedAt) || base.completedAt || now()
      : null;
    return {
      title: Object.prototype.hasOwnProperty.call(payload, "title") ? cleanText(payload.title, 240) : base.title || "",
      description: Object.prototype.hasOwnProperty.call(payload, "description")
        ? cleanText(payload.description, 3000)
        : base.description || "",
      relatedEntityType: Object.values(CRM_TASK_RELATED_ENTITY_TYPE).includes(payload.relatedEntityType)
        ? payload.relatedEntityType
        : base.relatedEntityType || CRM_TASK_RELATED_ENTITY_TYPE.OTHER,
      relatedEntityId: Object.prototype.hasOwnProperty.call(payload, "relatedEntityId")
        ? cleanText(payload.relatedEntityId, 180)
        : base.relatedEntityId || "",
      assignedTo: normalizeAssignedTo(payload.assignedTo || base.assignedTo || {}, auth),
      dueDate: Object.prototype.hasOwnProperty.call(payload, "dueDate")
        ? normalizeDate(payload.dueDate)
        : base.dueDate || null,
      priority: normalizePriority(payload.priority || base.priority),
      status,
      completedAt,
      outcome: Object.prototype.hasOwnProperty.call(payload, "outcome") ? cleanText(payload.outcome, 2000) : base.outcome || "",
      updatedBy: actorSnapshot(auth)
    };
  };

  const validateTaskPatch = (patch = {}) => {
    if (!patch.title) {
      throw new AppError("Task title is required.", 422, "CRM_TASK_TITLE_REQUIRED");
    }
  };

  const listFollowUps = async (filters = {}) => {
    const withMeta = Boolean(filters.withMeta);
    const page = Math.max(Number(filters.page || 1), 1);
    const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 500);
    const query = buildFollowUpListQuery(filters);
    const [items, count] = await Promise.all([
      executeQuery(FollowUpModel.find(query), {
        sort: { dueAt: 1, updatedAt: -1 },
        skip: (page - 1) * limit,
        limit,
        populate: [
          { path: "leadId", select: "leadReference fullName email phone status source" },
          { path: "opportunityId", select: "opportunityNumber title stage" },
          { path: "customerId", select: "fullName email phone crmCustomerNumber lifecycleStage" }
        ]
      }),
      typeof FollowUpModel.countDocuments === "function" ? FollowUpModel.countDocuments(query) : Promise.resolve(0)
    ]);
    const formatted = (items || []).map((item) => summarizeFollowUp(item, now()));
    if (!withMeta) return formatted;
    return {
      items: formatted,
      count,
      page,
      limit,
      filters: {
        search: filters.search || "",
        status: filters.status || "",
        type: filters.type || "",
        priority: filters.priority || "",
        assignedTo: filters.assignedTo || "",
        leadId: filters.leadId || "",
        opportunityId: filters.opportunityId || "",
        customerId: filters.customerId || ""
      }
    };
  };

  const createFollowUp = async ({ payload = {}, auth = {}, requestId = "" } = {}) => {
    const patch = await hydrateFollowUpRelations(buildFollowUpPatch(payload, auth));
    validateFollowUpPatch(patch);
    const followUp = await FollowUpModel.create({
      ...patch,
      createdBy: actorSnapshot(auth),
      updatedBy: actorSnapshot(auth)
    });
    const plainFollowUp = summarizeFollowUp(followUp, now());
    await recordAudit({
      action: "crm_follow_up_created",
      entityType: "FollowUp",
      entityId: plainFollowUp.id,
      after: plainFollowUp,
      auth,
      requestId
    });
    await createTimelineEvent({
      customerId: plainFollowUp.customerId,
      sourceEntityType: "FollowUp",
      sourceEntityId: plainFollowUp.id,
      eventType: CUSTOMER_TIMELINE_EVENT_TYPE.FOLLOW_UP_CREATED,
      summary: "CRM follow-up scheduled.",
      auth,
      requestId,
      metadata: { type: plainFollowUp.type, dueAt: plainFollowUp.dueAt }
    });
    return {
      action: "created",
      followUp: plainFollowUp
    };
  };

  const updateFollowUp = async ({ followUpId, payload = {}, auth = {}, requestId = "" } = {}) => {
    const followUp = await FollowUpModel.findById(followUpId);
    if (!followUp) throw new AppError("Follow-up not found", 404, "CRM_FOLLOW_UP_NOT_FOUND");
    const before = summarizeFollowUp(followUp, now());
    const patch = await hydrateFollowUpRelations(buildFollowUpPatch(payload, auth, before));
    validateFollowUpPatch(patch);
    Object.assign(followUp, patch, { updatedBy: actorSnapshot(auth) });
    await followUp.save();
    const after = summarizeFollowUp(followUp, now());
    await recordAudit({
      action: before.status !== after.status ? "crm_follow_up_status_changed" : "crm_follow_up_updated",
      entityType: "FollowUp",
      entityId: followUpId,
      before,
      after,
      auth,
      requestId
    });
    if (before.status !== CRM_FOLLOW_UP_STATUS.COMPLETED && after.status === CRM_FOLLOW_UP_STATUS.COMPLETED) {
      await createTimelineEvent({
        customerId: after.customerId,
        sourceEntityType: "FollowUp",
        sourceEntityId: after.id,
        eventType: CUSTOMER_TIMELINE_EVENT_TYPE.FOLLOW_UP_COMPLETED,
        summary: "CRM follow-up completed.",
        auth,
        requestId,
        metadata: { type: after.type, outcome: after.outcome }
      });
    }
    return {
      action: "updated",
      followUp: after
    };
  };

  const completeFollowUp = async ({ followUpId, outcome = "", auth = {}, requestId = "" } = {}) =>
    updateFollowUp({
      followUpId,
      payload: {
        status: CRM_FOLLOW_UP_STATUS.COMPLETED,
        outcome
      },
      auth,
      requestId
    });

  const listTasks = async (filters = {}) => {
    const withMeta = Boolean(filters.withMeta);
    const page = Math.max(Number(filters.page || 1), 1);
    const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 500);
    const query = buildTaskListQuery(filters);
    const [items, count] = await Promise.all([
      executeQuery(CrmTaskModel.find(query), {
        sort: { dueDate: 1, updatedAt: -1 },
        skip: (page - 1) * limit,
        limit
      }),
      typeof CrmTaskModel.countDocuments === "function" ? CrmTaskModel.countDocuments(query) : Promise.resolve(0)
    ]);
    const formatted = (items || []).map((item) => summarizeTask(item, now()));
    if (!withMeta) return formatted;
    return {
      items: formatted,
      count,
      page,
      limit,
      filters: {
        search: filters.search || "",
        status: filters.status || "",
        priority: filters.priority || "",
        assignedTo: filters.assignedTo || "",
        relatedEntityType: filters.relatedEntityType || "",
        relatedEntityId: filters.relatedEntityId || ""
      }
    };
  };

  const createTask = async ({ payload = {}, auth = {}, requestId = "" } = {}) => {
    const patch = await validateTaskRelation(buildTaskPatch(payload, auth));
    validateTaskPatch(patch);
    const task = await CrmTaskModel.create({
      ...patch,
      createdBy: actorSnapshot(auth),
      updatedBy: actorSnapshot(auth)
    });
    const plainTask = summarizeTask(task, now());
    await recordAudit({
      action: "crm_task_created",
      entityType: "CrmTask",
      entityId: plainTask.id,
      after: plainTask,
      auth,
      requestId
    });
    await createTimelineEvent({
      customerId: plainTask.relatedEntityType === CRM_TASK_RELATED_ENTITY_TYPE.CUSTOMER ? plainTask.relatedEntityId : null,
      sourceEntityType: "CrmTask",
      sourceEntityId: plainTask.id,
      eventType: CUSTOMER_TIMELINE_EVENT_TYPE.TASK_CREATED,
      summary: "CRM task created.",
      auth,
      requestId,
      metadata: { title: plainTask.title, dueDate: plainTask.dueDate }
    });
    return {
      action: "created",
      task: plainTask
    };
  };

  const updateTask = async ({ taskId, payload = {}, auth = {}, requestId = "" } = {}) => {
    const task = await CrmTaskModel.findById(taskId);
    if (!task) throw new AppError("Task not found", 404, "CRM_TASK_NOT_FOUND");
    const before = summarizeTask(task, now());
    const patch = await validateTaskRelation(buildTaskPatch(payload, auth, before));
    validateTaskPatch(patch);
    Object.assign(task, patch, { updatedBy: actorSnapshot(auth) });
    await task.save();
    const after = summarizeTask(task, now());
    await recordAudit({
      action: before.status !== after.status ? "crm_task_status_changed" : "crm_task_updated",
      entityType: "CrmTask",
      entityId: taskId,
      before,
      after,
      auth,
      requestId
    });
    if (before.status !== CRM_TASK_STATUS.DONE && after.status === CRM_TASK_STATUS.DONE) {
      await createTimelineEvent({
        customerId: after.relatedEntityType === CRM_TASK_RELATED_ENTITY_TYPE.CUSTOMER ? after.relatedEntityId : null,
        sourceEntityType: "CrmTask",
        sourceEntityId: after.id,
        eventType: CUSTOMER_TIMELINE_EVENT_TYPE.TASK_COMPLETED,
        summary: "CRM task completed.",
        auth,
        requestId,
        metadata: { title: after.title, outcome: after.outcome }
      });
    }
    return {
      action: "updated",
      task: after
    };
  };

  const completeTask = async ({ taskId, outcome = "", auth = {}, requestId = "" } = {}) =>
    updateTask({
      taskId,
      payload: {
        status: CRM_TASK_STATUS.DONE,
        outcome
      },
      auth,
      requestId
    });

  const getFollowUpDashboardMetrics = async () => {
    const current = now();
    const [
      followUpCount,
      pendingFollowUpCount,
      followUpsDueCount,
      missedFollowUpCount,
      taskCount,
      openTaskCount,
      tasksDueCount
    ] = await Promise.all([
      typeof FollowUpModel.countDocuments === "function" ? FollowUpModel.countDocuments({}) : Promise.resolve(0),
      typeof FollowUpModel.countDocuments === "function"
        ? FollowUpModel.countDocuments({ status: CRM_FOLLOW_UP_STATUS.PENDING })
        : Promise.resolve(0),
      typeof FollowUpModel.countDocuments === "function"
        ? FollowUpModel.countDocuments({ status: CRM_FOLLOW_UP_STATUS.PENDING, dueAt: { $lte: current } })
        : Promise.resolve(0),
      typeof FollowUpModel.countDocuments === "function"
        ? FollowUpModel.countDocuments({ status: CRM_FOLLOW_UP_STATUS.MISSED })
        : Promise.resolve(0),
      typeof CrmTaskModel.countDocuments === "function" ? CrmTaskModel.countDocuments({}) : Promise.resolve(0),
      typeof CrmTaskModel.countDocuments === "function"
        ? CrmTaskModel.countDocuments({ status: { $in: OPEN_TASK_STATUSES } })
        : Promise.resolve(0),
      typeof CrmTaskModel.countDocuments === "function"
        ? CrmTaskModel.countDocuments({ status: { $in: OPEN_TASK_STATUSES }, dueDate: { $lte: current } })
        : Promise.resolve(0)
    ]);
    return {
      followUpCount,
      pendingFollowUpCount,
      followUpsDueCount,
      overdueFollowUpCount: followUpsDueCount,
      missedFollowUpCount,
      taskCount,
      openTaskCount,
      tasksDueCount,
      overdueTaskCount: tasksDueCount
    };
  };

  return {
    completeFollowUp,
    completeTask,
    createFollowUp,
    createTask,
    getFollowUpDashboardMetrics,
    listFollowUps,
    listTasks,
    updateFollowUp,
    updateTask
  };
};

const service = createCrmFollowUpService();

module.exports = {
  ...service,
  createCrmFollowUpService,
  __testables: {
    buildFollowUpListQuery,
    buildTaskListQuery,
    OPEN_FOLLOW_UP_STATUSES,
    OPEN_TASK_STATUSES,
    summarizeFollowUp,
    summarizeTask
  }
};
