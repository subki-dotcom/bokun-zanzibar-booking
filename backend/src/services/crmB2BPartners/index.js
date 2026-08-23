const crypto = require("crypto");
const B2BPartner = require("../../models/B2BPartner");
const AuditLog = require("../../models/AuditLog");
const AppError = require("../../utils/AppError");
const {
  CRM_B2B_COMMISSION_MODEL,
  CRM_B2B_NET_RATE_MODEL,
  CRM_B2B_PARTNER_STATUS,
  CRM_B2B_PARTNER_TYPE
} = require("../../crm/constants");

const OPEN_B2B_STATUSES = Object.freeze([
  CRM_B2B_PARTNER_STATUS.PROSPECT,
  CRM_B2B_PARTNER_STATUS.CONTACTED,
  CRM_B2B_PARTNER_STATUS.PROPOSAL_SENT,
  CRM_B2B_PARTNER_STATUS.NEGOTIATION,
  CRM_B2B_PARTNER_STATUS.AGREEMENT
]);

const cleanText = (value = "", maxLength = 240) => String(value || "").trim().slice(0, maxLength);
const normalizeEmail = (value = "") => cleanText(value, 240).toLowerCase();
const normalizePhone = (value = "") => {
  const text = cleanText(value, 80);
  if (!text) return "";
  const prefix = text.startsWith("+") ? "+" : "";
  const digits = text.replace(/[^\d]/g, "");
  return digits ? `${prefix}${digits}` : "";
};
const normalizeCompany = (value = "") => cleanText(value, 180).toLowerCase();
const idOf = (value) => String(value?._id || value?.id || value || "");
const toPlain = (value) => {
  if (!value) return value;
  if (typeof value.toObject === "function") return value.toObject();
  return value;
};
const escapeRegExp = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const money = (value = 0) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
};
const actorSnapshot = (auth = {}) => ({
  id: cleanText(auth.id || auth.userId || "", 120),
  role: cleanText(auth.role || "system", 80),
  email: cleanText(auth.email || "", 160),
  name: cleanText(auth.name || "", 160)
});
const buildPartnerNumber = () =>
  `B2B-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;

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

const summarizePartner = (partner = {}) => {
  const plain = toPlain(partner) || {};
  return {
    _id: plain._id,
    id: idOf(plain),
    partnerNumber: plain.partnerNumber || "",
    partnerType: plain.partnerType || CRM_B2B_PARTNER_TYPE.B2B_PARTNER,
    companyName: plain.companyName || "",
    companyNameNormalized: plain.companyNameNormalized || normalizeCompany(plain.companyName),
    contactPerson: plain.contactPerson || "",
    email: plain.email || "",
    emailNormalized: plain.emailNormalized || normalizeEmail(plain.email),
    phone: plain.phone || "",
    phoneNormalized: plain.phoneNormalized || normalizePhone(plain.phone),
    country: plain.country || "",
    commissionModel: plain.commissionModel || CRM_B2B_COMMISSION_MODEL.NONE,
    commissionRate: money(plain.commissionRate),
    fixedCommissionAmount: money(plain.fixedCommissionAmount),
    netRateModel: plain.netRateModel || CRM_B2B_NET_RATE_MODEL.NONE,
    creditLimit: money(plain.creditLimit),
    currency: cleanText(plain.currency || "USD", 3).toUpperCase() || "USD",
    paymentTerms: plain.paymentTerms || "",
    assignedManager: plain.assignedManager || {},
    status: plain.status || CRM_B2B_PARTNER_STATUS.PROSPECT,
    statusChangedAt: plain.statusChangedAt || null,
    linkedAgentId: plain.linkedAgentId || null,
    notes: plain.notes || "",
    externalReferences: plain.externalReferences || [],
    accountingIntegration: {
      postsLedgerEntries: false,
      note: "CRM B2B partner records do not create accounting postings."
    },
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null
  };
};

const buildPartnerPatch = (payload = {}, auth = {}, { previousStatus = "" } = {}) => {
  const status = Object.values(CRM_B2B_PARTNER_STATUS).includes(payload.status)
    ? payload.status
    : previousStatus || CRM_B2B_PARTNER_STATUS.PROSPECT;
  return {
    partnerType: Object.values(CRM_B2B_PARTNER_TYPE).includes(payload.partnerType)
      ? payload.partnerType
      : CRM_B2B_PARTNER_TYPE.B2B_PARTNER,
    companyName: cleanText(payload.companyName, 180),
    companyNameNormalized: normalizeCompany(payload.companyName),
    contactPerson: cleanText(payload.contactPerson, 180),
    email: normalizeEmail(payload.email),
    emailNormalized: normalizeEmail(payload.email),
    phone: cleanText(payload.phone, 80),
    phoneNormalized: normalizePhone(payload.phone),
    country: cleanText(payload.country, 80),
    commissionModel: Object.values(CRM_B2B_COMMISSION_MODEL).includes(payload.commissionModel)
      ? payload.commissionModel
      : CRM_B2B_COMMISSION_MODEL.NONE,
    commissionRate: Math.min(Math.max(Number(payload.commissionRate || 0), 0), 100),
    fixedCommissionAmount: Math.max(Number(payload.fixedCommissionAmount || 0), 0),
    netRateModel: Object.values(CRM_B2B_NET_RATE_MODEL).includes(payload.netRateModel)
      ? payload.netRateModel
      : CRM_B2B_NET_RATE_MODEL.NONE,
    creditLimit: Math.max(Number(payload.creditLimit || 0), 0),
    currency: cleanText(payload.currency || "USD", 3).toUpperCase() || "USD",
    paymentTerms: cleanText(payload.paymentTerms, 500),
    assignedManager: {
      id: cleanText(payload.assignedManager?.id, 120),
      role: cleanText(payload.assignedManager?.role, 80),
      email: cleanText(payload.assignedManager?.email, 160),
      name: cleanText(payload.assignedManager?.name, 160)
    },
    status,
    linkedAgentId: payload.linkedAgentId || null,
    notes: cleanText(payload.notes, 2000),
    externalReferences: (payload.externalReferences || [])
      .map(normalizeExternalReference)
      .filter((reference) => reference.provider && reference.reference),
    rawPayload: payload.rawPayload && typeof payload.rawPayload === "object" ? payload.rawPayload : undefined,
    updatedBy: actorSnapshot(auth)
  };
};

const validatePartnerPatch = (patch = {}) => {
  if (!patch.companyName) {
    throw new AppError("B2B partner company name is required.", 422, "CRM_B2B_COMPANY_NAME_REQUIRED");
  }
  if (!patch.contactPerson) {
    throw new AppError("B2B partner contact person is required.", 422, "CRM_B2B_CONTACT_PERSON_REQUIRED");
  }
  if (patch.commissionModel === CRM_B2B_COMMISSION_MODEL.PERCENTAGE && patch.commissionRate <= 0) {
    throw new AppError("Percentage commission requires a positive commission rate.", 422, "CRM_B2B_COMMISSION_RATE_REQUIRED");
  }
  if (patch.commissionModel === CRM_B2B_COMMISSION_MODEL.FIXED_AMOUNT && patch.fixedCommissionAmount <= 0) {
    throw new AppError("Fixed commission requires a positive fixed amount.", 422, "CRM_B2B_FIXED_COMMISSION_REQUIRED");
  }
};

const buildExactClauses = ({ emailNormalized = "", companyNameNormalized = "", country = "", externalReferences = [] } = {}) => {
  const clauses = [];
  if (emailNormalized) clauses.push({ emailNormalized });
  if (companyNameNormalized) clauses.push({ companyNameNormalized, country: cleanText(country, 80) });
  externalReferences.forEach((reference) => {
    clauses.push({
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

const buildListQuery = (filters = {}) => {
  const query = {};
  if (filters.status) query.status = filters.status;
  if (filters.partnerType) query.partnerType = filters.partnerType;
  if (filters.assignedManager) query["assignedManager.id"] = cleanText(filters.assignedManager, 120);
  if (filters.country) query.country = cleanText(filters.country, 80);
  if (filters.openOnly) query.status = { $in: OPEN_B2B_STATUSES };
  if (filters.search) {
    const regex = new RegExp(escapeRegExp(cleanText(filters.search, 160)), "i");
    query.$or = [
      { partnerNumber: regex },
      { companyName: regex },
      { contactPerson: regex },
      { email: regex },
      { phone: regex },
      { country: regex }
    ];
  }
  return query;
};

const createCrmB2BPartnerService = ({
  B2BPartnerModel = B2BPartner,
  AuditLogModel = AuditLog,
  now = () => new Date()
} = {}) => {
  const recordAudit = async ({ action, entityId, before = null, after = null, auth = {}, requestId = "", metadata = {} }) =>
    AuditLogModel.create({
      actorId: actorSnapshot(auth).id || null,
      actorRole: actorSnapshot(auth).role || "system",
      action,
      entityType: "B2BPartner",
      entityId: String(entityId || ""),
      requestId,
      before,
      after,
      metadata: {
        accountingIntegration: { postsLedgerEntries: false },
        ...metadata
      }
    });

  const listB2BPartners = async (filters = {}) => {
    const withMeta = Boolean(filters.withMeta);
    const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 500);
    const page = Math.max(Number(filters.page || 1), 1);
    const query = buildListQuery(filters);
    const [items, count] = await Promise.all([
      executeQuery(B2BPartnerModel.find(query), {
        sort: { updatedAt: -1, createdAt: -1 },
        skip: (page - 1) * limit,
        limit
      }),
      typeof B2BPartnerModel.countDocuments === "function" ? B2BPartnerModel.countDocuments(query) : Promise.resolve(0)
    ]);
    const formatted = (items || []).map(summarizePartner);
    if (!withMeta) return formatted;
    return {
      items: formatted,
      count,
      page,
      limit,
      filters: {
        search: filters.search || "",
        status: filters.status || "",
        partnerType: filters.partnerType || "",
        assignedManager: filters.assignedManager || "",
        country: filters.country || "",
        openOnly: Boolean(filters.openOnly)
      }
    };
  };

  const getB2BPartner = async (partnerId) => {
    const partner = await executeQuery(B2BPartnerModel.findById(partnerId));
    if (!partner) {
      throw new AppError("B2B partner not found", 404, "CRM_B2B_PARTNER_NOT_FOUND");
    }
    return { partner: summarizePartner(partner) };
  };

  const createB2BPartner = async ({ payload = {}, auth = {}, requestId = "" } = {}) => {
    const patch = buildPartnerPatch(payload, auth);
    validatePartnerPatch(patch);
    const exactClauses = buildExactClauses(patch);
    const exactMatch = exactClauses.length ? await executeQuery(B2BPartnerModel.findOne({ $or: exactClauses })) : null;
    if (exactMatch) {
      await recordAudit({
        action: "crm_b2b_partner_duplicate_prevented",
        entityId: idOf(exactMatch),
        after: summarizePartner(exactMatch),
        auth,
        requestId,
        metadata: { attemptedEmail: patch.emailNormalized, attemptedCompanyName: patch.companyNameNormalized }
      });
      return {
        action: "existing",
        partner: summarizePartner(exactMatch),
        accountingIntegration: { postsLedgerEntries: false }
      };
    }

    const statusChangedAt = now();
    const partner = await B2BPartnerModel.create({
      ...patch,
      partnerNumber: payload.partnerNumber || buildPartnerNumber(),
      statusChangedAt,
      lastStatusChangeBy: actorSnapshot(auth),
      createdBy: actorSnapshot(auth)
    });
    const after = summarizePartner(partner);
    await recordAudit({
      action: "crm_b2b_partner_created",
      entityId: after.id,
      after,
      auth,
      requestId,
      metadata: { status: after.status, partnerType: after.partnerType }
    });
    return {
      action: "created",
      partner: after,
      accountingIntegration: { postsLedgerEntries: false }
    };
  };

  const updateB2BPartner = async ({ partnerId, payload = {}, auth = {}, requestId = "" } = {}) => {
    const partner = await B2BPartnerModel.findById(partnerId);
    if (!partner) {
      throw new AppError("B2B partner not found", 404, "CRM_B2B_PARTNER_NOT_FOUND");
    }
    const before = summarizePartner(partner);
    const patch = {
      ...before,
      ...payload,
      externalReferences: payload.externalReferences || before.externalReferences || [],
      assignedManager: payload.assignedManager || before.assignedManager || {}
    };
    const normalizedPatch = buildPartnerPatch(patch, auth, { previousStatus: before.status });
    validatePartnerPatch(normalizedPatch);

    Object.assign(partner, normalizedPatch);
    if (normalizedPatch.status !== before.status) {
      partner.statusChangedAt = now();
      partner.lastStatusChangeBy = actorSnapshot(auth);
    }
    await partner.save();
    const after = summarizePartner(partner);
    await recordAudit({
      action: normalizedPatch.status !== before.status ? "crm_b2b_partner_status_changed" : "crm_b2b_partner_updated",
      entityId: partnerId,
      before,
      after,
      auth,
      requestId,
      metadata: {
        previousStatus: before.status,
        status: after.status,
        statusChanged: after.status !== before.status
      }
    });
    return {
      action: "updated",
      partner: after,
      accountingIntegration: { postsLedgerEntries: false }
    };
  };

  const getB2BPartnerMetrics = async () => {
    const [partnerCount, activePartnerCount, openB2BPartnerCount, statusBreakdown, typeBreakdown] = await Promise.all([
      typeof B2BPartnerModel.countDocuments === "function" ? B2BPartnerModel.countDocuments({}) : Promise.resolve(0),
      typeof B2BPartnerModel.countDocuments === "function"
        ? B2BPartnerModel.countDocuments({ status: CRM_B2B_PARTNER_STATUS.ACTIVE_PARTNER })
        : Promise.resolve(0),
      typeof B2BPartnerModel.countDocuments === "function"
        ? B2BPartnerModel.countDocuments({ status: { $in: OPEN_B2B_STATUSES } })
        : Promise.resolve(0),
      typeof B2BPartnerModel.aggregate === "function"
        ? B2BPartnerModel.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }, { $sort: { count: -1 } }])
        : Promise.resolve([]),
      typeof B2BPartnerModel.aggregate === "function"
        ? B2BPartnerModel.aggregate([{ $group: { _id: "$partnerType", count: { $sum: 1 } } }, { $sort: { count: -1 } }])
        : Promise.resolve([])
    ]);

    return {
      b2bPartnerCount: partnerCount,
      activeB2BPartnerCount: activePartnerCount,
      openB2BPartnerCount,
      b2bStatusBreakdown: statusBreakdown || [],
      b2bTypeBreakdown: typeBreakdown || [],
      b2bAccountingPostsLedgerEntries: false
    };
  };

  return {
    createB2BPartner,
    getB2BPartner,
    getB2BPartnerMetrics,
    listB2BPartners,
    updateB2BPartner
  };
};

const service = createCrmB2BPartnerService();

module.exports = {
  ...service,
  createCrmB2BPartnerService,
  __testables: {
    buildExactClauses,
    buildListQuery,
    buildPartnerPatch,
    normalizeEmail,
    normalizePhone,
    summarizePartner
  }
};
