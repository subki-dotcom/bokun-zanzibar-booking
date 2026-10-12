const mongoose = require("mongoose");
const Booking = require("../../models/Booking");
const BookingRequest = require("../../models/BookingRequest");
const AuditLog = require("../../models/AuditLog");
const AppError = require("../../utils/AppError");
const { OPERATIONAL_ORIGINS, originFilter, resolveBookingOrigin } = require("../bookings/origin");

// Tour Operations: the operational view of website and Agent Portal tour bookings and their customer
// requests. It reads the same Booking collection as everything else (no copies) and its only writes
// are to BookingRequest.operations plus the audit log. It never changes bookings, payments, refunds,
// invoices, supplier (Bókun) state or the customer-facing request status. Transfer bookings live in
// the separate Transfer System database and never appear here.

const BOOKING_FIELDS = [
  "_id", "bookingReference", "bookingOrigin", "createdByRole", "sourceChannel", "agentId",
  "productTitle", "optionTitle", "travelDate", "startTime", "paxSummary",
  "customer.firstName", "customer.lastName", "customer.email", "customer.phone", "customer.country", "customer.hotelName",
  "bookingStatus", "paymentStatus", "supplierStatus", "supplierStatusUpdatedAt", "bokunBookingId", "bokunConfirmationCode",
  "bokunStatus.normalized", "pendingCheckout.finalizationPending", "pendingCheckout.finalization.status",
  "cancellation.cancelledAt", "createdAt", "updatedAt"
].join(" ");

const STATE = Object.freeze({
  RECEIVED: "RECEIVED",
  UNDER_REVIEW: "UNDER_REVIEW",
  AWAITING_SUPPLIER: "AWAITING_SUPPLIER",
  AWAITING_FINANCE: "AWAITING_FINANCE",
  RESOLVED: "RESOLVED",
  REJECTED: "REJECTED"
});

// Internal workflow only. Nothing reaches RESOLVED without a review, and nothing returns to RECEIVED.
const TRANSITIONS = Object.freeze({
  RECEIVED: ["UNDER_REVIEW", "AWAITING_SUPPLIER", "AWAITING_FINANCE", "REJECTED"],
  UNDER_REVIEW: ["AWAITING_SUPPLIER", "AWAITING_FINANCE", "RESOLVED", "REJECTED"],
  AWAITING_SUPPLIER: ["UNDER_REVIEW", "AWAITING_FINANCE", "RESOLVED"],
  AWAITING_FINANCE: ["UNDER_REVIEW", "AWAITING_SUPPLIER", "RESOLVED"],
  RESOLVED: ["UNDER_REVIEW"],
  REJECTED: ["UNDER_REVIEW"]
});
const ESCALATION_TARGET = Object.freeze({ AWAITING_SUPPLIER: "SUPPLIER", AWAITING_FINANCE: "FINANCE" });
const REASON_REQUIRED = ["AWAITING_SUPPLIER", "AWAITING_FINANCE", "REJECTED"];
const CATEGORY_BY_TYPE = Object.freeze({
  reschedule: "date_change",
  cancel_booking: "cancellation",
  change_travelers: "traveler_change",
  combined_change: "other"
});
const MAX_NOTES = 200;
const MAX_HISTORY = 500;

const OPERATIONS_NOTICE =
  "Operations state is internal. It does not change the customer's request decision, and RESOLVED does not mean a supplier change, cancellation, payment adjustment or refund has happened: check the supplier and finance statuses.";

const notFound = (what = "Booking request") => new AppError(`${what} not found`, 404, "TOUR_OPERATIONS_NOT_FOUND");
const staleVersion = () =>
  new AppError("This request was changed by someone else. Reload it and try again.", 409, "TOUR_REQUEST_VERSION_CONFLICT");

const clampInt = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};
const escapeRegex = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Allowlisted operational view of a booking: no amounts, costs, commissions, invoices, payment
// transaction IDs, raw supplier/provider payloads or checkout internals.
const toTourBooking = (booking = {}) => {
  const { origin, basis } = resolveBookingOrigin(booking);
  return {
    id: String(booking._id),
    bookingReference: booking.bookingReference || "",
    origin,
    originBasis: basis,
    agentId: origin === "AGENT_PORTAL" && booking.agentId ? String(booking.agentId) : null,
    tour: {
      productTitle: booking.productTitle || "",
      optionTitle: booking.optionTitle || "",
      travelDate: booking.travelDate || "",
      startTime: booking.startTime || "",
      pax: {
        adults: Number(booking.paxSummary?.adults || 0),
        children: Number(booking.paxSummary?.children || 0),
        infants: Number(booking.paxSummary?.infants || 0),
        total: Number(booking.paxSummary?.total || 0)
      }
    },
    customer: {
      firstName: booking.customer?.firstName || "",
      lastName: booking.customer?.lastName || "",
      email: booking.customer?.email || "",
      phone: booking.customer?.phone || "",
      country: booking.customer?.country || "",
      hotelName: booking.customer?.hotelName || ""
    },
    status: {
      booking: booking.bookingStatus || "",
      payment: booking.paymentStatus || "",
      supplier: booking.supplierStatus || "",
      supplierUpdatedAt: booking.supplierStatusUpdatedAt || null,
      cancelledAt: booking.cancellation?.cancelledAt || null
    },
    supplierSync: {
      linkedToBokun: Boolean(booking.bokunBookingId),
      confirmationCode: booking.bokunConfirmationCode || "",
      bokunStatus: booking.bokunStatus?.normalized || "unknown",
      finalizationStatus: booking.pendingCheckout?.finalization?.status || "",
      finalizationPending: Boolean(booking.pendingCheckout?.finalizationPending)
    },
    createdAt: booking.createdAt || null,
    updatedAt: booking.updatedAt || null
  };
};

const operationsView = (request = {}) => {
  const operations = request.operations || {};
  const entry = (item = {}) => ({
    id: item._id ? String(item._id) : "",
    action: item.action,
    text: item.text || "",
    fromState: item.fromState || "",
    toState: item.toState || "",
    category: item.category || "",
    escalatedTo: item.escalatedTo || "",
    actorId: item.actorId,
    actorRole: item.actorRole,
    at: item.at
  });
  const state = operations.state || STATE.RECEIVED;
  return {
    state,
    // What this request may move to next, so clients offer only server-permitted actions.
    allowedTransitions: (TRANSITIONS[state] || []).map((toState) => ({
      toState,
      reasonRequired: REASON_REQUIRED.includes(toState),
      escalatesTo: ESCALATION_TARGET[toState] || ""
    })),
    category: operations.category || CATEGORY_BY_TYPE[request.type] || "other",
    categorySource: operations.category ? "operations" : "request_type",
    version: Number(operations.version || 0),
    notes: (operations.notes || []).map(entry),
    history: (operations.history || []).map(entry),
    updatedAt: operations.updatedAt || null,
    updatedBy: operations.updatedBy || null
  };
};

// Request view: workflow, customer input and status-only supplier/finance signals. Amounts, refund
// provider references, payment adjustments and staff decision notes stay in the Back Office.
const toTourRequest = (request = {}, booking = null) => ({
  id: String(request._id),
  requestReference: request.requestReference || "",
  type: request.type,
  customerStatus: request.status,
  createdAt: request.createdAt || null,
  updatedAt: request.updatedAt || null,
  requestedChanges: {
    date: request.requestedChanges?.date || "",
    startTime: request.requestedChanges?.startTime || "",
    travelers: request.requestedChanges?.travelers || null
  },
  original: {
    date: request.originalSnapshot?.date || "",
    startTime: request.originalSnapshot?.startTime || "",
    optionTitle: request.originalSnapshot?.optionTitle || "",
    travelers: request.originalSnapshot?.travelers || null
  },
  customerReason: request.customerReason || "",
  customerNotes: request.customerNotes || "",
  customerFacingDecision: request.adminDecision?.customerFacingReason || "",
  supplier: { syncStatus: request.bokunSync?.status || "not_required" },
  finance: {
    refundRequired: Boolean(request.refund?.required),
    refundStatus: request.refund?.status || "not_required",
    additionalPaymentRequired: Boolean(request.additionalPayment?.required),
    additionalPaymentStatus: request.additionalPayment?.status || "not_required"
  },
  operations: operationsView(request),
  notice: OPERATIONS_NOTICE,
  booking: booking ? toTourBooking(booking) : null
});

// Rewrites a booking filter so it applies to a looked-up booking embedded under `prefix`.
const prefixFilter = (filter, prefix) => {
  if (Array.isArray(filter)) return filter.map((item) => prefixFilter(item, prefix));
  return Object.entries(filter).reduce((result, [key, value]) => {
    if (["$and", "$or", "$nor"].includes(key)) return { ...result, [key]: prefixFilter(value, prefix) };
    return { ...result, [`${prefix}${key}`]: value };
  }, {});
};

const operationalBookingFilter = (origin = "") => originFilter(origin ? [origin] : OPERATIONAL_ORIGINS);

const listBookings = async ({ filters = {} } = {}) => {
  const page = clampInt(filters.page, 1, 1, 1000);
  const limit = clampInt(filters.limit, 25, 1, 100);
  const and = [operationalBookingFilter(filters.origin)];
  if (filters.bookingStatus) and.push({ bookingStatus: filters.bookingStatus });
  if (filters.paymentStatus) and.push({ paymentStatus: filters.paymentStatus });
  if (filters.supplierStatus) and.push({ supplierStatus: filters.supplierStatus });
  if (filters.travelDateFrom || filters.travelDateTo) {
    and.push({
      travelDate: {
        ...(filters.travelDateFrom ? { $gte: filters.travelDateFrom } : {}),
        ...(filters.travelDateTo ? { $lte: filters.travelDateTo } : {})
      }
    });
  }
  const search = String(filters.search || "").trim();
  if (search) {
    and.push(
      search.includes("@")
        ? { "customer.email": { $regex: `^${escapeRegex(search)}$`, $options: "i" } }
        : { bookingReference: search.toUpperCase() }
    );
  }
  const query = { $and: and };
  const [items, total] = await Promise.all([
    Booking.find(query).select(BOOKING_FIELDS).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Booking.countDocuments(query)
  ]);
  return { items: items.map(toTourBooking), page, limit, total, hasMore: page * limit < total };
};

const operationsStateFilter = (state) =>
  state === STATE.RECEIVED
    ? { $or: [{ "operations.state": STATE.RECEIVED }, { "operations.state": { $exists: false } }] }
    : { "operations.state": state };

const listRequests = async ({ filters = {} } = {}) => {
  const page = clampInt(filters.page, 1, 1, 1000);
  const limit = clampInt(filters.limit, 25, 1, 100);
  const requestMatch = { $and: [{}] };
  const bookingMatch = [prefixFilter(operationalBookingFilter(), "bookingDoc.")];
  if (filters.bookingReference) bookingMatch.push({ "bookingDoc.bookingReference": String(filters.bookingReference).trim().toUpperCase() });
  if (filters.type) requestMatch.$and.push({ type: filters.type });
  if (filters.customerStatus) requestMatch.$and.push({ status: filters.customerStatus });
  if (filters.state) requestMatch.$and.push(operationsStateFilter(filters.state));
  if (filters.category) {
    const types = Object.entries(CATEGORY_BY_TYPE).filter(([, category]) => category === filters.category).map(([type]) => type);
    requestMatch.$and.push({
      $or: [
        { "operations.category": filters.category },
        { "operations.category": { $exists: false }, type: { $in: types } }
      ]
    });
  }
  const bookingProjection = BOOKING_FIELDS.split(" ").reduce((projection, field) => ({ ...projection, [field]: 1 }), {});
  const [result] = await BookingRequest.aggregate([
    { $match: requestMatch },
    { $lookup: { from: Booking.collection.name, localField: "booking", foreignField: "_id", as: "bookingDoc" } },
    { $unwind: "$bookingDoc" },
    { $match: { $and: bookingMatch } },
    {
      $facet: {
        items: [
          { $sort: { createdAt: -1, _id: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          { $project: { ...prefixFilter(bookingProjection, "bookingDoc."), requestReference: 1, type: 1, status: 1, createdAt: 1, updatedAt: 1, requestedChanges: 1, originalSnapshot: 1, customerReason: 1, customerNotes: 1, "adminDecision.customerFacingReason": 1, "bokunSync.status": 1, "refund.required": 1, "refund.status": 1, "additionalPayment.required": 1, "additionalPayment.status": 1, operations: 1 } }
        ],
        total: [{ $count: "count" }]
      }
    }
  ]);
  const items = (result?.items || []).map((row) => {
    const request = { ...row, operations: row.operations ? { ...row.operations, notes: undefined, history: undefined } : undefined };
    const view = toTourRequest(request, row.bookingDoc);
    // Lists show the latest state only; full notes and history come from the detail endpoint.
    return { ...view, operations: { ...view.operations, notes: undefined, history: undefined, noteCount: (row.operations?.notes || []).length } };
  });
  const total = result?.total?.[0]?.count || 0;
  return { items, page, limit, total, hasMore: page * limit < total };
};

// The request and its booking, but only when the booking is a website or Agent Portal booking.
const loadScopedRequest = async (requestId) => {
  if (!mongoose.Types.ObjectId.isValid(String(requestId || ""))) throw notFound();
  const request = await BookingRequest.findById(requestId).lean();
  if (!request) throw notFound();
  const booking = await Booking.findOne({ $and: [{ _id: request.booking }, operationalBookingFilter()] }).select(BOOKING_FIELDS).lean();
  if (!booking) throw notFound();
  return { request, booking };
};

const getRequest = async ({ requestId }) => {
  const { request, booking } = await loadScopedRequest(requestId);
  const audit = await AuditLog.find({ entityType: "BookingRequest", entityId: String(request._id) })
    .select("action actorRole createdAt")
    .sort({ createdAt: 1 })
    .limit(500)
    .lean();
  return {
    ...toTourRequest(request, booking),
    // What happened to the request across all systems; payloads stay in the Back Office audit trail.
    auditTrail: audit.map((row) => ({ action: row.action, actorRole: row.actorRole, at: row.createdAt }))
  };
};

const actorOf = (auth = {}) => ({ actorId: String(auth.id || ""), actorRole: String(auth.role || "") });

const recordAudit = ({ auth, action, request, metadata }) =>
  AuditLog.create({
    ...actorOf(auth),
    action,
    entityType: "BookingRequest",
    entityId: String(request._id),
    reference: request.requestReference || "",
    metadata
  });

// Applies one versioned change to BookingRequest.operations only. A stale version (another operator
// or tab changed the request meanwhile) is rejected instead of silently overwriting their change.
const applyVersionedChange = async ({ request, expectedVersion, set = {}, push = {} }) => {
  const version = Number(request.operations?.version || 0);
  if (Number(expectedVersion) !== version) throw staleVersion();
  const versionMatch = version === 0
    ? { $or: [{ "operations.version": { $exists: false } }, { "operations.version": 0 }] }
    : { "operations.version": version };
  const updated = await BookingRequest.findOneAndUpdate(
    { $and: [{ _id: request._id }, versionMatch] },
    { $set: { ...set, "operations.version": version + 1 }, ...(Object.keys(push).length ? { $push: push } : {}) },
    { new: true, runValidators: true, timestamps: false }
  ).lean();
  if (!updated) throw staleVersion();
  return updated;
};

const historyPush = (entry) => ({ $each: [entry], $slice: -MAX_HISTORY });

const addNote = async ({ requestId, auth, text }) => {
  const { request, booking } = await loadScopedRequest(requestId);
  const at = new Date();
  const entry = { action: "note_added", text, ...actorOf(auth), at };
  // Notes are append-only and order-independent, so they do not need (or change) the version.
  const updated = await BookingRequest.findOneAndUpdate(
    { _id: request._id },
    {
      $push: {
        "operations.notes": { $each: [entry], $slice: -MAX_NOTES },
        "operations.history": historyPush({ ...entry, text: "" })
      },
      $set: { "operations.updatedAt": at, "operations.updatedBy": entry.actorId }
    },
    { new: true, runValidators: true, timestamps: false }
  ).lean();
  if (!updated) throw notFound();
  await recordAudit({ auth, action: "tour_request_note_added", request, metadata: { noteLength: text.length } });
  return toTourRequest(updated, booking);
};

const transition = async ({ requestId, auth, toState, expectedVersion, reason = "" }) => {
  const { request, booking } = await loadScopedRequest(requestId);
  // A client acting on an old view gets "reload", not a rule error about a state it never saw.
  if (Number(expectedVersion) !== Number(request.operations?.version || 0)) throw staleVersion();
  const fromState = request.operations?.state || STATE.RECEIVED;
  if (!(TRANSITIONS[fromState] || []).includes(toState)) {
    throw new AppError(`A request cannot move from ${fromState} to ${toState}.`, 422, "TOUR_REQUEST_TRANSITION_NOT_ALLOWED", { fromState, toState, allowed: TRANSITIONS[fromState] || [] });
  }
  if (REASON_REQUIRED.includes(toState) && reason.length < 3) {
    throw new AppError("Give a reason for this escalation or rejection.", 422, "TOUR_REQUEST_REASON_REQUIRED");
  }
  const at = new Date();
  const escalatedTo = ESCALATION_TARGET[toState] || "";
  const entry = {
    action: escalatedTo ? "escalated" : "state_changed",
    text: reason,
    fromState,
    toState,
    escalatedTo,
    ...actorOf(auth),
    at
  };
  const updated = await applyVersionedChange({
    request,
    expectedVersion,
    set: {
      "operations.state": toState,
      "operations.updatedAt": at,
      "operations.updatedBy": entry.actorId,
      ...(request.operations?.category ? {} : { "operations.category": CATEGORY_BY_TYPE[request.type] || "other" })
    },
    push: {
      "operations.history": historyPush(entry),
      ...(reason ? { "operations.notes": { $each: [{ ...entry, action: "note_added" }], $slice: -MAX_NOTES } } : {})
    }
  });
  await recordAudit({
    auth,
    action: escalatedTo ? "tour_request_escalated" : "tour_request_state_changed",
    request,
    metadata: { fromState, toState, escalatedTo }
  });
  return toTourRequest(updated, booking);
};

const setCategory = async ({ requestId, auth, category, expectedVersion }) => {
  const { request, booking } = await loadScopedRequest(requestId);
  const at = new Date();
  const fromCategory = request.operations?.category || CATEGORY_BY_TYPE[request.type] || "other";
  const entry = { action: "category_changed", category, text: "", fromState: "", toState: "", ...actorOf(auth), at };
  const updated = await applyVersionedChange({
    request,
    expectedVersion,
    set: {
      "operations.category": category,
      "operations.updatedAt": at,
      "operations.updatedBy": entry.actorId,
      ...(request.operations?.state ? {} : { "operations.state": STATE.RECEIVED })
    },
    push: { "operations.history": historyPush(entry) }
  });
  await recordAudit({ auth, action: "tour_request_categorized", request, metadata: { fromCategory, category } });
  return toTourRequest(updated, booking);
};

module.exports = {
  STATE,
  TRANSITIONS,
  OPERATIONS_NOTICE,
  listBookings,
  listRequests,
  getRequest,
  addNote,
  transition,
  setCategory,
  __testables: { toTourBooking, toTourRequest, prefixFilter }
};
