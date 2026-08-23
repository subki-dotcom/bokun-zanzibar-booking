const crypto = require("crypto");
const Quote = require("../../models/Quote");
const Lead = require("../../models/Lead");
const SalesOpportunity = require("../../models/SalesOpportunity");
const Customer = require("../../models/Customer");
const CustomerTimelineEvent = require("../../models/CustomerTimelineEvent");
const AuditLog = require("../../models/AuditLog");
const { createCrmBookingEvidenceService } = require("../crmBookingEvidence");
const AppError = require("../../utils/AppError");
const {
  CRM_OPPORTUNITY_STAGE,
  CRM_QUOTE_LINE_ITEM_TYPE,
  CRM_QUOTE_STATUS,
  CUSTOMER_TIMELINE_EVENT_TYPE
} = require("../../crm/constants");

const PRICE_LOCKED_STATUSES = Object.freeze([
  CRM_QUOTE_STATUS.SENT,
  CRM_QUOTE_STATUS.VIEWED,
  CRM_QUOTE_STATUS.ACCEPTED,
  CRM_QUOTE_STATUS.REJECTED,
  CRM_QUOTE_STATUS.EXPIRED,
  CRM_QUOTE_STATUS.CONVERTED,
  CRM_QUOTE_STATUS.CANCELLED
]);
const EDITABLE_STATUSES = Object.freeze([
  CRM_QUOTE_STATUS.DRAFT,
  CRM_QUOTE_STATUS.INTERNAL_REVIEW,
  CRM_QUOTE_STATUS.APPROVED
]);
const SENDABLE_STATUSES = Object.freeze([CRM_QUOTE_STATUS.APPROVED]);
const ACCEPTABLE_STATUSES = Object.freeze([
  CRM_QUOTE_STATUS.SENT,
  CRM_QUOTE_STATUS.VIEWED,
  CRM_QUOTE_STATUS.APPROVED
]);

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
const roundMoney = (value) => Number(normalizeMoney(value).toFixed(2));
const normalizeCurrency = (value = "USD") => cleanText(value || "USD", 3).toUpperCase() || "USD";
const actorSnapshot = (auth = {}) => ({
  id: cleanText(auth.id || auth.userId || "", 120),
  role: cleanText(auth.role || "system", 80),
  email: cleanText(auth.email || "", 160),
  name: cleanText(auth.name || "", 160)
});
const buildQuoteNumber = () =>
  `QTE-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;

const executeQuery = async (query, { sort, limit, skip, populate } = {}) => {
  let next = query;
  if (next && populate && typeof next.populate === "function") next = next.populate(populate);
  if (next && sort && typeof next.sort === "function") next = next.sort(sort);
  if (next && Number.isFinite(skip) && typeof next.skip === "function") next = next.skip(skip);
  if (next && Number.isFinite(limit) && typeof next.limit === "function") next = next.limit(limit);
  if (next && typeof next.lean === "function") next = next.lean();
  return next && typeof next.then === "function" ? next : Promise.resolve(next);
};

const normalizeLineItem = (item = {}) => {
  const quantity = normalizeMoney(item.quantity || 1);
  const unitPrice = normalizeMoney(item.unitPrice);
  const discount = normalizeMoney(item.discount);
  const tax = normalizeMoney(item.tax);
  const gross = quantity * unitPrice;
  return {
    itemType: Object.values(CRM_QUOTE_LINE_ITEM_TYPE).includes(item.itemType)
      ? item.itemType
      : CRM_QUOTE_LINE_ITEM_TYPE.CUSTOM_SERVICE,
    description: cleanText(item.description, 500),
    productId: cleanText(item.productId, 120),
    productOptionId: cleanText(item.productOptionId, 120),
    quantity,
    unitPrice: roundMoney(unitPrice),
    discount: roundMoney(discount),
    tax: roundMoney(tax),
    lineTotal: roundMoney(Math.max(gross - discount + tax, 0))
  };
};

const normalizeLineItems = (items = []) =>
  (items || []).map(normalizeLineItem).filter((item) => item.description);

const calculateQuoteTotals = (lineItems = []) => {
  const totals = lineItems.reduce(
    (acc, item) => {
      const gross = normalizeMoney(item.quantity) * normalizeMoney(item.unitPrice);
      return {
        subtotal: acc.subtotal + gross,
        discount: acc.discount + normalizeMoney(item.discount),
        tax: acc.tax + normalizeMoney(item.tax)
      };
    },
    { subtotal: 0, discount: 0, tax: 0 }
  );
  return {
    subtotal: roundMoney(totals.subtotal),
    discount: roundMoney(totals.discount),
    tax: roundMoney(totals.tax),
    total: roundMoney(Math.max(totals.subtotal - totals.discount + totals.tax, 0))
  };
};

const isPriceLocked = (quote = {}) =>
  Boolean(quote.priceLockedAt) || PRICE_LOCKED_STATUSES.includes(quote.status);

const assertEditableCommercials = (quote = {}, payload = {}) => {
  const changesCommercials =
    Object.prototype.hasOwnProperty.call(payload, "lineItems") ||
    Object.prototype.hasOwnProperty.call(payload, "currency");
  if (changesCommercials && isPriceLocked(quote)) {
    throw new AppError(
      "Quote prices are locked after the quote is issued or sent.",
      409,
      "CRM_QUOTE_PRICE_LOCKED"
    );
  }
};

const summarizeQuote = (quote = {}) => {
  const plain = toPlain(quote) || {};
  const status = plain.status || CRM_QUOTE_STATUS.DRAFT;
  const lineItems = normalizeLineItems(plain.lineItems || []);
  const totals = calculateQuoteTotals(lineItems);
  return {
    _id: plain._id,
    id: idOf(plain),
    quoteNumber: plain.quoteNumber || "",
    leadId: plain.leadId || null,
    opportunityId: plain.opportunityId || null,
    customerId: plain.customerId || null,
    currency: normalizeCurrency(plain.currency),
    issueDate: plain.issueDate || null,
    validUntil: plain.validUntil || null,
    lineItems,
    subtotal: totals.subtotal,
    discount: totals.discount,
    tax: totals.tax,
    total: totals.total,
    status,
    notes: plain.notes || "",
    terms: plain.terms || "",
    priceLockedAt: plain.priceLockedAt || null,
    createdBy: plain.createdBy || {},
    updatedBy: plain.updatedBy || {},
    approvedBy: plain.approvedBy || {},
    sentAt: plain.sentAt || null,
    acceptedAt: plain.acceptedAt || null,
    rejectedAt: plain.rejectedAt || null,
    convertedAt: plain.convertedAt || null,
    convertedBookingId: plain.convertedBookingId || null,
    bokunBookingId: plain.bokunBookingId || "",
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
    quoteValueIsForecastOnly: true,
    actualRevenueSource: "Booking Accounting after Bokun confirmed booking"
  };
};

const summarizeLinkedOpportunity = (opportunity = {}) => {
  const plain = toPlain(opportunity) || {};
  return {
    _id: plain._id,
    id: idOf(plain),
    opportunityNumber: plain.opportunityNumber || "",
    title: plain.title || "",
    stage: plain.stage || CRM_OPPORTUNITY_STAGE.NEW,
    probability: Number(plain.probability || 0),
    wonBookingId: plain.wonBookingId || null,
    wonBokunBookingId: plain.wonBokunBookingId || "",
    wonAt: plain.wonAt || null
  };
};

const validateQuotePatch = (patch = {}) => {
  if (!patch.lineItems?.length) {
    throw new AppError("At least one quote line item is required.", 422, "CRM_QUOTE_LINE_ITEM_REQUIRED");
  }
  const invalidQuantity = patch.lineItems.find((item) => normalizeMoney(item.quantity) <= 0);
  if (invalidQuantity) {
    throw new AppError("Quote line item quantity must be greater than zero.", 422, "CRM_QUOTE_QUANTITY_INVALID");
  }
  if (!patch.currency || patch.currency.length !== 3) {
    throw new AppError("Quote currency must be a three-letter currency code.", 422, "CRM_QUOTE_CURRENCY_INVALID");
  }
};

const buildQuotePatch = (payload = {}, auth = {}, existing = {}) => {
  const base = toPlain(existing) || {};
  const lineItems = Object.prototype.hasOwnProperty.call(payload, "lineItems")
    ? normalizeLineItems(payload.lineItems)
    : normalizeLineItems(base.lineItems || []);
  const totals = calculateQuoteTotals(lineItems);
  const requestedStatus = payload.status || base.status || CRM_QUOTE_STATUS.DRAFT;
  const status = Object.values(CRM_QUOTE_STATUS).includes(requestedStatus)
    ? requestedStatus
    : CRM_QUOTE_STATUS.DRAFT;

  return {
    leadId: payload.leadId ?? base.leadId ?? null,
    opportunityId: payload.opportunityId ?? base.opportunityId ?? null,
    customerId: payload.customerId ?? base.customerId ?? null,
    currency: normalizeCurrency(payload.currency || base.currency || "USD"),
    issueDate: normalizeDate(payload.issueDate) || base.issueDate || null,
    validUntil: Object.prototype.hasOwnProperty.call(payload, "validUntil")
      ? normalizeDate(payload.validUntil)
      : base.validUntil || null,
    lineItems,
    ...totals,
    status,
    notes: Object.prototype.hasOwnProperty.call(payload, "notes")
      ? cleanText(payload.notes, 3000)
      : base.notes || "",
    terms: Object.prototype.hasOwnProperty.call(payload, "terms")
      ? cleanText(payload.terms, 3000)
      : base.terms || "",
    updatedBy: actorSnapshot(auth)
  };
};

const buildListQuery = (filters = {}) => {
  const query = {};
  if (filters.status) query.status = filters.status;
  if (filters.leadId) query.leadId = filters.leadId;
  if (filters.opportunityId) query.opportunityId = filters.opportunityId;
  if (filters.customerId) query.customerId = filters.customerId;
  if (filters.currency) query.currency = normalizeCurrency(filters.currency);
  if (filters.search) {
    const regex = new RegExp(escapeRegExp(cleanText(filters.search, 160)), "i");
    query.$or = [
      { quoteNumber: regex },
      { notes: regex },
      { terms: regex },
      { "lineItems.description": regex }
    ];
  }
  return query;
};

const createCrmQuoteService = ({
  QuoteModel = Quote,
  LeadModel = Lead,
  SalesOpportunityModel = SalesOpportunity,
  CustomerModel = Customer,
  BookingModel,
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
      entityType: "Quote",
      entityId: String(entityId || ""),
      reference: after?.quoteNumber || before?.quoteNumber || "",
      requestId,
      before,
      after,
      metadata
    });

  const recordOpportunityAudit = async ({ action, entityId, before = null, after = null, auth = {}, requestId = "", metadata = {} }) =>
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

  const createTimelineEvent = async ({ quote, eventType, summary, auth = {}, requestId = "" }) => {
    if (!quote.customerId) return null;
    return CustomerTimelineEventModel.create({
      customerId: quote.customerId,
      eventType,
      sourceModule: "CRM",
      sourceEntityType: "Quote",
      sourceEntityId: quote.id || quote._id,
      reference: quote.quoteNumber,
      summary,
      occurredAt: now(),
      actor: actorSnapshot(auth),
      metadata: {
        requestId,
        quoteStatus: quote.status,
        quoteValueIsForecastOnly: true,
        opportunityId: idOf(quote.opportunityId),
        leadId: idOf(quote.leadId)
      }
    });
  };

  const hydrateRelations = async (patch = {}) => {
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
    return next;
  };

  const getQuote = async (id) => {
    const quote = await executeQuery(QuoteModel.findById(id), {
      populate: [
        { path: "leadId", select: "leadReference fullName email phone status source" },
        { path: "opportunityId", select: "opportunityNumber title stage estimatedValue currency" },
        { path: "customerId", select: "fullName email phone crmCustomerNumber lifecycleStage" }
      ]
    });
    if (!quote) {
      throw new AppError("Quote not found", 404, "CRM_QUOTE_NOT_FOUND");
    }
    return quote;
  };

  const listQuotes = async (filters = {}) => {
    const withMeta = Boolean(filters.withMeta);
    const page = Math.max(Number(filters.page || 1), 1);
    const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 500);
    const query = buildListQuery(filters);
    const [items, count] = await Promise.all([
      executeQuery(QuoteModel.find(query), {
        sort: { updatedAt: -1, createdAt: -1 },
        skip: (page - 1) * limit,
        limit,
        populate: [
          { path: "leadId", select: "leadReference fullName email phone status source" },
          { path: "opportunityId", select: "opportunityNumber title stage estimatedValue currency" },
          { path: "customerId", select: "fullName email phone crmCustomerNumber lifecycleStage" }
        ]
      }),
      typeof QuoteModel.countDocuments === "function"
        ? QuoteModel.countDocuments(query)
        : Promise.resolve(0)
    ]);

    const formatted = (items || []).map(summarizeQuote);
    if (!withMeta) return formatted;
    return {
      items: formatted,
      count,
      page,
      limit,
      filters: {
        search: filters.search || "",
        status: filters.status || "",
        leadId: filters.leadId || "",
        opportunityId: filters.opportunityId || "",
        customerId: filters.customerId || "",
        currency: filters.currency || ""
      }
    };
  };

  const createQuote = async ({ payload = {}, auth = {}, requestId = "" } = {}) => {
    const patch = await hydrateRelations(buildQuotePatch(payload, auth));
    validateQuotePatch(patch);
    if (![CRM_QUOTE_STATUS.DRAFT, CRM_QUOTE_STATUS.INTERNAL_REVIEW].includes(patch.status)) {
      throw new AppError("New quotes must start as draft or internal review.", 422, "CRM_QUOTE_INITIAL_STATUS_INVALID");
    }

    const quote = await QuoteModel.create({
      ...patch,
      quoteNumber: payload.quoteNumber || buildQuoteNumber(),
      createdBy: actorSnapshot(auth),
      updatedBy: actorSnapshot(auth)
    });
    const plainQuote = summarizeQuote(quote);

    await recordAudit({
      action: "crm_quote_created",
      entityId: plainQuote.id,
      after: plainQuote,
      auth,
      requestId,
      metadata: { quoteValueIsForecastOnly: true }
    });
    await createTimelineEvent({
      quote: plainQuote,
      eventType: CUSTOMER_TIMELINE_EVENT_TYPE.QUOTE_CREATED,
      summary: "CRM quote created.",
      auth,
      requestId
    });

    return {
      action: "created",
      quote: plainQuote
    };
  };

  const updateQuote = async ({ quoteId, payload = {}, auth = {}, requestId = "" } = {}) => {
    const quote = await QuoteModel.findById(quoteId);
    if (!quote) {
      throw new AppError("Quote not found", 404, "CRM_QUOTE_NOT_FOUND");
    }
    const before = summarizeQuote(quote);
    assertEditableCommercials(before, payload);
    if (!EDITABLE_STATUSES.includes(before.status)) {
      throw new AppError("Quote cannot be edited in its current status.", 409, "CRM_QUOTE_NOT_EDITABLE");
    }
    if (payload.status && ![CRM_QUOTE_STATUS.DRAFT, CRM_QUOTE_STATUS.INTERNAL_REVIEW].includes(payload.status)) {
      throw new AppError("Use the dedicated quote action for this status transition.", 422, "CRM_QUOTE_STATUS_ACTION_REQUIRED");
    }

    const patch = await hydrateRelations(buildQuotePatch(payload, auth, before));
    validateQuotePatch(patch);
    Object.assign(quote, patch, { updatedBy: actorSnapshot(auth) });
    await quote.save();
    const after = summarizeQuote(quote);

    await recordAudit({
      action: "crm_quote_updated",
      entityId: quoteId,
      before,
      after,
      auth,
      requestId,
      metadata: { quoteValueIsForecastOnly: true }
    });

    return {
      action: "updated",
      quote: after
    };
  };

  const approveQuote = async ({ quoteId, auth = {}, requestId = "" } = {}) => {
    const quote = await QuoteModel.findById(quoteId);
    if (!quote) throw new AppError("Quote not found", 404, "CRM_QUOTE_NOT_FOUND");
    const before = summarizeQuote(quote);
    if (![CRM_QUOTE_STATUS.DRAFT, CRM_QUOTE_STATUS.INTERNAL_REVIEW, CRM_QUOTE_STATUS.APPROVED].includes(before.status)) {
      throw new AppError("Only draft or internal review quotes can be approved.", 409, "CRM_QUOTE_APPROVAL_INVALID_STATUS");
    }

    quote.status = CRM_QUOTE_STATUS.APPROVED;
    quote.approvedBy = actorSnapshot(auth);
    quote.updatedBy = actorSnapshot(auth);
    await quote.save();
    const after = summarizeQuote(quote);

    await recordAudit({
      action: "crm_quote_approved",
      entityId: quoteId,
      before,
      after,
      auth,
      requestId,
      metadata: { quoteValueIsForecastOnly: true }
    });
    await createTimelineEvent({
      quote: after,
      eventType: CUSTOMER_TIMELINE_EVENT_TYPE.QUOTE_APPROVED,
      summary: "CRM quote approved for sending.",
      auth,
      requestId
    });

    return {
      action: "approved",
      quote: after
    };
  };

  const sendQuote = async ({ quoteId, auth = {}, requestId = "" } = {}) => {
    const quote = await QuoteModel.findById(quoteId);
    if (!quote) throw new AppError("Quote not found", 404, "CRM_QUOTE_NOT_FOUND");
    const before = summarizeQuote(quote);
    if (!SENDABLE_STATUSES.includes(before.status)) {
      throw new AppError("Quote must be approved before it is sent.", 409, "CRM_QUOTE_SEND_APPROVAL_REQUIRED");
    }

    const sentAt = now();
    quote.status = CRM_QUOTE_STATUS.SENT;
    quote.issueDate = quote.issueDate || sentAt;
    quote.sentAt = quote.sentAt || sentAt;
    quote.priceLockedAt = quote.priceLockedAt || sentAt;
    quote.updatedBy = actorSnapshot(auth);
    await quote.save();
    const after = summarizeQuote(quote);

    await recordAudit({
      action: "crm_quote_sent",
      entityId: quoteId,
      before,
      after,
      auth,
      requestId,
      metadata: {
        quoteValueIsForecastOnly: true,
        bookingConversionDeferredToExistingBookingFlow: true
      }
    });
    await createTimelineEvent({
      quote: after,
      eventType: CUSTOMER_TIMELINE_EVENT_TYPE.QUOTE_SENT,
      summary: "CRM quote sent to customer.",
      auth,
      requestId
    });

    return {
      action: "sent",
      quote: after
    };
  };

  const acceptQuote = async ({ quoteId, auth = {}, requestId = "" } = {}) => {
    const quote = await QuoteModel.findById(quoteId);
    if (!quote) throw new AppError("Quote not found", 404, "CRM_QUOTE_NOT_FOUND");
    const before = summarizeQuote(quote);
    if (!ACCEPTABLE_STATUSES.includes(before.status)) {
      throw new AppError("Quote cannot be accepted in its current status.", 409, "CRM_QUOTE_ACCEPT_INVALID_STATUS");
    }

    const acceptedAt = now();
    quote.status = CRM_QUOTE_STATUS.ACCEPTED;
    quote.acceptedAt = quote.acceptedAt || acceptedAt;
    quote.priceLockedAt = quote.priceLockedAt || acceptedAt;
    quote.updatedBy = actorSnapshot(auth);
    await quote.save();

    if (quote.opportunityId && SalesOpportunityModel.findById) {
      const opportunity = await SalesOpportunityModel.findById(quote.opportunityId);
      if (opportunity && ![CRM_OPPORTUNITY_STAGE.WON, CRM_OPPORTUNITY_STAGE.LOST].includes(opportunity.stage)) {
        opportunity.stage = CRM_OPPORTUNITY_STAGE.READY_TO_BOOK;
        opportunity.updatedBy = actorSnapshot(auth);
        if (typeof opportunity.save === "function") await opportunity.save();
      }
    }

    const after = summarizeQuote(quote);
    await recordAudit({
      action: "crm_quote_accepted",
      entityId: quoteId,
      before,
      after,
      auth,
      requestId,
      metadata: {
        quoteValueIsForecastOnly: true,
        bookingCreated: false,
        nextStep: "Convert through the existing booking/payment/Bokun confirmation flow"
      }
    });
    await createTimelineEvent({
      quote: after,
      eventType: CUSTOMER_TIMELINE_EVENT_TYPE.QUOTE_ACCEPTED,
      summary: "CRM quote accepted. Booking conversion remains a separate flow.",
      auth,
      requestId
    });

    return {
      action: "accepted",
      quote: after,
      bookingCreated: false
    };
  };

  const convertQuoteToBooking = async ({ quoteId, payload = {}, auth = {}, requestId = "" } = {}) => {
    const quote = await QuoteModel.findById(quoteId);
    if (!quote) throw new AppError("Quote not found", 404, "CRM_QUOTE_NOT_FOUND");
    const before = summarizeQuote(quote);

    if (before.status === CRM_QUOTE_STATUS.CONVERTED) {
      const requestedBookingId = idOf(payload.bookingId);
      const requestedBokunBookingId = cleanText(payload.bokunBookingId, 180);
      const existingBookingId = idOf(before.convertedBookingId);
      const existingBokunBookingId = cleanText(before.bokunBookingId, 180);
      if (
        (requestedBookingId && existingBookingId && requestedBookingId !== existingBookingId) ||
        (requestedBokunBookingId && existingBokunBookingId && requestedBokunBookingId !== existingBokunBookingId)
      ) {
        throw new AppError(
          "Quote is already converted to a different booking.",
          409,
          "CRM_QUOTE_ALREADY_CONVERTED"
        );
      }
      return {
        action: "existing",
        quote: before,
        bookingCreated: false,
        bookingConversionUsesExistingBokunConfirmedBooking: true
      };
    }

    if (before.status !== CRM_QUOTE_STATUS.ACCEPTED) {
      throw new AppError(
        "Only accepted quotes can be converted to confirmed bookings.",
        409,
        "CRM_QUOTE_CONVERSION_REQUIRES_ACCEPTED"
      );
    }

    const { evidence } = await bookingEvidenceService.resolveConfirmedBookingEvidence({
      bookingId: payload.bookingId,
      bookingReference: payload.bookingReference,
      bokunBookingId: payload.bokunBookingId
    });

    if (QuoteModel.findOne) {
      const existingConversion = await executeQuery(QuoteModel.findOne({ convertedBookingId: evidence.bookingId }));
      if (existingConversion && idOf(existingConversion) !== idOf(quote)) {
        throw new AppError(
          "This confirmed booking is already linked to another CRM quote.",
          409,
          "CRM_BOOKING_ALREADY_LINKED_TO_QUOTE",
          {
            quoteId: idOf(existingConversion),
            quoteNumber: existingConversion.quoteNumber || "",
            bookingId: evidence.bookingId,
            bookingReference: evidence.bookingReference
          }
        );
      }
    }

    let opportunity = null;
    let opportunityBefore = null;
    if (quote.opportunityId && SalesOpportunityModel.findById) {
      opportunity = await SalesOpportunityModel.findById(quote.opportunityId);
      if (opportunity) {
        opportunityBefore = summarizeLinkedOpportunity(opportunity);
        if (opportunityBefore.stage === CRM_OPPORTUNITY_STAGE.LOST) {
          throw new AppError(
            "A lost opportunity cannot be won through quote conversion without reopening it first.",
            409,
            "CRM_OPPORTUNITY_ALREADY_LOST"
          );
        }
        if (
          opportunityBefore.stage === CRM_OPPORTUNITY_STAGE.WON &&
          idOf(opportunityBefore.wonBookingId) &&
          idOf(opportunityBefore.wonBookingId) !== evidence.bookingId
        ) {
          throw new AppError(
            "Opportunity is already won against a different booking.",
            409,
            "CRM_OPPORTUNITY_ALREADY_WON_DIFFERENT_BOOKING"
          );
        }
      }
    }

    const convertedAt = now();
    quote.status = CRM_QUOTE_STATUS.CONVERTED;
    quote.convertedAt = quote.convertedAt || convertedAt;
    quote.convertedBookingId = evidence.bookingId;
    quote.bokunBookingId = evidence.bokunBookingId;
    quote.updatedBy = actorSnapshot(auth);
    quote.metadata = {
      ...(toPlain(quote.metadata) || {}),
      bookingConversion: {
        bookingId: evidence.bookingId,
        bookingReference: evidence.bookingReference,
        bokunBookingId: evidence.bokunBookingId,
        bokunConfirmationCode: evidence.bokunConfirmationCode,
        bookingStatus: evidence.bookingStatus,
        supplierStatus: evidence.supplierStatus,
        bokunStatus: evidence.bokunStatus,
        conversionNote: cleanText(payload.conversionNote, 1000),
        convertedAt,
        requestId,
        bookingCreated: false,
        sourceOfOperationalTruth: "BOKUN"
      }
    };
    if (typeof quote.markModified === "function") quote.markModified("metadata");
    await quote.save();

    let linkedOpportunity = null;
    if (opportunity) {
      opportunity.stage = CRM_OPPORTUNITY_STAGE.WON;
      opportunity.probability = 100;
      opportunity.wonBookingId = evidence.bookingId;
      opportunity.wonBokunBookingId = evidence.bokunBookingId;
      opportunity.wonAt = opportunity.wonAt || convertedAt;
      opportunity.stageChangedAt = convertedAt;
      opportunity.lastStageChangeBy = actorSnapshot(auth);
      opportunity.updatedBy = actorSnapshot(auth);
      if (Array.isArray(opportunity.externalReferences)) {
        const alreadyLinked = opportunity.externalReferences.some(
          (reference) => reference.provider === "bokun" && reference.reference === evidence.bokunBookingId
        );
        if (!alreadyLinked && evidence.bokunBookingId) {
          opportunity.externalReferences.push({
            provider: "bokun",
            reference: evidence.bokunBookingId,
            rawReference: evidence.bokunBookingId,
            linkedAt: convertedAt,
            metadata: {
              source: "quote_conversion",
              bookingReference: evidence.bookingReference,
              quoteId: idOf(quote)
            }
          });
        }
      }
      if (typeof opportunity.save === "function") await opportunity.save();
      linkedOpportunity = summarizeLinkedOpportunity(opportunity);
    }

    const after = summarizeQuote(quote);
    await recordAudit({
      action: "crm_quote_converted_to_booking",
      entityId: quoteId,
      before,
      after,
      auth,
      requestId,
      metadata: {
        bookingId: evidence.bookingId,
        bookingReference: evidence.bookingReference,
        bokunBookingId: evidence.bokunBookingId,
        bookingCreated: false,
        bookingConversionUsesExistingBokunConfirmedBooking: true,
        actualRevenueSource: "Booking Accounting after Bokun confirmed booking"
      }
    });
    if (linkedOpportunity) {
      await recordOpportunityAudit({
        action: "crm_opportunity_won_from_quote_conversion",
        entityId: linkedOpportunity.id,
        before: opportunityBefore,
        after: linkedOpportunity,
        auth,
        requestId,
        metadata: {
          quoteId: idOf(quote),
          quoteNumber: after.quoteNumber,
          bookingId: evidence.bookingId,
          bokunBookingId: evidence.bokunBookingId,
          wonRequiresConfirmedBokunBooking: true
        }
      });
    }
    await createTimelineEvent({
      quote: after,
      eventType: CUSTOMER_TIMELINE_EVENT_TYPE.BOOKING_LINKED,
      summary: `CRM quote linked to confirmed Bokun booking ${evidence.bookingReference || evidence.bokunBookingId}.`,
      auth,
      requestId
    });

    return {
      action: "converted",
      quote: after,
      opportunity: linkedOpportunity,
      booking: evidence,
      bookingCreated: false,
      bookingConversionUsesExistingBokunConfirmedBooking: true,
      actualRevenueSource: "Booking Accounting after Bokun confirmed booking"
    };
  };

  const getQuoteDashboardMetrics = async () => {
    const [
      quoteCount,
      draftQuoteCount,
      sentQuoteCount,
      acceptedQuoteCount,
      rejectedQuoteCount,
      statusBreakdown
    ] = await Promise.all([
      typeof QuoteModel.countDocuments === "function" ? QuoteModel.countDocuments({}) : Promise.resolve(0),
      typeof QuoteModel.countDocuments === "function" ? QuoteModel.countDocuments({ status: CRM_QUOTE_STATUS.DRAFT }) : Promise.resolve(0),
      typeof QuoteModel.countDocuments === "function" ? QuoteModel.countDocuments({ status: CRM_QUOTE_STATUS.SENT }) : Promise.resolve(0),
      typeof QuoteModel.countDocuments === "function" ? QuoteModel.countDocuments({ status: CRM_QUOTE_STATUS.ACCEPTED }) : Promise.resolve(0),
      typeof QuoteModel.countDocuments === "function" ? QuoteModel.countDocuments({ status: CRM_QUOTE_STATUS.REJECTED }) : Promise.resolve(0),
      typeof QuoteModel.aggregate === "function"
        ? QuoteModel.aggregate([
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
                totalValue: { $sum: "$total" }
              }
            },
            { $sort: { count: -1 } }
          ])
        : Promise.resolve([])
    ]);

    const totals = (statusBreakdown || []).reduce(
      (acc, row) => {
        const value = Number(row.totalValue || 0);
        return {
          totalQuotedValue: acc.totalQuotedValue + value,
          sentQuoteValue: acc.sentQuoteValue + (row._id === CRM_QUOTE_STATUS.SENT ? value : 0),
          acceptedQuoteValue: acc.acceptedQuoteValue + (row._id === CRM_QUOTE_STATUS.ACCEPTED ? value : 0)
        };
      },
      { totalQuotedValue: 0, sentQuoteValue: 0, acceptedQuoteValue: 0 }
    );

    return {
      quoteCount,
      draftQuoteCount,
      sentQuoteCount,
      acceptedQuoteCount,
      rejectedQuoteCount,
      totalQuotedValue: roundMoney(totals.totalQuotedValue),
      sentQuoteValue: roundMoney(totals.sentQuoteValue),
      acceptedQuoteValue: roundMoney(totals.acceptedQuoteValue),
      quoteStatusBreakdown: statusBreakdown || [],
      quoteValueIsForecastOnly: true,
      actualRevenueSource: "Booking Accounting after Bokun confirmed booking"
    };
  };

  return {
    acceptQuote,
    approveQuote,
    convertQuoteToBooking,
    createQuote,
    getQuote,
    getQuoteDashboardMetrics,
    listQuotes,
    sendQuote,
    updateQuote
  };
};

const service = createCrmQuoteService();

module.exports = {
  ...service,
  createCrmQuoteService,
  __testables: {
    buildListQuery,
    buildQuotePatch,
    calculateQuoteTotals,
    isPriceLocked,
    normalizeLineItem,
    PRICE_LOCKED_STATUSES,
    summarizeQuote,
    validateQuotePatch
  }
};
