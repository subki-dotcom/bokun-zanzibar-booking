const AuditLog = require("../../models/AuditLog");
const B2BPartner = require("../../models/B2BPartner");
const Customer = require("../../models/Customer");
const Lead = require("../../models/Lead");
const customersService = require("../customers");
const crmB2BPartnersService = require("../crmB2BPartners");
const crmLeadsService = require("../crmLeads");
const AppError = require("../../utils/AppError");
const {
  CRM_B2B_PARTNER_STATUS,
  CRM_B2B_PARTNER_TYPE,
  CRM_IMPORT_RECORD_STATUS,
  CRM_IMPORT_TYPE,
  CRM_LEAD_SOURCE,
  CRM_LEAD_STATUS
} = require("../../crm/constants");

const MAX_IMPORT_RECORDS = 500;

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
const normalizeUpperEnum = (value = "", allowed = [], fallback = "") => {
  const normalized = cleanText(value, 80).toUpperCase();
  return allowed.includes(normalized) ? normalized : fallback;
};
const toPlain = (value) => {
  if (!value) return value;
  if (typeof value.toObject === "function") return value.toObject();
  return value;
};
const idOf = (value) => cleanText(value?._id || value?.id || value, 180);
const actorSnapshot = (auth = {}) => ({
  id: cleanText(auth.id || auth.userId || "", 120),
  role: cleanText(auth.role || "system", 80),
  email: cleanText(auth.email || "", 160),
  name: cleanText(auth.name || "", 160)
});
const executeOne = async (query) => {
  if (!query) return null;
  let next = query;
  if (next && typeof next.lean === "function") next = next.lean();
  const result = next && typeof next.then === "function" ? await next : next;
  if (Array.isArray(result)) return result[0] || null;
  return toPlain(result);
};

const normalizeExternalReferences = (record = {}, { importType = "", source = "" } = {}) => {
  const references = Array.isArray(record.externalReferences) ? record.externalReferences : [];
  const normalized = references
    .map((reference = {}) => ({
      provider: cleanText(reference.provider, 80).toLowerCase(),
      reference: cleanText(reference.reference, 180),
      rawReference: cleanText(reference.rawReference || reference.reference, 180),
      metadata: reference.metadata && typeof reference.metadata === "object" ? reference.metadata : undefined
    }))
    .filter((reference) => reference.provider && reference.reference);

  const sourceReference = cleanText(
    record.importReference || record.sourceRecordId || record.externalId || record.legacyId || record.id,
    180
  );
  if (sourceReference) {
    const provider = cleanText(record.sourceSystem || record.provider || source || "crm_import", 80).toLowerCase();
    const alreadyIncluded = normalized.some(
      (reference) => reference.provider === provider && reference.reference === sourceReference
    );
    if (!alreadyIncluded) {
      normalized.push({
        provider,
        reference: sourceReference,
        rawReference: sourceReference,
        metadata: {
          importType
        }
      });
    }
  }

  return normalized;
};

const buildExternalReferenceClauses = (externalReferences = []) =>
  externalReferences.map((reference) => ({
    externalReferences: {
      $elemMatch: {
        provider: reference.provider,
        reference: reference.reference
      }
    }
  }));

const findOneByQuery = async (Model, query) => {
  if (!query || !Model || typeof Model.findOne !== "function") return null;
  return executeOne(Model.findOne(query));
};

const buildBasePlan = ({ importType, rowNumber, input = {}, normalized = {}, status, reason, warnings = [], matchEvidence = null }) => ({
  rowNumber,
  importType,
  status,
  action:
    status === CRM_IMPORT_RECORD_STATUS.CREATE
      ? "create"
      : status === CRM_IMPORT_RECORD_STATUS.SKIP_EXISTING
        ? "skip"
        : status === CRM_IMPORT_RECORD_STATUS.REVIEW_REQUIRED
          ? "manual_review"
          : "none",
  reason,
  warnings,
  normalized,
  matchEvidence,
  inputReference: cleanText(input.importReference || input.sourceRecordId || input.externalId || input.legacyId || input.id, 180)
});

const summarizeMatch = (record = {}, fields = []) => ({
  id: idOf(record),
  reference: cleanText(record.crmCustomerNumber || record.leadReference || record.partnerNumber || record.email || record.companyName, 180),
  matchedFields: fields
});

const normalizeCustomerRecord = (record = {}, context = {}) => {
  const emailNormalized = normalizeEmail(record.email);
  const phoneNormalized = normalizePhone(record.phone);
  const whatsappNormalized = normalizePhone(record.whatsappNumber || record.whatsapp);
  return {
    firstName: cleanText(record.firstName || record.givenName || record.name?.split?.(" ")?.[0], 120),
    lastName: cleanText(record.lastName || record.familyName || record.surname || record.name?.split?.(" ")?.slice(1).join(" "), 120),
    email: emailNormalized,
    emailNormalized,
    phone: cleanText(record.phone, 80),
    phoneNormalized,
    whatsappNumber: cleanText(record.whatsappNumber || record.whatsapp, 80),
    whatsappNormalized,
    country: cleanText(record.country, 80),
    source: normalizeUpperEnum(record.source, Object.values(CRM_LEAD_SOURCE), CRM_LEAD_SOURCE.OTHER),
    sourceDetails: cleanText(record.sourceDetails || context.source, 240),
    tags: Array.isArray(record.tags) ? record.tags.map((tag) => cleanText(tag, 80)).filter(Boolean) : [],
    notes: cleanText(record.notes, 2000),
    externalReferences: normalizeExternalReferences(record, context)
  };
};

const normalizeLeadRecord = (record = {}, context = {}) => {
  const emailNormalized = normalizeEmail(record.email);
  const phoneNormalized = normalizePhone(record.phone);
  const whatsappNormalized = normalizePhone(record.whatsappNumber || record.whatsapp);
  const adults = Math.max(Number(record.travelIntent?.adults ?? record.adults ?? 0), 0);
  const children = Math.max(Number(record.travelIntent?.children ?? record.children ?? 0), 0);
  const totalParticipants = Math.max(Number(record.travelIntent?.totalParticipants ?? record.totalParticipants ?? adults + children), 0);
  return {
    firstName: cleanText(record.firstName || record.givenName || record.name?.split?.(" ")?.[0], 120),
    lastName: cleanText(record.lastName || record.familyName || record.surname || record.name?.split?.(" ")?.slice(1).join(" "), 120),
    email: emailNormalized,
    emailNormalized,
    phone: cleanText(record.phone, 80),
    phoneNormalized,
    whatsappNumber: cleanText(record.whatsappNumber || record.whatsapp, 80),
    whatsappNormalized,
    source: normalizeUpperEnum(record.source, Object.values(CRM_LEAD_SOURCE), CRM_LEAD_SOURCE.OTHER),
    status: normalizeUpperEnum(record.status, Object.values(CRM_LEAD_STATUS), CRM_LEAD_STATUS.NEW),
    sourceDetails: cleanText(record.sourceDetails || context.source, 240),
    notes: cleanText(record.notes, 2000),
    tags: Array.isArray(record.tags) ? record.tags.map((tag) => cleanText(tag, 80)).filter(Boolean) : [],
    travelIntent: {
      travelDate: cleanText(record.travelIntent?.travelDate || record.travelDate, 30),
      startTime: cleanText(record.travelIntent?.startTime || record.startTime, 30),
      adults,
      children,
      totalParticipants,
      budgetAmount:
        record.travelIntent?.budgetAmount === null || record.budgetAmount === null
          ? null
          : Number(record.travelIntent?.budgetAmount ?? record.budgetAmount ?? 0),
      budgetCurrency: cleanText(record.travelIntent?.budgetCurrency || record.budgetCurrency || "USD", 3).toUpperCase() || "USD"
    },
    externalReferences: normalizeExternalReferences(record, context)
  };
};

const normalizeB2BRecord = (record = {}, context = {}) => {
  const emailNormalized = normalizeEmail(record.email);
  const phoneNormalized = normalizePhone(record.phone);
  const companyNameNormalized = normalizeCompany(record.companyName || record.company);
  return {
    partnerType: normalizeUpperEnum(record.partnerType, Object.values(CRM_B2B_PARTNER_TYPE), CRM_B2B_PARTNER_TYPE.B2B_PARTNER),
    companyName: cleanText(record.companyName || record.company, 180),
    companyNameNormalized,
    contactPerson: cleanText(record.contactPerson || record.contactName || record.name, 180),
    email: emailNormalized,
    emailNormalized,
    phone: cleanText(record.phone, 80),
    phoneNormalized,
    country: cleanText(record.country, 80),
    sourceDetails: cleanText(record.sourceDetails || context.source, 240),
    status: normalizeUpperEnum(record.status, Object.values(CRM_B2B_PARTNER_STATUS), CRM_B2B_PARTNER_STATUS.PROSPECT),
    notes: cleanText(record.notes, 2000),
    externalReferences: normalizeExternalReferences(record, context)
  };
};

const planCustomerRecord = async ({ CustomerModel, record, rowNumber, context }) => {
  const normalized = normalizeCustomerRecord(record, context);
  const missing = [];
  if (!normalized.firstName) missing.push("firstName");
  if (!normalized.lastName) missing.push("lastName");
  if (!normalized.emailNormalized) missing.push("email");
  if (missing.length) {
    return buildBasePlan({
      importType: CRM_IMPORT_TYPE.CUSTOMERS,
      rowNumber,
      input: record,
      normalized,
      status: CRM_IMPORT_RECORD_STATUS.INVALID,
      reason: `Missing required field(s): ${missing.join(", ")}.`
    });
  }

  const exactClauses = [
    { emailNormalized: normalized.emailNormalized },
    { email: normalized.emailNormalized },
    ...buildExternalReferenceClauses(normalized.externalReferences)
  ];
  const exactMatch = await findOneByQuery(CustomerModel, { $or: exactClauses });
  if (exactMatch) {
    return buildBasePlan({
      importType: CRM_IMPORT_TYPE.CUSTOMERS,
      rowNumber,
      input: record,
      normalized,
      status: CRM_IMPORT_RECORD_STATUS.SKIP_EXISTING,
      reason: "Stable customer identifier already exists.",
      matchEvidence: summarizeMatch(exactMatch, ["email/externalReference"])
    });
  }

  const possibleClauses = [];
  if (normalized.phoneNormalized) possibleClauses.push({ phoneNormalized: normalized.phoneNormalized });
  if (normalized.whatsappNormalized) possibleClauses.push({ whatsappNormalized: normalized.whatsappNormalized });
  const possibleMatch = possibleClauses.length ? await findOneByQuery(CustomerModel, { $or: possibleClauses }) : null;
  if (possibleMatch) {
    return buildBasePlan({
      importType: CRM_IMPORT_TYPE.CUSTOMERS,
      rowNumber,
      input: record,
      normalized,
      status: CRM_IMPORT_RECORD_STATUS.REVIEW_REQUIRED,
      reason: "Possible customer duplicate by phone or WhatsApp. Import does not merge automatically.",
      matchEvidence: summarizeMatch(possibleMatch, ["phone/whatsapp"])
    });
  }

  return buildBasePlan({
    importType: CRM_IMPORT_TYPE.CUSTOMERS,
    rowNumber,
    input: record,
    normalized,
    status: CRM_IMPORT_RECORD_STATUS.CREATE,
    reason: "No stable duplicate evidence found."
  });
};

const planLeadRecord = async ({ LeadModel, record, rowNumber, context }) => {
  const normalized = normalizeLeadRecord(record, context);
  const missing = [];
  if (!normalized.firstName) missing.push("firstName");
  if (!normalized.lastName) missing.push("lastName");
  if (!normalized.emailNormalized && !normalized.phoneNormalized && !normalized.whatsappNormalized) {
    missing.push("email/phone/whatsapp");
  }
  if (missing.length) {
    return buildBasePlan({
      importType: CRM_IMPORT_TYPE.HISTORICAL_LEADS,
      rowNumber,
      input: record,
      normalized,
      status: CRM_IMPORT_RECORD_STATUS.INVALID,
      reason: `Missing required field(s): ${missing.join(", ")}.`
    });
  }

  const exactClauses = [];
  if (normalized.emailNormalized) {
    exactClauses.push({
      emailNormalized: normalized.emailNormalized,
      status: { $nin: [CRM_LEAD_STATUS.CONVERTED, CRM_LEAD_STATUS.ARCHIVED] }
    });
  }
  exactClauses.push(
    ...buildExternalReferenceClauses(normalized.externalReferences).map((clause) => ({
      ...clause,
      status: { $nin: [CRM_LEAD_STATUS.CONVERTED, CRM_LEAD_STATUS.ARCHIVED] }
    }))
  );
  const exactMatch = exactClauses.length ? await findOneByQuery(LeadModel, { $or: exactClauses }) : null;
  if (exactMatch) {
    return buildBasePlan({
      importType: CRM_IMPORT_TYPE.HISTORICAL_LEADS,
      rowNumber,
      input: record,
      normalized,
      status: CRM_IMPORT_RECORD_STATUS.SKIP_EXISTING,
      reason: "Open lead with the same stable identifier already exists.",
      matchEvidence: summarizeMatch(exactMatch, ["email/externalReference"])
    });
  }

  const possibleClauses = [];
  if (normalized.phoneNormalized) possibleClauses.push({ phoneNormalized: normalized.phoneNormalized });
  if (normalized.whatsappNormalized) possibleClauses.push({ whatsappNormalized: normalized.whatsappNormalized });
  const possibleMatch = possibleClauses.length
    ? await findOneByQuery(LeadModel, {
        $or: possibleClauses.map((clause) => ({
          ...clause,
          status: { $nin: [CRM_LEAD_STATUS.CONVERTED, CRM_LEAD_STATUS.ARCHIVED] }
        }))
      })
    : null;
  if (possibleMatch) {
    return buildBasePlan({
      importType: CRM_IMPORT_TYPE.HISTORICAL_LEADS,
      rowNumber,
      input: record,
      normalized,
      status: CRM_IMPORT_RECORD_STATUS.REVIEW_REQUIRED,
      reason: "Possible lead duplicate by phone or WhatsApp. Import requires review before writing.",
      matchEvidence: summarizeMatch(possibleMatch, ["phone/whatsapp"])
    });
  }

  return buildBasePlan({
    importType: CRM_IMPORT_TYPE.HISTORICAL_LEADS,
    rowNumber,
    input: record,
    normalized,
    status: CRM_IMPORT_RECORD_STATUS.CREATE,
    reason: "No stable duplicate evidence found."
  });
};

const planB2BRecord = async ({ B2BPartnerModel, record, rowNumber, context }) => {
  const normalized = normalizeB2BRecord(record, context);
  const missing = [];
  if (!normalized.companyName) missing.push("companyName");
  if (!normalized.contactPerson) missing.push("contactPerson");
  if (!normalized.emailNormalized && !normalized.phoneNormalized && !normalized.externalReferences.length) {
    missing.push("email/phone/externalReference");
  }
  if (missing.length) {
    return buildBasePlan({
      importType: CRM_IMPORT_TYPE.B2B_CONTACTS,
      rowNumber,
      input: record,
      normalized,
      status: CRM_IMPORT_RECORD_STATUS.INVALID,
      reason: `Missing required field(s): ${missing.join(", ")}.`
    });
  }

  const exactClauses = [
    ...(normalized.emailNormalized ? [{ emailNormalized: normalized.emailNormalized }] : []),
    ...(normalized.companyNameNormalized && normalized.country
      ? [{ companyNameNormalized: normalized.companyNameNormalized, country: normalized.country }]
      : []),
    ...buildExternalReferenceClauses(normalized.externalReferences)
  ];
  const exactMatch = exactClauses.length ? await findOneByQuery(B2BPartnerModel, { $or: exactClauses }) : null;
  if (exactMatch) {
    return buildBasePlan({
      importType: CRM_IMPORT_TYPE.B2B_CONTACTS,
      rowNumber,
      input: record,
      normalized,
      status: CRM_IMPORT_RECORD_STATUS.SKIP_EXISTING,
      reason: "Stable B2B partner identifier already exists.",
      matchEvidence: summarizeMatch(exactMatch, ["email/company+country/externalReference"])
    });
  }

  const possibleClauses = [];
  if (normalized.phoneNormalized) possibleClauses.push({ phoneNormalized: normalized.phoneNormalized });
  if (normalized.companyNameNormalized) possibleClauses.push({ companyNameNormalized: normalized.companyNameNormalized });
  const possibleMatch = possibleClauses.length ? await findOneByQuery(B2BPartnerModel, { $or: possibleClauses }) : null;
  if (possibleMatch) {
    return buildBasePlan({
      importType: CRM_IMPORT_TYPE.B2B_CONTACTS,
      rowNumber,
      input: record,
      normalized,
      status: CRM_IMPORT_RECORD_STATUS.REVIEW_REQUIRED,
      reason: "Possible B2B duplicate by phone or company name. Import does not merge automatically.",
      matchEvidence: summarizeMatch(possibleMatch, ["phone/companyName"])
    });
  }

  return buildBasePlan({
    importType: CRM_IMPORT_TYPE.B2B_CONTACTS,
    rowNumber,
    input: record,
    normalized,
    status: CRM_IMPORT_RECORD_STATUS.CREATE,
    reason: "No stable duplicate evidence found."
  });
};

const buildPlan = async ({ importType, records, context, models }) => {
  const planners = {
    [CRM_IMPORT_TYPE.CUSTOMERS]: (args) => planCustomerRecord({ ...args, CustomerModel: models.CustomerModel }),
    [CRM_IMPORT_TYPE.HISTORICAL_LEADS]: (args) => planLeadRecord({ ...args, LeadModel: models.LeadModel }),
    [CRM_IMPORT_TYPE.B2B_CONTACTS]: (args) => planB2BRecord({ ...args, B2BPartnerModel: models.B2BPartnerModel })
  };
  const planner = planners[importType];
  if (!planner) {
    throw new AppError("Unsupported CRM import type.", 422, "CRM_IMPORT_TYPE_UNSUPPORTED", { importType });
  }

  const plan = [];
  for (const [index, record] of records.entries()) {
    plan.push(await planner({ record, rowNumber: index + 1, context }));
  }
  return plan;
};

const countStatuses = (plan = []) =>
  plan.reduce(
    (totals, row) => {
      totals.totalRecords += 1;
      if (row.status === CRM_IMPORT_RECORD_STATUS.CREATE) totals.createCount += 1;
      if (row.status === CRM_IMPORT_RECORD_STATUS.SKIP_EXISTING) totals.skipExistingCount += 1;
      if (row.status === CRM_IMPORT_RECORD_STATUS.REVIEW_REQUIRED) totals.reviewRequiredCount += 1;
      if (row.status === CRM_IMPORT_RECORD_STATUS.INVALID) totals.invalidCount += 1;
      return totals;
    },
    {
      totalRecords: 0,
      createCount: 0,
      skipExistingCount: 0,
      reviewRequiredCount: 0,
      invalidCount: 0
    }
  );

const createCrmImportService = ({
  AuditLogModel = AuditLog,
  B2BPartnerModel = B2BPartner,
  CustomerModel = Customer,
  LeadModel = Lead,
  customerService = customersService,
  b2bPartnerService = crmB2BPartnersService,
  leadService = crmLeadsService,
  now = () => new Date()
} = {}) => {
  const createUsingExistingService = async ({ importType, normalized, auth, requestId }) => {
    if (importType === CRM_IMPORT_TYPE.CUSTOMERS) {
      return customerService.createCustomer({ payload: normalized, auth, requestId });
    }
    if (importType === CRM_IMPORT_TYPE.HISTORICAL_LEADS) {
      return leadService.createLead({ payload: normalized, auth, requestId });
    }
    if (importType === CRM_IMPORT_TYPE.B2B_CONTACTS) {
      return b2bPartnerService.createB2BPartner({ payload: normalized, auth, requestId });
    }
    throw new AppError("Unsupported CRM import type.", 422, "CRM_IMPORT_TYPE_UNSUPPORTED", { importType });
  };

  const recordImportAudit = async ({ importType, dryRun, validation, applied, evidenceNote, auth, requestId }) => {
    if (dryRun) return null;
    return AuditLogModel.create({
      actorId: actorSnapshot(auth).id || null,
      actorRole: actorSnapshot(auth).role || "system",
      action: "crm_import_applied",
      entityType: "CRMImport",
      entityId: `${importType}:${requestId || now().toISOString()}`,
      reference: importType,
      reason: evidenceNote,
      requestId,
      after: {
        importType,
        validation,
        applied
      },
      metadata: {
        dryRun: false,
        sourceModule: "CRM_IMPORT_FOUNDATION",
        noNameOnlyMerge: true,
        reusedExistingServices: true
      }
    });
  };

  const runCrmImport = async ({
    importType,
    records = [],
    dryRun = true,
    evidenceNote = "",
    source = "",
    auth = {},
    requestId = ""
  } = {}) => {
    const normalizedImportType = normalizeUpperEnum(importType, Object.values(CRM_IMPORT_TYPE), "");
    if (!normalizedImportType) {
      throw new AppError("Unsupported CRM import type.", 422, "CRM_IMPORT_TYPE_UNSUPPORTED", { importType });
    }
    if (!Array.isArray(records) || !records.length) {
      throw new AppError("At least one CRM import record is required.", 422, "CRM_IMPORT_RECORDS_REQUIRED");
    }
    if (records.length > MAX_IMPORT_RECORDS) {
      throw new AppError("CRM import batch is too large.", 422, "CRM_IMPORT_BATCH_TOO_LARGE", {
        maxRecords: MAX_IMPORT_RECORDS
      });
    }

    const shouldDryRun = dryRun !== false;
    const context = {
      importType: normalizedImportType,
      source: cleanText(source, 120)
    };
    const plan = await buildPlan({
      importType: normalizedImportType,
      records,
      context,
      models: { B2BPartnerModel, CustomerModel, LeadModel }
    });
    const validation = countStatuses(plan);
    const blockingRows = plan.filter((row) =>
      [CRM_IMPORT_RECORD_STATUS.INVALID, CRM_IMPORT_RECORD_STATUS.REVIEW_REQUIRED].includes(row.status)
    );

    if (shouldDryRun) {
      return {
        step: "7O",
        module: "CRM_IMPORT_FOUNDATION",
        generatedAt: now().toISOString(),
        importType: normalizedImportType,
        dryRun: true,
        action: "validated",
        validation,
        plan,
        applied: {
          createdCount: 0,
          skippedCount: validation.skipExistingCount,
          failedCount: 0,
          items: []
        },
        verification: {
          dryRunZeroWrites: true,
          noNameOnlyMerge: true,
          applyRequiresEvidenceNote: true,
          existingServicesReused: true
        },
        sourceOfTruth: {
          crmSource: "Imported CRM records are pre-booking relationship data only.",
          operationalBookingSource: "Bokun confirmed bookings remain the operational booking source of truth.",
          financialSource: "Local accounting remains financial truth after confirmed bookings enter accounting."
        }
      };
    }

    const actor = actorSnapshot(auth);
    if (!actor.id && !actor.email) {
      throw new AppError("CRM import apply requires an authenticated admin actor.", 403, "CRM_IMPORT_ADMIN_ACTOR_REQUIRED");
    }
    if (cleanText(evidenceNote, 1000).length < 8) {
      throw new AppError("CRM import apply requires an evidence note.", 422, "CRM_IMPORT_EVIDENCE_NOTE_REQUIRED");
    }
    if (blockingRows.length) {
      throw new AppError("CRM import apply requires a clean validation plan.", 422, "CRM_IMPORT_VALIDATION_FAILED", {
        blockingRows: blockingRows.map((row) => ({
          rowNumber: row.rowNumber,
          status: row.status,
          reason: row.reason,
          matchEvidence: row.matchEvidence
        }))
      });
    }

    const appliedItems = [];
    for (const row of plan) {
      if (row.status === CRM_IMPORT_RECORD_STATUS.SKIP_EXISTING) {
        appliedItems.push({
          rowNumber: row.rowNumber,
          status: CRM_IMPORT_RECORD_STATUS.SKIP_EXISTING,
          action: "skipped",
          reason: row.reason,
          matchEvidence: row.matchEvidence
        });
        continue;
      }

      try {
        const result = await createUsingExistingService({
          importType: normalizedImportType,
          normalized: row.normalized,
          auth,
          requestId
        });
        appliedItems.push({
          rowNumber: row.rowNumber,
          status: result.action === "existing" ? CRM_IMPORT_RECORD_STATUS.SKIP_EXISTING : CRM_IMPORT_RECORD_STATUS.APPLIED,
          action: result.action,
          id:
            idOf(result.customer?.id || result.customer?._id) ||
            idOf(result.lead?.id || result.lead?._id) ||
            idOf(result.partner?.id || result.partner?._id),
          reference:
            result.customer?.crmCustomerNumber ||
            result.lead?.leadReference ||
            result.partner?.partnerNumber ||
            ""
        });
      } catch (error) {
        appliedItems.push({
          rowNumber: row.rowNumber,
          status: CRM_IMPORT_RECORD_STATUS.FAILED,
          action: "failed",
          reason: error.code || error.message || "CRM import create failed."
        });
      }
    }

    const applied = {
      createdCount: appliedItems.filter((item) => item.status === CRM_IMPORT_RECORD_STATUS.APPLIED).length,
      skippedCount: appliedItems.filter((item) => item.status === CRM_IMPORT_RECORD_STATUS.SKIP_EXISTING).length,
      failedCount: appliedItems.filter((item) => item.status === CRM_IMPORT_RECORD_STATUS.FAILED).length,
      items: appliedItems
    };

    if (applied.failedCount) {
      throw new AppError("CRM import apply failed for one or more records.", 500, "CRM_IMPORT_APPLY_FAILED", {
        applied
      });
    }

    await recordImportAudit({
      importType: normalizedImportType,
      dryRun: false,
      validation,
      applied,
      evidenceNote: cleanText(evidenceNote, 1000),
      auth,
      requestId
    });

    return {
      step: "7O",
      module: "CRM_IMPORT_FOUNDATION",
      generatedAt: now().toISOString(),
      importType: normalizedImportType,
      dryRun: false,
      action: "applied",
      validation,
      plan,
      applied,
      verification: {
        dryRunZeroWrites: false,
        noNameOnlyMerge: true,
        applyRequiresEvidenceNote: true,
        existingServicesReused: true,
        audited: true
      },
      sourceOfTruth: {
        crmSource: "Imported CRM records are pre-booking relationship data only.",
        operationalBookingSource: "Bokun confirmed bookings remain the operational booking source of truth.",
        financialSource: "Local accounting remains financial truth after confirmed bookings enter accounting."
      }
    };
  };

  return {
    runCrmImport
  };
};

const service = createCrmImportService();

module.exports = {
  ...service,
  createCrmImportService,
  __testables: {
    normalizeB2BRecord,
    normalizeCustomerRecord,
    normalizeLeadRecord
  }
};
