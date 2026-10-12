const mongoose = require("mongoose");
const Booking = require("../../models/Booking");
const BookingRequest = require("../../models/BookingRequest");
const AuditLog = require("../../models/AuditLog");
const AppError = require("../../utils/AppError");
const tourOperations = require("../tourOperations");

// Finance escalation queue: customer booking requests that Tour Operations escalated to Finance
// (BookingRequest.operations, Phase 3A). Read-only. It reads the existing requests and bookings and
// never changes them: Finance acts through its existing screens, and nothing here refunds, charges,
// cancels, re-dates, re-invoices, posts to the ledger or closes a request.

const FINANCE = "FINANCE";
const AWAITING_FINANCE = "AWAITING_FINANCE";

// Request fields Finance may see. Provider payloads, supplier request/response bodies, refund provider
// references and staff-only notes are never selected.
const REQUEST_FIELDS = [
  "_id", "requestReference", "booking", "type", "status", "createdAt", "updatedAt",
  "originalSnapshot", "requestedChanges", "customerReason", "customerNotes",
  "adminDecision.decision", "adminDecision.customerFacingReason", "adminDecision.decidedAt",
  "refund.required", "refund.status", "refund.estimatedAmount", "refund.eligibleAmount", "refund.approvedAmount",
  "refund.requestedAmount", "refund.confirmedRefundedAmount", "refund.cancellationFee", "refund.providerLabel",
  "additionalPayment.required", "additionalPayment.status",
  "priceAdjustment.originalAmount", "priceAdjustment.newAmount", "priceAdjustment.difference", "priceAdjustment.type",
  "bokunSync.status", "bokunSync.lastAttemptAt", "bokunSync.syncedAt",
  "operations"
].join(" ");

// The operational booking view plus the invoice summary Finance already sees in Booking Accounting.
const BOOKING_FIELDS = [
  tourOperations.BOOKING_FIELDS,
  "currency transactionCurrency",
  "invoiceSnapshot.invoiceNumber invoiceSnapshot.total invoiceSnapshot.amountPaid invoiceSnapshot.amountRefunded",
  "invoiceSnapshot.balanceDue invoiceSnapshot.paymentStatus"
].join(" ");

const CATEGORY_BY_TYPE = Object.freeze({
  reschedule: "date_change",
  cancel_booking: "cancellation",
  change_travelers: "traveler_change",
  combined_change: "other"
});

// Currently awaiting Finance, or escalated to Finance at some point (then moved on by Tour Operations).
const EVER_ESCALATED = Object.freeze({ $or: [{ "operations.state": AWAITING_FINANCE }, { "operations.history.escalatedTo": FINANCE }] });

const notFound = () => new AppError("Escalated request not found", 404, "FINANCE_ESCALATION_NOT_FOUND");
const clampInt = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
};
// Amounts are reported only when they were recorded; a missing amount stays null.
const amount = (value) => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));

const escalationEntries = (request = {}) =>
  (request.operations?.history || []).filter((entry) => entry.escalatedTo === FINANCE);

// The most recent escalation to Finance as recorded by Tour Operations, or null when none is recorded.
const latestEscalation = (request = {}) => {
  const entries = escalationEntries(request);
  const entry = entries[entries.length - 1];
  if (!entry) return null;
  return {
    reason: entry.text || "",
    at: entry.at || null,
    fromState: entry.fromState || "",
    actorId: entry.actorId || "",
    actorRole: entry.actorRole || ""
  };
};

const bookingSummary = (booking) => {
  if (!booking) return null;
  const view = tourOperations.toTourBooking(booking);
  return {
    bookingReference: view.bookingReference,
    origin: view.origin,
    originBasis: view.originBasis,
    agentId: view.agentId,
    tour: view.tour,
    customer: view.customer,
    status: view.status,
    supplierSync: view.supplierSync
  };
};

const toQueueItem = (request, booking) => ({
  id: String(request._id),
  requestReference: request.requestReference || "",
  type: request.type,
  category: request.operations?.category || CATEGORY_BY_TYPE[request.type] || "other",
  state: request.operations?.state || "RECEIVED",
  customerStatus: request.status,
  submittedAt: request.createdAt || null,
  escalation: latestEscalation(request),
  escalationCount: escalationEntries(request).length,
  finance: {
    refundRequired: Boolean(request.refund?.required),
    refundStatus: request.refund?.status || "not_required",
    additionalPaymentRequired: Boolean(request.additionalPayment?.required),
    additionalPaymentStatus: request.additionalPayment?.status || "not_required"
  },
  supplier: { syncStatus: request.bokunSync?.status || "not_required" },
  booking: bookingSummary(booking)
});

const queueFilter = (filters = {}) => {
  const and = [
    filters.scope === "all" ? EVER_ESCALATED : { "operations.state": AWAITING_FINANCE }
  ];
  if (filters.type) and.push({ type: filters.type });
  if (filters.category) {
    const types = Object.entries(CATEGORY_BY_TYPE).filter(([, category]) => category === filters.category).map(([type]) => type);
    and.push({ $or: [{ "operations.category": filters.category }, { "operations.category": { $exists: false }, type: { $in: types } }] });
  }
  if (filters.requestReference) and.push({ requestReference: String(filters.requestReference).trim() });
  return { $and: and };
};

const listEscalations = async ({ filters = {} } = {}) => {
  const page = clampInt(filters.page, 1, 1, 1000);
  const limit = clampInt(filters.limit, 25, 1, 100);
  const query = queueFilter(filters);
  if (filters.bookingReference) {
    const booking = await Booking.findOne({ bookingReference: String(filters.bookingReference).trim().toUpperCase() }).select("_id").lean();
    if (!booking) return { items: [], page, limit, total: 0, hasMore: false };
    query.$and.push({ booking: booking._id });
  }
  const [requests, total] = await Promise.all([
    BookingRequest.find(query).select(REQUEST_FIELDS).sort({ "operations.updatedAt": -1, createdAt: -1, _id: -1 })
      .skip((page - 1) * limit).limit(limit).lean(),
    BookingRequest.countDocuments(query)
  ]);
  const bookings = await Booking.find({ _id: { $in: requests.map((request) => request.booking) } }).select(BOOKING_FIELDS).lean();
  const byId = new Map(bookings.map((booking) => [String(booking._id), booking]));
  return {
    items: requests.map((request) => toQueueItem(request, byId.get(String(request.booking)))),
    page,
    limit,
    total,
    hasMore: page * limit < total
  };
};

const financeEvidence = (request, booking) => {
  const currency = request.originalSnapshot?.currency || booking?.transactionCurrency || booking?.currency || "";
  const invoice = booking?.invoiceSnapshot || {};
  return {
    currency,
    refund: {
      required: Boolean(request.refund?.required),
      status: request.refund?.status || "not_required",
      estimatedAmount: amount(request.refund?.estimatedAmount),
      eligibleAmount: amount(request.refund?.eligibleAmount),
      approvedAmount: amount(request.refund?.approvedAmount),
      requestedAmount: amount(request.refund?.requestedAmount),
      confirmedRefundedAmount: amount(request.refund?.confirmedRefundedAmount),
      cancellationFee: amount(request.refund?.cancellationFee),
      providerLabel: request.refund?.providerLabel || ""
    },
    additionalPayment: {
      required: Boolean(request.additionalPayment?.required),
      status: request.additionalPayment?.status || "not_required"
    },
    priceAdjustment: {
      type: request.priceAdjustment?.type || "unknown",
      originalAmount: amount(request.priceAdjustment?.originalAmount),
      newAmount: amount(request.priceAdjustment?.newAmount),
      difference: amount(request.priceAdjustment?.difference)
    },
    invoice: invoice.invoiceNumber
      ? {
          invoiceNumber: invoice.invoiceNumber,
          paymentStatus: invoice.paymentStatus || "",
          total: amount(invoice.total),
          amountPaid: amount(invoice.amountPaid),
          amountRefunded: amount(invoice.amountRefunded),
          balanceDue: amount(invoice.balanceDue)
        }
      : null
  };
};

const getEscalation = async ({ requestId }) => {
  if (!mongoose.Types.ObjectId.isValid(String(requestId || ""))) throw notFound();
  // Only requests that are, or have been, escalated to Finance are part of this queue.
  const request = await BookingRequest.findOne({ $and: [{ _id: requestId }, EVER_ESCALATED] }).select(REQUEST_FIELDS).lean();
  if (!request) throw notFound();
  const [booking, audit] = await Promise.all([
    Booking.findById(request.booking).select(BOOKING_FIELDS).lean(),
    AuditLog.find({ entityType: "BookingRequest", entityId: String(request._id) }).select("action actorRole createdAt").sort({ createdAt: 1 }).limit(500).lean()
  ]);
  const operations = tourOperations.operationsView(request);
  return {
    ...toQueueItem(request, booking),
    request: {
      original: {
        date: request.originalSnapshot?.date || "",
        startTime: request.originalSnapshot?.startTime || "",
        optionTitle: request.originalSnapshot?.optionTitle || "",
        travelers: request.originalSnapshot?.travelers || null
      },
      requestedChanges: {
        date: request.requestedChanges?.date || "",
        startTime: request.requestedChanges?.startTime || "",
        travelers: request.requestedChanges?.travelers || null
      },
      customerReason: request.customerReason || "",
      customerNotes: request.customerNotes || "",
      decision: {
        decision: request.adminDecision?.decision || "",
        customerFacingReason: request.adminDecision?.customerFacingReason || "",
        decidedAt: request.adminDecision?.decidedAt || null
      }
    },
    supplier: {
      syncStatus: request.bokunSync?.status || "not_required",
      lastAttemptAt: request.bokunSync?.lastAttemptAt || null,
      syncedAt: request.bokunSync?.syncedAt || null
    },
    escalations: (operations.history || []).filter((entry) => entry.escalatedTo),
    // Finance reviews here; workflow moves stay with Tour Operations, so no transitions are offered.
    operations: { state: operations.state, category: operations.category, version: operations.version, notes: operations.notes, history: operations.history, updatedAt: operations.updatedAt },
    financeEvidence: financeEvidence(request, booking),
    auditTrail: audit.map((row) => ({ action: row.action, actorRole: row.actorRole, at: row.createdAt })),
    notice: "Review only. Escalation does not refund, charge, cancel, re-date or re-invoice anything. Use the existing Back Office request and Finance screens for any action."
  };
};

module.exports = { listEscalations, getEscalation, latestEscalation, AWAITING_FINANCE };
