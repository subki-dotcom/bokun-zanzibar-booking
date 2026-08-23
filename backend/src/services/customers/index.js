const crypto = require("crypto");
const Customer = require("../../models/Customer");
const Booking = require("../../models/Booking");
const Payment = require("../../models/Payment");
const Invoice = require("../../models/Invoice");
const Refund = require("../../models/Refund");
const AuditLog = require("../../models/AuditLog");
const CustomerDuplicateCandidate = require("../../models/CustomerDuplicateCandidate");
const CustomerTimelineEvent = require("../../models/CustomerTimelineEvent");
const AppError = require("../../utils/AppError");
const {
  CRM_COMMUNICATION_CHANNEL,
  CRM_COMMUNICATION_DIRECTION,
  CRM_COMMUNICATION_STATUS,
  CUSTOMER_DUPLICATE_STATUS,
  CUSTOMER_LIFECYCLE_STAGE,
  CUSTOMER_SEGMENT,
  CUSTOMER_TIMELINE_EVENT_TYPE,
  DUPLICATE_CANDIDATE_STATUS
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
const normalizeExternalReference = (reference = {}) => ({
  provider: cleanText(reference.provider, 80).toLowerCase(),
  reference: cleanText(reference.reference, 180),
  rawReference: cleanText(reference.rawReference || reference.reference, 180),
  metadata: reference.metadata && typeof reference.metadata === "object" ? reference.metadata : undefined
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
const normalizeDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const toPlain = (value) => {
  if (!value) return value;
  if (typeof value.toObject === "function") return value.toObject();
  return value;
};
const idOf = (value) => String(value?._id || value?.id || value || "");
const money = (value = 0) => Number(Number(value || 0).toFixed(2));
const decimalToNumber = (value = 0) => {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "object" && typeof value.toString === "function") return Number(value.toString() || 0);
  return Number(value || 0);
};
const escapeRegExp = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sensitiveMetadataKeyPattern = /secret|token|password|authorization|bearer|card|cvv|pan|apikey|api_key|privatekey|private_key/i;
const sensitiveMetadataValuePattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/i;

const sanitizeMetadata = (value, depth = 0) => {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sensitiveMetadataValuePattern.test(value) ? "[redacted]" : cleanText(value, 1000);
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= 5) return "[redacted_nested]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeMetadata(item, depth + 1));

  return Object.entries(value).reduce((acc, [key, item]) => {
    const safeKey = cleanText(key, 120);
    acc[safeKey] = sensitiveMetadataKeyPattern.test(safeKey) ? "[redacted]" : sanitizeMetadata(item, depth + 1);
    return acc;
  }, {});
};

const executeQuery = async (query, { sort, limit, skip, populate } = {}) => {
  let next = query;
  if (next && populate && typeof next.populate === "function") next = next.populate(populate);
  if (next && sort && typeof next.sort === "function") next = next.sort(sort);
  if (next && Number.isFinite(skip) && typeof next.skip === "function") next = next.skip(skip);
  if (next && Number.isFinite(limit) && typeof next.limit === "function") next = next.limit(limit);
  if (next && typeof next.lean === "function") next = next.lean();
  return next && typeof next.then === "function" ? next : Promise.resolve(next);
};

const actorSnapshot = (auth = {}) => ({
  id: cleanText(auth.id || auth.userId || "", 120),
  role: cleanText(auth.role || "system", 80),
  email: cleanText(auth.email || "", 160)
});

const buildCustomerNumber = () =>
  `CUS-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;

const buildCustomerPatch = (payload = {}, auth = {}) => {
  const emailNormalized = normalizeEmail(payload.email);
  const phoneNormalized = normalizePhone(payload.phone);
  const whatsappNormalized = normalizePhone(payload.whatsappNumber || payload.whatsapp);
  const tags = dedupeTags(payload.tags || []);
  const tagsNormalized = [...new Set(tags.map(normalizeTag).filter(Boolean))];
  const segments = [...new Set((payload.segments || []).filter((segment) => Object.values(CUSTOMER_SEGMENT).includes(segment)))];
  const manualSegments = [
    ...new Set((payload.manualSegments || []).filter((segment) => Object.values(CUSTOMER_SEGMENT).includes(segment)))
  ];
  const externalReferences = (payload.externalReferences || [])
    .map(normalizeExternalReference)
    .filter((reference) => reference.provider && reference.reference);

  return {
    firstName: cleanText(payload.firstName, 120),
    lastName: cleanText(payload.lastName, 120),
    email: emailNormalized,
    emailNormalized,
    phone: cleanText(payload.phone, 80),
    phoneNormalized,
    whatsappNumber: cleanText(payload.whatsappNumber || payload.whatsapp, 80),
    whatsappNormalized,
    country: cleanText(payload.country, 80),
    hotelName: cleanText(payload.hotelName, 160),
    pickupPlaceId: cleanText(payload.pickupPlaceId, 160),
    notes: cleanText(payload.notes, 2000),
    lifecycleStage: Object.values(CUSTOMER_LIFECYCLE_STAGE).includes(payload.lifecycleStage)
      ? payload.lifecycleStage
      : CUSTOMER_LIFECYCLE_STAGE.PROSPECT,
    segments,
    manualSegments,
    tags,
    tagsNormalized,
    source: payload.source,
    sourceDetails: cleanText(payload.sourceDetails, 240),
    preferredContactChannel: ["EMAIL", "PHONE", "WHATSAPP"].includes(payload.preferredContactChannel)
      ? payload.preferredContactChannel
      : "",
    externalReferences,
    updatedBy: actorSnapshot(auth),
    dataQuality: {
      hasEmail: Boolean(emailNormalized),
      hasPhone: Boolean(phoneNormalized),
      hasWhatsApp: Boolean(whatsappNormalized),
      reviewedAt: normalizeDate(payload.dataQuality?.reviewedAt),
      reviewNote: cleanText(payload.dataQuality?.reviewNote, 500)
    }
  };
};

const summarizeCustomer = (customer = {}) => {
  const plain = toPlain(customer) || {};
  return {
    _id: plain._id,
    id: idOf(plain),
    crmCustomerNumber: plain.crmCustomerNumber || "",
    firstName: plain.firstName || "",
    lastName: plain.lastName || "",
    fullName: plain.fullName || `${plain.firstName || ""} ${plain.lastName || ""}`.trim(),
    email: plain.email || "",
    emailNormalized: plain.emailNormalized || normalizeEmail(plain.email),
    phone: plain.phone || "",
    phoneNormalized: plain.phoneNormalized || normalizePhone(plain.phone),
    whatsappNumber: plain.whatsappNumber || "",
    whatsappNormalized: plain.whatsappNormalized || normalizePhone(plain.whatsappNumber),
    country: plain.country || "",
    hotelName: plain.hotelName || "",
    notes: plain.notes || "",
    lifecycleStage: plain.lifecycleStage || CUSTOMER_LIFECYCLE_STAGE.PROSPECT,
    segments: plain.segments || [],
    manualSegments: plain.manualSegments || [],
    tags: plain.tags || [],
    source: plain.source || "",
    sourceDetails: plain.sourceDetails || "",
    preferredContactChannel: plain.preferredContactChannel || "",
    externalReferences: plain.externalReferences || [],
    deduplicationStatus: plain.deduplicationStatus || CUSTOMER_DUPLICATE_STATUS.CLEAN,
    possibleDuplicateOf: plain.possibleDuplicateOf || null,
    possibleDuplicateReasons: plain.possibleDuplicateReasons || [],
    lastCrmActivityAt: plain.lastCrmActivityAt || null,
    bookingCount: Array.isArray(plain.bookings) ? plain.bookings.length : 0,
    bookings: plain.bookings || [],
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null
  };
};

const normalizeCommunication = (communication = {}) => {
  const channel = Object.values(CRM_COMMUNICATION_CHANNEL).includes(communication.channel)
    ? communication.channel
    : CRM_COMMUNICATION_CHANNEL.OTHER;
  const direction = Object.values(CRM_COMMUNICATION_DIRECTION).includes(communication.direction)
    ? communication.direction
    : CRM_COMMUNICATION_DIRECTION.OUTBOUND;
  return {
    channel,
    direction,
    status: Object.values(CRM_COMMUNICATION_STATUS).includes(communication.status)
      ? communication.status
      : CRM_COMMUNICATION_STATUS.MANUAL_LOGGED,
    subject: cleanText(communication.subject, 240),
    bodyPreview: cleanText(communication.bodyPreview, 1000)
  };
};

const summarizeTimelineEvent = (event = {}) => {
  const plain = toPlain(event) || {};
  const metadata = sanitizeMetadata(plain.metadata || {});
  return {
    ...plain,
    id: idOf(plain),
    metadata,
    communication: plain.communication ? normalizeCommunication(plain.communication) : undefined,
    isManualCommunication: Boolean(metadata?.manualEntry || plain.communication?.status === CRM_COMMUNICATION_STATUS.MANUAL_LOGGED),
    deliveryStatusIsProviderVerified: Boolean(metadata?.deliveryStatusIsProviderVerified)
  };
};

const buildExactCustomerClauses = ({ emailNormalized = "", externalReferences = [] } = {}) => {
  const clauses = [];
  if (emailNormalized) {
    clauses.push({ emailNormalized });
    clauses.push({ email: emailNormalized });
  }
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

const buildPossibleDuplicateClauses = ({ phoneNormalized = "", whatsappNormalized = "" } = {}) => {
  const clauses = [];
  if (phoneNormalized) clauses.push({ phoneNormalized });
  if (whatsappNormalized) clauses.push({ whatsappNormalized });
  return clauses;
};

const resolveDuplicateMatchFields = (left = {}, right = {}) => {
  const fields = [];
  if (left.emailNormalized && left.emailNormalized === (right.emailNormalized || normalizeEmail(right.email))) {
    fields.push("email");
  }
  if (left.phoneNormalized && left.phoneNormalized === (right.phoneNormalized || normalizePhone(right.phone))) {
    fields.push("phone");
  }
  if (
    left.whatsappNormalized &&
    left.whatsappNormalized === (right.whatsappNormalized || normalizePhone(right.whatsappNumber))
  ) {
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

const buildCandidateKey = (leftId, rightId, matchFields = []) => {
  const ids = [String(leftId), String(rightId)].sort();
  return `${ids.join(":")}:${[...matchFields].sort().join("|") || "identifier"}`;
};

const createCustomerService = ({
  CustomerModel = Customer,
  BookingModel = Booking,
  PaymentModel = Payment,
  InvoiceModel = Invoice,
  RefundModel = Refund,
  AuditLogModel = AuditLog,
  CustomerDuplicateCandidateModel = CustomerDuplicateCandidate,
  CustomerTimelineEventModel = CustomerTimelineEvent,
  now = () => new Date()
} = {}) => {
  const recordAudit = async ({ action, entityId, before = null, after = null, auth = {}, requestId = "", metadata = {} }) => {
    await AuditLogModel.create({
      actorId: actorSnapshot(auth).id || null,
      actorRole: actorSnapshot(auth).role || "system",
      action,
      entityType: "Customer",
      entityId: String(entityId || ""),
      requestId,
      before,
      after,
      metadata
    });
  };

  const recordTimeline = async ({
    customerId,
    eventType,
    summary,
    sourceModule = "CRM",
    sourceEntityType = "",
    sourceEntityId = "",
    reference = "",
    occurredAt = now(),
    communication,
    sensitive = false,
    auth = {},
    requestId = "",
    metadata = {}
  }) => {
    if (!customerId || !eventType || !summary) return null;
    const event = await CustomerTimelineEventModel.create({
      customerId,
      eventType,
      sourceModule,
      sourceEntityType,
      sourceEntityId,
      reference,
      summary,
      occurredAt: normalizeDate(occurredAt) || now(),
      actor: actorSnapshot(auth),
      communication: communication ? normalizeCommunication(communication) : undefined,
      sensitive: Boolean(sensitive),
      metadata: sanitizeMetadata({
        requestId,
        ...metadata
      })
    });
    return summarizeTimelineEvent(event);
  };

  const createDuplicateCandidate = async ({ primaryCustomer, duplicateCustomer, matchFields, auth = {}, requestId = "" }) => {
    const primaryId = idOf(primaryCustomer);
    const duplicateId = idOf(duplicateCustomer);
    if (!primaryId || !duplicateId || primaryId === duplicateId) return null;

    const candidatePayload = {
      primaryCustomerId: primaryId,
      duplicateCustomerId: duplicateId,
      candidateKey: buildCandidateKey(primaryId, duplicateId, matchFields),
      matchFields,
      confidence: matchFields.includes("email") || matchFields.some((field) => field.startsWith("external:")) ? 0.95 : 0.7,
      status: DUPLICATE_CANDIDATE_STATUS.OPEN,
      reasons: matchFields.map((field) => `Matched by ${field}`),
      metadata: {
        detectedBy: "crm.customer_master",
        requestId
      }
    };

    try {
      const candidate = await CustomerDuplicateCandidateModel.create(candidatePayload);
      await recordTimeline({
        customerId: duplicateId,
        eventType: CUSTOMER_TIMELINE_EVENT_TYPE.POSSIBLE_DUPLICATE_FLAGGED,
        summary: "Possible duplicate customer flagged for review.",
        sourceEntityType: "CustomerDuplicateCandidate",
        sourceEntityId: idOf(candidate),
        auth,
        requestId,
        metadata: { primaryCustomerId: primaryId, matchFields }
      });
      return toPlain(candidate);
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const existing = await executeQuery(
        CustomerDuplicateCandidateModel.findOne({
          primaryCustomerId: primaryId,
          duplicateCustomerId: duplicateId
        })
      );
      return existing;
    }
  };

  const listCustomers = async (filters = {}) => {
    const withMeta = Boolean(filters.withMeta);
    const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 500);
    const page = Math.max(Number(filters.page || 1), 1);
    const query = {};

    if (filters.lifecycleStage) query.lifecycleStage = filters.lifecycleStage;
    if (filters.segment) query.segments = filters.segment;
    if (filters.tag) query.tagsNormalized = normalizeTag(filters.tag);
    if (filters.duplicateStatus) query.deduplicationStatus = filters.duplicateStatus;
    if (filters.search) {
      const regex = new RegExp(escapeRegExp(cleanText(filters.search, 160)), "i");
      query.$or = [
        { fullName: regex },
        { email: regex },
        { phone: regex },
        { whatsappNumber: regex },
        { crmCustomerNumber: regex }
      ];
    }

    const [items, count] = await Promise.all([
      executeQuery(CustomerModel.find(query), {
        sort: { updatedAt: -1, createdAt: -1 },
        skip: (page - 1) * limit,
        limit
      }),
      typeof CustomerModel.countDocuments === "function" ? CustomerModel.countDocuments(query) : Promise.resolve(0)
    ]);

    const formatted = (items || []).map(summarizeCustomer);
    if (!withMeta) return formatted;
    return {
      items: formatted,
      count,
      page,
      limit,
      filters: {
        search: filters.search || "",
        lifecycleStage: filters.lifecycleStage || "",
        segment: filters.segment || "",
        tag: filters.tag || "",
        duplicateStatus: filters.duplicateStatus || ""
      }
    };
  };

  const getCustomer = async (id) => {
    const customer = await executeQuery(CustomerModel.findById(id), { populate: "bookings" });

    if (!customer) {
      throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
    }

    return customer;
  };

  const getCustomerFinancialSummary = async (customer = {}) => {
    const customerId = idOf(customer);
    const customerEmail = normalizeEmail(customer.email);
    const bookingQuery = {
      $or: [
        { "customer.customerId": customerId },
        customerEmail ? { "customer.email": customerEmail } : null
      ].filter(Boolean)
    };

    const bookings = await executeQuery(BookingModel.find(bookingQuery), {
      sort: { createdAt: -1 },
      limit: 250
    });
    const bookingReferences = [...new Set((bookings || []).map((booking) => booking.bookingReference).filter(Boolean))];
    const [payments, invoices, refunds] = await Promise.all([
      bookingReferences.length ? executeQuery(PaymentModel.find({ bookingReference: { $in: bookingReferences } })) : [],
      bookingReferences.length ? executeQuery(InvoiceModel.find({ bookingReference: { $in: bookingReferences } })) : [],
      executeQuery(RefundModel.find({ customerId }))
    ]);

    const paidPayments = (payments || []).filter((payment) => String(payment.status || payment.paymentStatus || "") === "paid");
    const confirmedRefunds = (refunds || []).filter((refund) =>
      ["refunded", "partially_refunded"].includes(String(refund.status || ""))
    );
    const amountPaid = paidPayments.reduce(
      (total, payment) =>
        total + decimalToNumber(payment.accountingAmount || payment.amountPaid || payment.paidAmount || payment.amount),
      0
    );
    const paymentRefundedAmount = paidPayments.reduce(
      (total, payment) => total + decimalToNumber(payment.refundedAmount || 0),
      0
    );
    const refundRecordsAmount = confirmedRefunds.reduce(
      (total, refund) =>
        total + decimalToNumber(refund.confirmedRefundedAmount || refund.confirmedProviderRefundedAmount || refund.amount),
      0
    );
    const amountRefunded = Math.max(paymentRefundedAmount, refundRecordsAmount);
    const salesChannels = [...new Set((bookings || []).map((booking) => booking.salesChannel || booking.sourceChannel).filter(Boolean))];

    return {
      source: "local_accounting_records",
      usesCanonicalProfitFormula: false,
      bookingCount: (bookings || []).length,
      confirmedBookingCount: (bookings || []).filter((booking) => booking.bookingStatus === "confirmed").length,
      cancelledBookingCount: (bookings || []).filter((booking) => booking.bookingStatus === "cancelled").length,
      invoiceCount: (invoices || []).length,
      paymentCount: paidPayments.length,
      refundCount: confirmedRefunds.length,
      amountPaid: money(amountPaid),
      amountRefunded: money(amountRefunded),
      netCollected: money(amountPaid - amountRefunded),
      currency: paidPayments[0]?.accountingCurrency || paidPayments[0]?.currency || invoices[0]?.accountingCurrency || "USD",
      salesChannels
    };
  };

  const getCustomerProfile = async (id, { includeTimeline = true, includeFinancials = true } = {}) => {
    const customer = await getCustomer(id);
    const [financialSummary, timeline] = await Promise.all([
      includeFinancials
        ? getCustomerFinancialSummary(customer)
        : Promise.resolve({
            source: "restricted",
            restricted: true,
            message: "crm.view_customer_financials permission is required."
          }),
      includeTimeline
        ? executeQuery(CustomerTimelineEventModel.find({ customerId: id }), { sort: { occurredAt: -1 }, limit: 50 })
        : []
    ]);

    return {
      customer: summarizeCustomer(customer),
      financialSummary,
      timeline: (timeline || []).map(summarizeTimelineEvent)
    };
  };

  const createCustomer = async ({ payload = {}, auth = {}, requestId = "" } = {}) => {
    const patch = buildCustomerPatch(payload, auth);
    if (!patch.firstName || !patch.lastName || !patch.emailNormalized) {
      throw new AppError("Customer first name, last name, and email are required.", 422, "CRM_CUSTOMER_REQUIRED_FIELDS");
    }

    const exactClauses = buildExactCustomerClauses(patch);
    const exactMatch = exactClauses.length
      ? await executeQuery(CustomerModel.findOne({ $or: exactClauses }))
      : null;

    if (exactMatch) {
      await recordTimeline({
        customerId: idOf(exactMatch),
        eventType: CUSTOMER_TIMELINE_EVENT_TYPE.DUPLICATE_PREVENTED,
        summary: "Duplicate customer creation prevented by stable identifier.",
        auth,
        requestId,
        metadata: { attemptedEmail: patch.emailNormalized }
      });
      await recordAudit({
        action: "crm_customer_duplicate_prevented",
        entityId: idOf(exactMatch),
        after: summarizeCustomer(exactMatch),
        auth,
        requestId,
        metadata: { attemptedEmail: patch.emailNormalized }
      });
      return {
        action: "existing",
        duplicateReviewRequired: false,
        customer: summarizeCustomer(exactMatch)
      };
    }

    const possibleClauses = buildPossibleDuplicateClauses(patch);
    const possibleMatches = possibleClauses.length
      ? await executeQuery(CustomerModel.find({ $or: possibleClauses }), { limit: 10 })
      : [];
    const possibleDuplicateReasons = (possibleMatches || []).flatMap((match) => resolveDuplicateMatchFields(patch, match));
    const nowDate = now();
    const customer = await CustomerModel.create({
      ...patch,
      crmCustomerNumber: payload.crmCustomerNumber || buildCustomerNumber(),
      createdBy: actorSnapshot(auth),
      lastCrmActivityAt: nowDate,
      deduplicationStatus: possibleMatches?.length
        ? CUSTOMER_DUPLICATE_STATUS.POSSIBLE_DUPLICATE
        : CUSTOMER_DUPLICATE_STATUS.CLEAN,
      possibleDuplicateOf: possibleMatches?.[0]?._id || null,
      possibleDuplicateReasons: [...new Set(possibleDuplicateReasons)]
    });
    const plainCustomer = toPlain(customer);
    const candidates = [];

    for (const match of possibleMatches || []) {
      const matchFields = resolveDuplicateMatchFields(patch, match);
      if (!matchFields.length) continue;
      const candidate = await createDuplicateCandidate({
        primaryCustomer: match,
        duplicateCustomer: plainCustomer,
        matchFields,
        auth,
        requestId
      });
      if (candidate) candidates.push(candidate);
    }

    await recordTimeline({
      customerId: idOf(plainCustomer),
      eventType: CUSTOMER_TIMELINE_EVENT_TYPE.CUSTOMER_CREATED,
      summary: "Customer master record created.",
      auth,
      requestId,
      metadata: {
        deduplicationStatus: plainCustomer.deduplicationStatus,
        candidateCount: candidates.length
      }
    });
    await recordAudit({
      action: "crm_customer_created",
      entityId: idOf(plainCustomer),
      after: summarizeCustomer(plainCustomer),
      auth,
      requestId,
      metadata: { candidateCount: candidates.length }
    });

    return {
      action: "created",
      duplicateReviewRequired: candidates.length > 0,
      customer: summarizeCustomer(plainCustomer),
      duplicateCandidates: candidates
    };
  };

  const updateCustomer = async ({ customerId, payload = {}, auth = {}, requestId = "" } = {}) => {
    const customer = await CustomerModel.findById(customerId);
    if (!customer) {
      throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
    }

    const before = summarizeCustomer(customer);
    const patch = buildCustomerPatch(
      {
        ...before,
        ...payload,
        externalReferences: payload.externalReferences || before.externalReferences || [],
        tags: payload.tags || before.tags || [],
        segments: payload.segments || before.segments || [],
        manualSegments: payload.manualSegments || before.manualSegments || []
      },
      auth
    );

    Object.assign(customer, patch, {
      lastCrmActivityAt: now()
    });
    await customer.save();
    const after = summarizeCustomer(customer);

    await recordTimeline({
      customerId,
      eventType: CUSTOMER_TIMELINE_EVENT_TYPE.CUSTOMER_UPDATED,
      summary: "Customer master record updated.",
      auth,
      requestId
    });
    await recordAudit({
      action: "crm_customer_updated",
      entityId: customerId,
      before,
      after,
      auth,
      requestId
    });

    return {
      action: "updated",
      customer: after
    };
  };

  const listCustomerTimeline = async ({ customerId, limit = 100 } = {}) => {
    await getCustomer(customerId);
    const events = await executeQuery(CustomerTimelineEventModel.find({ customerId }), {
      sort: { occurredAt: -1 },
      limit: Math.min(Math.max(Number(limit || 100), 1), 300)
    });
    return {
      items: (events || []).map(summarizeTimelineEvent),
      count: events?.length || 0
    };
  };

  const logCustomerCommunication = async ({ customerId, payload = {}, auth = {}, requestId = "" } = {}) => {
    const customer = await CustomerModel.findById(customerId);
    if (!customer) {
      throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
    }

    const direction = Object.values(CRM_COMMUNICATION_DIRECTION).includes(payload.direction)
      ? payload.direction
      : CRM_COMMUNICATION_DIRECTION.OUTBOUND;
    const channel = Object.values(CRM_COMMUNICATION_CHANNEL).includes(payload.channel)
      ? payload.channel
      : CRM_COMMUNICATION_CHANNEL.OTHER;
    const note = cleanText(payload.note || payload.bodyPreview, 2000);
    const summary = cleanText(payload.summary || payload.subject || note, 500);
    if (!summary) {
      throw new AppError("Communication summary is required.", 422, "CRM_COMMUNICATION_SUMMARY_REQUIRED");
    }

    const occurredAt = normalizeDate(payload.occurredAt) || now();
    const communication = normalizeCommunication({
      channel,
      direction,
      status: CRM_COMMUNICATION_STATUS.MANUAL_LOGGED,
      subject: payload.subject,
      bodyPreview: note
    });
    const eventType =
      direction === CRM_COMMUNICATION_DIRECTION.INTERNAL_NOTE
        ? CUSTOMER_TIMELINE_EVENT_TYPE.NOTE_ADDED
        : CUSTOMER_TIMELINE_EVENT_TYPE.COMMUNICATION_LOGGED;
    const relatedEntityType = cleanText(payload.relatedEntityType, 80);
    const relatedEntityId = cleanText(payload.relatedEntityId, 180);

    const event = await recordTimeline({
      customerId,
      eventType,
      summary,
      sourceModule: "CRM",
      sourceEntityType: relatedEntityType || "Customer",
      sourceEntityId: relatedEntityId || customerId,
      reference: cleanText(payload.reference, 180),
      occurredAt,
      communication,
      sensitive: Boolean(payload.sensitive),
      auth,
      requestId,
      metadata: {
        manualEntry: true,
        deliveryStatusIsProviderVerified: false,
        relatedEntityType,
        relatedEntityId,
        ...sanitizeMetadata(payload.metadata || {})
      }
    });

    customer.lastCrmActivityAt = occurredAt;
    customer.updatedBy = actorSnapshot(auth);
    if (typeof customer.save === "function") await customer.save();

    await recordAudit({
      action:
        direction === CRM_COMMUNICATION_DIRECTION.INTERNAL_NOTE
          ? "crm_customer_note_added"
          : "crm_customer_communication_logged",
      entityId: customerId,
      after: event,
      auth,
      requestId,
      metadata: {
        channel: communication.channel,
        direction: communication.direction,
        status: communication.status,
        deliveryStatusIsProviderVerified: false,
        manualEntry: true
      }
    });

    return {
      action: "logged",
      event,
      deliveryStatusIsProviderVerified: false
    };
  };

  const listDuplicateCandidates = async (filters = {}) => {
    const query = {};
    if (filters.status) query.status = filters.status;
    const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 300);
    const candidates = await executeQuery(CustomerDuplicateCandidateModel.find(query), {
      populate: [
        { path: "primaryCustomerId", select: "fullName email phone whatsappNumber crmCustomerNumber" },
        { path: "duplicateCustomerId", select: "fullName email phone whatsappNumber crmCustomerNumber" }
      ],
      sort: { updatedAt: -1 },
      limit
    });
    return {
      items: (candidates || []).map(toPlain),
      count: candidates?.length || 0
    };
  };

  const reviewDuplicateCandidate = async ({ candidateId, status, reviewNote = "", auth = {}, requestId = "" } = {}) => {
    const candidate = await CustomerDuplicateCandidateModel.findById(candidateId);
    if (!candidate) {
      throw new AppError("Duplicate candidate not found", 404, "CUSTOMER_DUPLICATE_CANDIDATE_NOT_FOUND");
    }

    const before = toPlain(candidate);
    candidate.status = status;
    candidate.reviewNote = cleanText(reviewNote, 1000);
    candidate.reviewedBy = actorSnapshot(auth);
    candidate.reviewedAt = now();
    await candidate.save();
    const after = toPlain(candidate);

    await recordTimeline({
      customerId: idOf(candidate.duplicateCustomerId),
      eventType: CUSTOMER_TIMELINE_EVENT_TYPE.DUPLICATE_REVIEWED,
      summary: `Duplicate candidate reviewed as ${status}.`,
      sourceEntityType: "CustomerDuplicateCandidate",
      sourceEntityId: idOf(candidate),
      auth,
      requestId,
      metadata: { reviewNote: candidate.reviewNote }
    });
    await recordAudit({
      action: "crm_customer_duplicate_reviewed",
      entityId: idOf(candidate.duplicateCustomerId),
      before,
      after,
      auth,
      requestId,
      metadata: { candidateId, status }
    });

    return {
      action: "reviewed",
      candidate: after
    };
  };

  const getCrmDashboard = async () => {
    const [customerCount, possibleDuplicateCount, openDuplicateCount, lifecycleBreakdown] = await Promise.all([
      typeof CustomerModel.countDocuments === "function" ? CustomerModel.countDocuments({}) : Promise.resolve(0),
      typeof CustomerModel.countDocuments === "function"
        ? CustomerModel.countDocuments({ deduplicationStatus: CUSTOMER_DUPLICATE_STATUS.POSSIBLE_DUPLICATE })
        : Promise.resolve(0),
      typeof CustomerDuplicateCandidateModel.countDocuments === "function"
        ? CustomerDuplicateCandidateModel.countDocuments({ status: DUPLICATE_CANDIDATE_STATUS.OPEN })
        : Promise.resolve(0),
      typeof CustomerModel.aggregate === "function"
        ? CustomerModel.aggregate([
            { $group: { _id: "$lifecycleStage", count: { $sum: 1 } } },
            { $sort: { count: -1 } }
          ])
        : Promise.resolve([])
    ]);

    return {
      step: "7A",
      foundationReady: true,
      crmSourceOfTruth: "Customer master for pre-booking and customer lifecycle data",
      bookingSourceOfTruth: "Bokun confirmed bookings remain operational truth",
      financialSourceOfTruth: "Local accounting records remain financial truth",
      metrics: {
        customerCount,
        possibleDuplicateCount,
        openDuplicateCount,
        lifecycleBreakdown: lifecycleBreakdown || []
      },
      enabledModules: [
        "CUSTOMER_MASTER",
        "CUSTOMER_DEDUPLICATION",
        "CUSTOMER_TIMELINE_FOUNDATION",
        "CUSTOMER_COMMUNICATION_TIMELINE"
      ],
      plannedModules: [
        "LEADS",
        "OPPORTUNITIES",
        "PIPELINE",
        "QUOTES",
        "FOLLOW_UPS",
        "TASKS",
        "CONVERSATIONS",
        "B2B_PARTNERS",
        "CRM_ANALYTICS"
      ]
    };
  };

  return {
    createCustomer,
    getCrmDashboard,
    getCustomer,
    getCustomerFinancialSummary,
    getCustomerProfile,
    listCustomerTimeline,
    listCustomers,
    listDuplicateCandidates,
    logCustomerCommunication,
    reviewDuplicateCandidate,
    updateCustomer
  };
};

const service = createCustomerService();

module.exports = {
  ...service,
  createCustomerService,
  __testables: {
    buildCustomerPatch,
    buildExactCustomerClauses,
    buildPossibleDuplicateClauses,
    normalizeEmail,
    normalizePhone,
    resolveDuplicateMatchFields,
    sanitizeMetadata,
    summarizeCustomer
  }
};
