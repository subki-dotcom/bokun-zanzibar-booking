const crypto = require("crypto");
const SalesOpportunity = require("../../models/SalesOpportunity");
const Lead = require("../../models/Lead");
const Booking = require("../../models/Booking");
const CustomerTimelineEvent = require("../../models/CustomerTimelineEvent");
const AuditLog = require("../../models/AuditLog");
const { createCrmBookingEvidenceService } = require("../crmBookingEvidence");
const AppError = require("../../utils/AppError");
const {
  CRM_LEAD_SOURCE,
  CRM_LEAD_STATUS,
  CRM_LOST_REASON,
  CRM_OPPORTUNITY_STAGE,
  CUSTOMER_TIMELINE_EVENT_TYPE
} = require("../../crm/constants");

const TERMINAL_STAGES = [CRM_OPPORTUNITY_STAGE.WON, CRM_OPPORTUNITY_STAGE.LOST];
const OPEN_STAGE_QUERY = { $nin: TERMINAL_STAGES };
const PIPELINE_STAGE_ORDER = Object.freeze([
  CRM_OPPORTUNITY_STAGE.NEW,
  CRM_OPPORTUNITY_STAGE.QUALIFIED,
  CRM_OPPORTUNITY_STAGE.NEEDS_ANALYSIS,
  CRM_OPPORTUNITY_STAGE.QUOTE_PREPARATION,
  CRM_OPPORTUNITY_STAGE.QUOTE_SENT,
  CRM_OPPORTUNITY_STAGE.NEGOTIATION,
  CRM_OPPORTUNITY_STAGE.AWAITING_CUSTOMER,
  CRM_OPPORTUNITY_STAGE.READY_TO_BOOK,
  CRM_OPPORTUNITY_STAGE.WON,
  CRM_OPPORTUNITY_STAGE.LOST
]);
const STAGE_PROBABILITY = Object.freeze({
  [CRM_OPPORTUNITY_STAGE.NEW]: 10,
  [CRM_OPPORTUNITY_STAGE.QUALIFIED]: 25,
  [CRM_OPPORTUNITY_STAGE.NEEDS_ANALYSIS]: 35,
  [CRM_OPPORTUNITY_STAGE.QUOTE_PREPARATION]: 45,
  [CRM_OPPORTUNITY_STAGE.QUOTE_SENT]: 55,
  [CRM_OPPORTUNITY_STAGE.NEGOTIATION]: 65,
  [CRM_OPPORTUNITY_STAGE.AWAITING_CUSTOMER]: 70,
  [CRM_OPPORTUNITY_STAGE.READY_TO_BOOK]: 85,
  [CRM_OPPORTUNITY_STAGE.WON]: 100,
  [CRM_OPPORTUNITY_STAGE.LOST]: 0
});

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
const normalizeMoney = (value) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.max(amount, 0) : 0;
};
const normalizeProbability = (value, stage) => {
  if (value === undefined || value === null || value === "") return STAGE_PROBABILITY[stage] ?? 0;
  const next = Number(value);
  if (!Number.isFinite(next)) return STAGE_PROBABILITY[stage] ?? 0;
  return Math.min(Math.max(next, 0), 100);
};
const normalizeCurrency = (value = "USD") => cleanText(value || "USD", 3).toUpperCase() || "USD";
const stageLabel = (stage = "") => cleanText(stage, 80).replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
const actorSnapshot = (auth = {}) => ({
  id: cleanText(auth.id || auth.userId || "", 120),
  role: cleanText(auth.role || "system", 80),
  email: cleanText(auth.email || "", 160),
  name: cleanText(auth.name || "", 160)
});
const buildOpportunityNumber = () =>
  `OPP-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;

const executeQuery = async (query, { sort, limit, skip, populate } = {}) => {
  let next = query;
  if (next && populate && typeof next.populate === "function") next = next.populate(populate);
  if (next && sort && typeof next.sort === "function") next = next.sort(sort);
  if (next && Number.isFinite(skip) && typeof next.skip === "function") next = next.skip(skip);
  if (next && Number.isFinite(limit) && typeof next.limit === "function") next = next.limit(limit);
  if (next && typeof next.lean === "function") next = next.lean();
  return next && typeof next.then === "function" ? next : Promise.resolve(next);
};

const normalizeExternalReference = (reference = {}) => ({
  provider: cleanText(reference.provider, 80).toLowerCase(),
  reference: cleanText(reference.reference, 180),
  rawReference: cleanText(reference.rawReference || reference.reference, 180),
  metadata: reference.metadata && typeof reference.metadata === "object" ? reference.metadata : undefined
});

const normalizeInterestedProducts = (items = []) =>
  (items || []).slice(0, 20).map((item = {}) => ({
    productId: cleanText(item.productId, 120),
    productTitle: cleanText(item.productTitle, 180),
    optionId: cleanText(item.optionId, 120),
    optionTitle: cleanText(item.optionTitle, 180)
  }));

const summarizeOpportunity = (opportunity = {}) => {
  const plain = toPlain(opportunity) || {};
  const stage = plain.stage || CRM_OPPORTUNITY_STAGE.NEW;
  const estimatedValue = normalizeMoney(plain.estimatedValue);
  const probability = normalizeProbability(plain.probability, stage);
  return {
    _id: plain._id,
    id: idOf(plain),
    opportunityNumber: plain.opportunityNumber || "",
    leadId: plain.leadId || null,
    customerId: plain.customerId || null,
    title: plain.title || "",
    stage,
    estimatedValue,
    currency: normalizeCurrency(plain.currency),
    probability,
    weightedValue: Number(((estimatedValue * probability) / 100).toFixed(2)),
    expectedCloseDate: plain.expectedCloseDate || null,
    interestedProducts: plain.interestedProducts || [],
    assignedTo: plain.assignedTo || {},
    source: plain.source || CRM_LEAD_SOURCE.WEBSITE,
    notes: plain.notes || "",
    lostReason: plain.lostReason || "",
    lostReasonNote: plain.lostReasonNote || "",
    lostAt: plain.lostAt || null,
    wonBookingId: plain.wonBookingId || null,
    wonBokunBookingId: plain.wonBokunBookingId || "",
    wonAt: plain.wonAt || null,
    stageChangedAt: plain.stageChangedAt || null,
    externalReferences: plain.externalReferences || [],
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null
  };
};

const deriveTitleFromLead = (lead = {}) => {
  const plain = toPlain(lead) || {};
  const leadName = plain.fullName || [plain.firstName, plain.lastName].filter(Boolean).join(" ");
  const product = plain.interestedProducts?.[0]?.productTitle || "";
  return cleanText([leadName, product].filter(Boolean).join(" - ") || "CRM opportunity", 180);
};

const buildOpportunityPatch = (payload = {}, auth = {}, { lead = null, previousStage = "" } = {}) => {
  const leadPlain = toPlain(lead) || {};
  const stage = Object.values(CRM_OPPORTUNITY_STAGE).includes(payload.stage)
    ? payload.stage
    : previousStage || CRM_OPPORTUNITY_STAGE.NEW;
  const title = cleanText(payload.title || deriveTitleFromLead(leadPlain), 180);
  const estimatedValue = normalizeMoney(
    payload.estimatedValue ?? payload.travelIntent?.budgetAmount ?? leadPlain.travelIntent?.budgetAmount
  );
  const currency = normalizeCurrency(payload.currency || payload.travelIntent?.budgetCurrency || leadPlain.travelIntent?.budgetCurrency || "USD");
  const source = Object.values(CRM_LEAD_SOURCE).includes(payload.source)
    ? payload.source
    : leadPlain.source || CRM_LEAD_SOURCE.WEBSITE;

  return {
    leadId: payload.leadId || leadPlain._id || leadPlain.id || null,
    customerId: payload.customerId || leadPlain.customerId || leadPlain.convertedCustomerId || null,
    title,
    stage,
    estimatedValue,
    currency,
    probability: normalizeProbability(payload.probability, stage),
    expectedCloseDate: normalizeDate(payload.expectedCloseDate),
    interestedProducts: normalizeInterestedProducts(payload.interestedProducts || leadPlain.interestedProducts || []),
    assignedTo: {
      id: cleanText(payload.assignedTo?.id || leadPlain.assignedTo?.id, 120),
      role: cleanText(payload.assignedTo?.role || leadPlain.assignedTo?.role, 80),
      email: cleanText(payload.assignedTo?.email || leadPlain.assignedTo?.email, 160),
      name: cleanText(payload.assignedTo?.name || leadPlain.assignedTo?.name, 160)
    },
    source,
    notes: cleanText(payload.notes, 2000),
    lostReason: Object.values(CRM_LOST_REASON).includes(payload.lostReason) ? payload.lostReason : "",
    lostReasonNote: cleanText(payload.lostReasonNote, 1000),
    wonBookingId: payload.wonBookingId || null,
    wonBokunBookingId: cleanText(payload.wonBokunBookingId, 180),
    externalReferences: (payload.externalReferences || [])
      .map(normalizeExternalReference)
      .filter((reference) => reference.provider && reference.reference),
    rawPayload: payload.rawPayload && typeof payload.rawPayload === "object" ? payload.rawPayload : undefined,
    updatedBy: actorSnapshot(auth)
  };
};

const validateOpportunityPatch = (patch = {}) => {
  if (!patch.title) {
    throw new AppError("Opportunity title is required.", 422, "CRM_OPPORTUNITY_TITLE_REQUIRED");
  }
  if (patch.stage === CRM_OPPORTUNITY_STAGE.WON && !patch.wonBookingId && !patch.wonBokunBookingId) {
    throw new AppError(
      "A WON opportunity requires confirmed booking or Bokun booking evidence.",
      422,
      "CRM_OPPORTUNITY_WON_BOOKING_EVIDENCE_REQUIRED"
    );
  }
  if (patch.stage === CRM_OPPORTUNITY_STAGE.LOST && !patch.lostReason) {
    throw new AppError("A lost opportunity requires a normalized lost reason.", 422, "CRM_OPPORTUNITY_LOST_REASON_REQUIRED");
  }
};

const buildListQuery = (filters = {}) => {
  const query = {};
  if (filters.stage) query.stage = filters.stage;
  if (filters.source) query.source = filters.source;
  if (filters.assignedTo) query["assignedTo.id"] = cleanText(filters.assignedTo, 120);
  if (filters.leadId) query.leadId = filters.leadId;
  if (filters.customerId) query.customerId = filters.customerId;
  if (filters.openOnly) query.stage = OPEN_STAGE_QUERY;
  if (filters.search) {
    const regex = new RegExp(escapeRegExp(cleanText(filters.search, 160)), "i");
    query.$or = [
      { opportunityNumber: regex },
      { title: regex },
      { notes: regex },
      { wonBokunBookingId: regex }
    ];
  }
  return query;
};

const createCrmOpportunityService = ({
  SalesOpportunityModel = SalesOpportunity,
  LeadModel = Lead,
  BookingModel = Booking,
  AuditLogModel = AuditLog,
  CustomerTimelineEventModel = CustomerTimelineEvent,
  bookingEvidenceService = createCrmBookingEvidenceService({ BookingModel }),
  now = () => new Date()
} = {}) => {
  const recordAudit = async ({ action, entityId, before = null, after = null, auth = {}, requestId = "", metadata = {} }) =>
    AuditLogModel.create({
      actorId: actorSnapshot(auth).id || null,
      actorRole: actorSnapshot(auth).role || "system",
      action,
      entityType: "SalesOpportunity",
      entityId: String(entityId || ""),
      requestId,
      before,
      after,
      metadata
    });

  const createTimelineEvent = async ({ opportunity, eventType, summary, auth = {}, requestId = "" }) => {
    const customerId = opportunity.customerId || null;
    if (!customerId) return null;
    return CustomerTimelineEventModel.create({
      customerId,
      eventType,
      sourceModule: "CRM",
      sourceEntityType: "SalesOpportunity",
      sourceEntityId: opportunity.id || opportunity._id,
      reference: opportunity.opportunityNumber,
      summary,
      occurredAt: now(),
      actor: actorSnapshot(auth),
      metadata: {
        requestId,
        stage: opportunity.stage,
        leadId: idOf(opportunity.leadId)
      }
    });
  };

  const getOpportunity = async (id) => {
    const opportunity = await executeQuery(SalesOpportunityModel.findById(id), {
      populate: [
        { path: "leadId", select: "leadReference fullName email phone status source" },
        { path: "customerId", select: "fullName email phone crmCustomerNumber lifecycleStage" }
      ]
    });
    if (!opportunity) {
      throw new AppError("Opportunity not found", 404, "CRM_OPPORTUNITY_NOT_FOUND");
    }
    return opportunity;
  };

  const applyWonBookingEvidence = async (patch = {}) => {
    if (patch.stage !== CRM_OPPORTUNITY_STAGE.WON) return null;
    const { evidence } = await bookingEvidenceService.resolveConfirmedBookingEvidence({
      bookingId: patch.wonBookingId,
      bokunBookingId: patch.wonBokunBookingId
    });
    patch.wonBookingId = evidence.bookingId;
    patch.wonBokunBookingId = evidence.bokunBookingId;
    return evidence;
  };

  const listOpportunities = async (filters = {}) => {
    const withMeta = Boolean(filters.withMeta);
    const page = Math.max(Number(filters.page || 1), 1);
    const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 500);
    const query = buildListQuery(filters);
    const [items, count] = await Promise.all([
      executeQuery(SalesOpportunityModel.find(query), {
        sort: { updatedAt: -1, createdAt: -1 },
        skip: (page - 1) * limit,
        limit,
        populate: [
          { path: "leadId", select: "leadReference fullName email phone status source" },
          { path: "customerId", select: "fullName email phone crmCustomerNumber lifecycleStage" }
        ]
      }),
      typeof SalesOpportunityModel.countDocuments === "function"
        ? SalesOpportunityModel.countDocuments(query)
        : Promise.resolve(0)
    ]);

    const formatted = (items || []).map(summarizeOpportunity);
    if (!withMeta) return formatted;
    return {
      items: formatted,
      count,
      page,
      limit,
      filters: {
        search: filters.search || "",
        stage: filters.stage || "",
        source: filters.source || "",
        assignedTo: filters.assignedTo || "",
        leadId: filters.leadId || "",
        customerId: filters.customerId || "",
        openOnly: Boolean(filters.openOnly)
      }
    };
  };

  const createOpportunity = async ({ payload = {}, auth = {}, requestId = "" } = {}) => {
    let lead = null;
    if (payload.leadId) {
      lead = await LeadModel.findById(payload.leadId);
      if (!lead) {
        throw new AppError("Lead not found", 404, "CRM_LEAD_NOT_FOUND");
      }
      const existing = await executeQuery(SalesOpportunityModel.findOne({ leadId: payload.leadId }));
      if (existing) {
        await recordAudit({
          action: "crm_opportunity_duplicate_prevented",
          entityId: idOf(existing),
          after: summarizeOpportunity(existing),
          auth,
          requestId,
          metadata: { leadId: payload.leadId }
        });
        return {
          action: "existing",
          opportunity: summarizeOpportunity(existing)
        };
      }
    }

    const patch = buildOpportunityPatch(payload, auth, { lead });
    validateOpportunityPatch(patch);
    const wonEvidence = await applyWonBookingEvidence(patch);
    const opportunity = await SalesOpportunityModel.create({
      ...patch,
      opportunityNumber: payload.opportunityNumber || buildOpportunityNumber(),
      stageChangedAt: now(),
      lastStageChangeBy: actorSnapshot(auth),
      wonAt: patch.stage === CRM_OPPORTUNITY_STAGE.WON ? now() : null,
      lostAt: patch.stage === CRM_OPPORTUNITY_STAGE.LOST ? now() : null,
      createdBy: actorSnapshot(auth),
      updatedBy: actorSnapshot(auth)
    });
    const plainOpportunity = summarizeOpportunity(opportunity);

    if (lead && [CRM_LEAD_STATUS.NEW, CRM_LEAD_STATUS.CONTACTED].includes(lead.status)) {
      lead.status = CRM_LEAD_STATUS.QUALIFIED;
      lead.updatedBy = actorSnapshot(auth);
      await lead.save();
    }

    await recordAudit({
      action: payload.leadId ? "crm_lead_converted_to_opportunity" : "crm_opportunity_created",
      entityId: plainOpportunity.id,
      after: plainOpportunity,
      auth,
      requestId,
      metadata: {
        leadId: idOf(plainOpportunity.leadId),
        customerId: idOf(plainOpportunity.customerId),
        pipelineValueIsForecastOnly: true,
        wonRequiresConfirmedBokunBooking: patch.stage === CRM_OPPORTUNITY_STAGE.WON,
        wonBokunBookingId: wonEvidence?.bokunBookingId || ""
      }
    });

    if (payload.leadId) {
      await createTimelineEvent({
        opportunity: plainOpportunity,
        eventType: CUSTOMER_TIMELINE_EVENT_TYPE.LEAD_CONVERTED_TO_OPPORTUNITY,
        summary: "CRM lead converted to a sales opportunity.",
        auth,
        requestId
      });
    }

    return {
      action: "created",
      opportunity: plainOpportunity
    };
  };

  const updateOpportunity = async ({ opportunityId, payload = {}, auth = {}, requestId = "" } = {}) => {
    const opportunity = await SalesOpportunityModel.findById(opportunityId);
    if (!opportunity) {
      throw new AppError("Opportunity not found", 404, "CRM_OPPORTUNITY_NOT_FOUND");
    }

    const before = summarizeOpportunity(opportunity);
    const stageChanged = payload.stage && payload.stage !== before.stage;
    const mergedPayload = {
      ...before,
      ...payload,
      assignedTo: payload.assignedTo || before.assignedTo || {},
      interestedProducts: payload.interestedProducts || before.interestedProducts || [],
      externalReferences: payload.externalReferences || before.externalReferences || [],
      probability: payload.probability ?? (stageChanged ? undefined : before.probability)
    };
    const patch = buildOpportunityPatch(mergedPayload, auth, { previousStage: before.stage });
    validateOpportunityPatch(patch);
    const wonEvidence = await applyWonBookingEvidence(patch);

    Object.assign(opportunity, patch, { updatedBy: actorSnapshot(auth) });
    if (stageChanged) {
      opportunity.stageChangedAt = now();
      opportunity.lastStageChangeBy = actorSnapshot(auth);
    }
    if (patch.stage === CRM_OPPORTUNITY_STAGE.WON && !opportunity.wonAt) opportunity.wonAt = now();
    if (patch.stage === CRM_OPPORTUNITY_STAGE.LOST && !opportunity.lostAt) opportunity.lostAt = now();
    if (patch.stage !== CRM_OPPORTUNITY_STAGE.WON) {
      opportunity.wonAt = null;
      opportunity.wonBookingId = null;
      opportunity.wonBokunBookingId = "";
    }
    if (patch.stage !== CRM_OPPORTUNITY_STAGE.LOST) {
      opportunity.lostAt = null;
      opportunity.lostReason = "";
      opportunity.lostReasonNote = "";
    }

    await opportunity.save();
    const after = summarizeOpportunity(opportunity);

    await recordAudit({
      action: stageChanged ? "crm_opportunity_stage_changed" : "crm_opportunity_updated",
      entityId: opportunityId,
      before,
      after,
      auth,
      requestId,
      metadata: {
        fromStage: before.stage,
        toStage: after.stage,
        pipelineValueIsForecastOnly: true,
        wonRequiresConfirmedBokunBooking: patch.stage === CRM_OPPORTUNITY_STAGE.WON,
        wonBokunBookingId: wonEvidence?.bokunBookingId || ""
      }
    });

    if (stageChanged) {
      await createTimelineEvent({
        opportunity: after,
        eventType: CUSTOMER_TIMELINE_EVENT_TYPE.OPPORTUNITY_STAGE_CHANGED,
        summary: `Opportunity stage changed from ${before.stage} to ${after.stage}.`,
        auth,
        requestId
      });
    }

    return {
      action: "updated",
      opportunity: after
    };
  };

  const convertLeadToOpportunity = async ({ leadId, payload = {}, auth = {}, requestId = "" } = {}) =>
    createOpportunity({
      payload: {
        ...payload,
        leadId
      },
      auth,
      requestId
    });

  const getOpportunityDashboardMetrics = async () => {
    const [
      opportunityCount,
      openOpportunityCount,
      wonOpportunityCount,
      lostOpportunityCount,
      stageBreakdown,
      pipelineByCurrency
    ] = await Promise.all([
      typeof SalesOpportunityModel.countDocuments === "function"
        ? SalesOpportunityModel.countDocuments({})
        : Promise.resolve(0),
      typeof SalesOpportunityModel.countDocuments === "function"
        ? SalesOpportunityModel.countDocuments({ stage: OPEN_STAGE_QUERY })
        : Promise.resolve(0),
      typeof SalesOpportunityModel.countDocuments === "function"
        ? SalesOpportunityModel.countDocuments({ stage: CRM_OPPORTUNITY_STAGE.WON })
        : Promise.resolve(0),
      typeof SalesOpportunityModel.countDocuments === "function"
        ? SalesOpportunityModel.countDocuments({ stage: CRM_OPPORTUNITY_STAGE.LOST })
        : Promise.resolve(0),
      typeof SalesOpportunityModel.aggregate === "function"
        ? SalesOpportunityModel.aggregate([{ $group: { _id: "$stage", count: { $sum: 1 } } }, { $sort: { count: -1 } }])
        : Promise.resolve([]),
      typeof SalesOpportunityModel.aggregate === "function"
        ? SalesOpportunityModel.aggregate([
            { $match: { stage: OPEN_STAGE_QUERY } },
            {
              $group: {
                _id: "$currency",
                openPipelineValue: { $sum: "$estimatedValue" },
                weightedPipelineValue: {
                  $sum: { $multiply: ["$estimatedValue", { $divide: ["$probability", 100] }] }
                }
              }
            }
          ])
        : Promise.resolve([])
    ]);

    const totals = (pipelineByCurrency || []).reduce(
      (acc, row) => ({
        openPipelineValue: acc.openPipelineValue + Number(row.openPipelineValue || 0),
        weightedPipelineValue: acc.weightedPipelineValue + Number(row.weightedPipelineValue || 0)
      }),
      { openPipelineValue: 0, weightedPipelineValue: 0 }
    );

    return {
      opportunityCount,
      openOpportunityCount,
      wonOpportunityCount,
      lostOpportunityCount,
      openPipelineValue: Number(totals.openPipelineValue.toFixed(2)),
      weightedPipelineValue: Number(totals.weightedPipelineValue.toFixed(2)),
      pipelineByCurrency: pipelineByCurrency || [],
      opportunityStageBreakdown: stageBreakdown || []
    };
  };

  const getSalesPipeline = async (filters = {}) => {
    const includeClosed = filters.includeClosed !== false;
    const limitPerStage = Math.min(Math.max(Number(filters.limitPerStage || 20), 1), 50);
    const stages = includeClosed ? PIPELINE_STAGE_ORDER : PIPELINE_STAGE_ORDER.filter((stage) => !TERMINAL_STAGES.includes(stage));
    const match = {};
    if (!includeClosed) match.stage = OPEN_STAGE_QUERY;
    if (filters.assignedTo) match["assignedTo.id"] = cleanText(filters.assignedTo, 120);
    if (filters.source) match.source = filters.source;
    if (filters.currency) match.currency = normalizeCurrency(filters.currency);

    const rollup = typeof SalesOpportunityModel.aggregate === "function"
      ? await SalesOpportunityModel.aggregate([
          { $match: match },
          {
            $group: {
              _id: "$stage",
              count: { $sum: 1 },
              totalEstimatedValue: { $sum: { $ifNull: ["$estimatedValue", 0] } },
              weightedValue: {
                $sum: {
                  $multiply: [
                    { $ifNull: ["$estimatedValue", 0] },
                    { $divide: [{ $ifNull: ["$probability", 0] }, 100] }
                  ]
                }
              }
            }
          }
        ])
      : [];

    const itemsByStage = await Promise.all(
      stages.map((stage) =>
        executeQuery(SalesOpportunityModel.find({ ...match, stage }), {
          sort: { updatedAt: -1, createdAt: -1 },
          limit: limitPerStage,
          populate: [
            { path: "leadId", select: "leadReference fullName email phone status source" },
            { path: "customerId", select: "fullName email phone crmCustomerNumber lifecycleStage" }
          ]
        })
      )
    );

    const rollupByStage = new Map((rollup || []).map((row) => [row._id || CRM_OPPORTUNITY_STAGE.NEW, row]));
    const columns = stages.map((stage, index) => {
      const stageRollup = rollupByStage.get(stage) || {};
      const items = (itemsByStage[index] || []).map(summarizeOpportunity);
      return {
        stage,
        label: stageLabel(stage),
        isTerminal: TERMINAL_STAGES.includes(stage),
        count: Number(stageRollup.count || 0),
        totalEstimatedValue: Number(Number(stageRollup.totalEstimatedValue || 0).toFixed(2)),
        weightedValue: Number(Number(stageRollup.weightedValue || 0).toFixed(2)),
        items
      };
    });

    const totals = columns.reduce(
      (acc, column) => ({
        count: acc.count + column.count,
        openCount: acc.openCount + (column.isTerminal ? 0 : column.count),
        totalEstimatedValue: acc.totalEstimatedValue + column.totalEstimatedValue,
        weightedValue: acc.weightedValue + column.weightedValue
      }),
      { count: 0, openCount: 0, totalEstimatedValue: 0, weightedValue: 0 }
    );

    return {
      stageOrder: stages,
      columns,
      totals: {
        ...totals,
        totalEstimatedValue: Number(totals.totalEstimatedValue.toFixed(2)),
        weightedValue: Number(totals.weightedValue.toFixed(2))
      },
      filters: {
        includeClosed,
        limitPerStage,
        assignedTo: filters.assignedTo || "",
        source: filters.source || "",
        currency: filters.currency || ""
      },
      pipelineValueIsForecastOnly: true,
      actualRevenueSource: "Booking Accounting after Bokun confirmed booking"
    };
  };

  return {
    convertLeadToOpportunity,
    createOpportunity,
    getOpportunity,
    getOpportunityDashboardMetrics,
    getSalesPipeline,
    listOpportunities,
    updateOpportunity
  };
};

const service = createCrmOpportunityService();

module.exports = {
  ...service,
  createCrmOpportunityService,
  __testables: {
    buildListQuery,
    buildOpportunityPatch,
    normalizeProbability,
    PIPELINE_STAGE_ORDER,
    summarizeOpportunity,
    validateOpportunityPatch
  }
};
