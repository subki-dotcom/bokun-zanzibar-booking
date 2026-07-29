const crypto = require("crypto");
const dayjs = require("dayjs");
const Booking = require("../../models/Booking");
const BookingRequest = require("../../models/BookingRequest");
const Refund = require("../../models/Refund");
const PaymentAdjustment = require("../../models/PaymentAdjustment");
const Payment = require("../../models/Payment");
const Invoice = require("../../models/Invoice");
const AuditLog = require("../../models/AuditLog");
const ProductSnapshot = require("../../models/ProductSnapshot");
const AppError = require("../../utils/AppError");
const bokunService = require("../bokun");
const paymentsService = require("../payments");
const bookingsService = require("../bookings");
const refundsService = require("../refunds");
const emailService = require("../email");
const { env } = require("../../config/env");
const { ACTIVE_REQUEST_STATUSES, assertTransition } = require("./status");
const { calculateCancellationPolicy, getTravelStart } = require("./cancellationPolicy");

const requestReference = () => `BRQ-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
const refundReference = () => `RFD-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
const adjustmentReference = () => `ADJ-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
const syncKey = () => crypto.randomUUID();

const normalizeEmail = (value = "") => String(value || "").trim().toLowerCase();
const number = (value = 0) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const travelerTotal = (travelers = {}) => number(travelers.adults) + number(travelers.children) + number(travelers.infants);

const toPublicCancellationPolicy = (policy = {}) => {
  if (!policy) return null;
  const { bokunProductId, bokunOptionId, bokunBookingId, rawPolicy, ...safePolicy } = policy;
  return safePolicy;
};

const recordAudit = async ({ action, request, booking, auth = null, requestId = "", reason = "", before = null, after = null, metadata = {} }) =>
  AuditLog.create({
    actorId: auth?.id || null,
    actorRole: auth?.role || "customer",
    action,
    entityType: "BookingRequest",
    entityId: request._id.toString(),
    reason,
    requestId,
    before,
    after,
    metadata: { bookingId: booking?._id?.toString() || "", bookingReference: booking?.bookingReference || "", ...metadata }
  });

const queueRequestEmail = ({ booking, request, templateKey }) => {
  if (!booking?.customer?.email || !request?._id) return;
  request.lastEmailTemplate = templateKey;
  const emailRequest = typeof request.toObject === "function"
    ? request.toObject()
    : { ...request };
  emailRequest.lastEmailTemplate = templateKey;
  void BookingRequest.updateOne({ _id: request._id }, { $set: { lastEmailTemplate: templateKey } }).catch(() => null);
  void emailService.sendBookingRequestEmailOnce({ booking, request: emailRequest, templateKey }).catch(() => null);
};

const assertCustomerOwnership = ({ booking, customerEmail }) => {
  if (normalizeEmail(customerEmail) !== normalizeEmail(booking?.customer?.email)) {
    throw new AppError("We could not verify this booking for that email address.", 403, "BOOKING_OWNERSHIP_NOT_VERIFIED");
  }
};

const assertRequestableBooking = (booking) => {
  if (!booking) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
  if (booking.bookingStatus === "cancelled") throw new AppError("This booking has already been cancelled.", 409, "BOOKING_ALREADY_CANCELLED");
  if (booking.paymentStatus !== "paid") throw new AppError("Booking changes are available after payment is confirmed.", 409, "BOOKING_PAYMENT_NOT_RESOLVED");
  const start = getTravelStart(booking);
  if (start && !start.isAfter(dayjs())) {
    throw new AppError("This tour has already started, so it can no longer be changed online.", 409, "TOUR_ALREADY_STARTED");
  }
};

const snapshotBooking = (booking) => ({
  date: booking.travelDate,
  startTime: booking.startTime || "",
  travelers: {
    adults: number(booking.paxSummary?.adults),
    children: number(booking.paxSummary?.children),
    infants: number(booking.paxSummary?.infants),
    childAges: []
  },
  optionId: booking.bokunOptionId,
  optionTitle: booking.optionTitle,
  pickup: { hotelName: booking.customer?.hotelName || "", pickupPlaceId: booking.customer?.pickupPlaceId || "" },
  totalAmount: number(booking.amount || booking.pricingSnapshot?.finalPayable),
  amountPaid: number(booking.invoiceSnapshot?.amountPaid),
  currency: booking.currency || booking.pricingSnapshot?.currency || "USD"
});

const ensureRequestWorkflowDefaults = (request, booking = null) => {
  if (!request) return request;
  const bookingAmount = number(booking?.amount || booking?.pricingSnapshot?.finalPayable || request.originalSnapshot?.totalAmount);

  if (!request.originalSnapshot && booking) {
    request.originalSnapshot = snapshotBooking(booking);
  }
  if (!String(request.customerReason || "").trim()) {
    request.customerReason = request.type === "cancel_booking"
      ? "Customer requested cancellation"
      : "Customer requested a booking change";
  }
  if (request.customerNotes === undefined || request.customerNotes === null) request.customerNotes = "";
  if (!request.requestedChanges) request.requestedChanges = {};

  if (!request.priceAdjustment) request.priceAdjustment = {};
  if (request.priceAdjustment.originalAmount === undefined || request.priceAdjustment.originalAmount === null) {
    request.priceAdjustment.originalAmount = bookingAmount;
  }
  if (request.priceAdjustment.newAmount === undefined) request.priceAdjustment.newAmount = null;
  if (request.priceAdjustment.difference === undefined) request.priceAdjustment.difference = null;
  if (!["none", "additional_payment", "refund", "unknown"].includes(String(request.priceAdjustment.type || ""))) {
    request.priceAdjustment.type = "unknown";
  }
  if (request.priceAdjustment.adminOverrideAmount === undefined) request.priceAdjustment.adminOverrideAmount = null;
  if (request.priceAdjustment.adminOverrideReason === undefined) request.priceAdjustment.adminOverrideReason = "";

  if (!request.refund) request.refund = {};
  if (request.refund.required === undefined || request.refund.required === null) request.refund.required = false;
  if (request.refund.estimatedAmount === undefined || request.refund.estimatedAmount === null) request.refund.estimatedAmount = 0;
  if (request.refund.eligibleAmount === undefined) {
    request.refund.eligibleAmount = request.refund.estimatedAmount > 0 ? number(request.refund.estimatedAmount) : null;
  }
  if (request.refund.approvedAmount === undefined) request.refund.approvedAmount = null;
  if (request.refund.requestedAmount === undefined || request.refund.requestedAmount === null) request.refund.requestedAmount = 0;
  if (request.refund.confirmedRefundedAmount === undefined || request.refund.confirmedRefundedAmount === null) request.refund.confirmedRefundedAmount = 0;
  if (request.refund.cancellationFee === undefined) request.refund.cancellationFee = null;
  if (request.refund.provider === undefined) request.refund.provider = "";
  if (request.refund.providerLabel === undefined) request.refund.providerLabel = "";
  if (!request.refund.status) {
    request.refund.status = request.type === "cancel_booking" && number(request.refund.estimatedAmount) > 0 ? "eligible" : "not_required";
  }

  if (!request.additionalPayment) request.additionalPayment = {};
  if (request.additionalPayment.required === undefined || request.additionalPayment.required === null) request.additionalPayment.required = false;
  if (request.additionalPayment.status === undefined || request.additionalPayment.status === null) request.additionalPayment.status = "not_required";

  if (!request.bokunSync) request.bokunSync = {};
  if (!request.bokunSync.status || (request.type === "cancel_booking" && request.bokunSync.status === "not_required")) {
    request.bokunSync.status = request.type === "cancel_booking" ? "pending" : "not_required";
  }
  if (request.bokunSync.attempts === undefined || request.bokunSync.attempts === null) request.bokunSync.attempts = 0;
  if (request.bokunSync.lastAttemptAt === undefined) request.bokunSync.lastAttemptAt = null;
  if (request.bokunSync.syncedAt === undefined) request.bokunSync.syncedAt = null;
  if (request.bokunSync.lastError === undefined) request.bokunSync.lastError = "";
  if (!request.bokunSync.idempotencyKey) request.bokunSync.idempotencyKey = syncKey();
  if (request.bokunSync.bokunBookingId === undefined) request.bokunSync.bokunBookingId = booking?.bokunBookingId || "";
  if (request.bokunSync.bokunConfirmationCode === undefined) request.bokunSync.bokunConfirmationCode = booking?.bokunConfirmationCode || "";

  if (!request.adminDecision) request.adminDecision = {};
  if (request.adminDecision.decision === undefined) request.adminDecision.decision = "";
  if (request.adminDecision.customerFacingReason === undefined) request.adminDecision.customerFacingReason = "";
  if (request.adminDecision.internalNote === undefined) request.adminDecision.internalNote = "";
  if (request.adminDecision.decidedAt === undefined) request.adminDecision.decidedAt = null;

  if (!request.processingLock) request.processingLock = {};
  if (request.processingLock.lockedAt === undefined) request.processingLock.lockedAt = null;
  if (request.processingLock.lockedBy === undefined) request.processingLock.lockedBy = null;
  if (request.processingLock.action === undefined) request.processingLock.action = "";

  return request;
};

const publicRequest = (request) => ({
  id: request._id,
  requestReference: request.requestReference,
  type: request.type,
  status: request.status,
  originalSnapshot: request.originalSnapshot,
  requestedChanges: request.requestedChanges,
  customerReason: request.customerReason,
  customerNotes: request.customerNotes,
  cancellationPolicySnapshot: toPublicCancellationPolicy(request.cancellationPolicySnapshot),
  priceAdjustment: request.priceAdjustment,
  refund: {
    required: request.refund?.required,
    estimatedAmount: request.refund?.estimatedAmount,
    eligibleAmount: request.refund?.eligibleAmount ?? request.refund?.estimatedAmount,
    approvedAmount: request.refund?.approvedAmount ?? null,
    requestedAmount: request.refund?.requestedAmount ?? 0,
    confirmedRefundedAmount: request.refund?.confirmedRefundedAmount ?? 0,
    cancellationFee: request.refund?.cancellationFee ?? null,
    provider: request.refund?.provider || "",
    providerLabel: request.refund?.providerLabel || "",
    status: request.refund?.status
  },
  additionalPayment: { required: request.additionalPayment?.required, status: request.additionalPayment?.status },
  bokunSync: {
    status: request.bokunSync?.status,
    lastError: request.bokunSync?.status === "failed" ? "Supplier update needs attention." : "",
    syncedAt: request.bokunSync?.syncedAt || null
  },
  adminDecision: {
    decision: request.adminDecision?.decision || "",
    customerFacingReason: request.adminDecision?.customerFacingReason || "",
    decidedAt: request.adminDecision?.decidedAt || null
  },
  completedAt: request.completedAt,
  createdAt: request.createdAt,
  updatedAt: request.updatedAt
});

const validateRequestedChanges = ({ type, booking, requestedChanges = {} }) => {
  const changes = {
    date: String(requestedChanges.date || "").trim(),
    startTime: String(requestedChanges.startTime || "").trim(),
    travelers: requestedChanges.travelers || null
  };
  const needsSchedule = ["reschedule", "combined_change"].includes(type);
  const needsTravelers = ["change_travelers", "combined_change"].includes(type);

  if (needsSchedule) {
    if (!changes.date) throw new AppError("Please choose a requested travel date.", 422, "REQUESTED_DATE_REQUIRED");
    if (dayjs(changes.date).isBefore(dayjs().startOf("day"))) throw new AppError("Requested travel date cannot be in the past.", 422, "REQUESTED_DATE_IN_PAST");
    if (changes.date === booking.travelDate && String(changes.startTime || "") === String(booking.startTime || "")) {
      throw new AppError("Choose a different date or start time.", 422, "REQUESTED_CHANGE_UNCHANGED");
    }
  }

  if (needsTravelers) {
    const travelers = {
      adults: number(changes.travelers?.adults),
      children: number(changes.travelers?.children),
      infants: number(changes.travelers?.infants),
      childAges: Array.isArray(changes.travelers?.childAges) ? changes.travelers.childAges.map(number) : []
    };
    if ([travelers.adults, travelers.children, travelers.infants].some((value) => value < 0 || !Number.isInteger(value))) {
      throw new AppError("Traveler quantities must be whole positive numbers.", 422, "INVALID_TRAVELER_COUNT");
    }
    if (travelerTotal(travelers) < 1) throw new AppError("At least one traveler is required.", 422, "TRAVELERS_REQUIRED");
    if (travelers.childAges.length && travelers.childAges.length !== travelers.children) {
      throw new AppError("Add an age for every child or leave child ages empty.", 422, "CHILD_AGES_MISMATCH");
    }
    changes.travelers = travelers;
  } else {
    delete changes.travelers;
  }

  if (!needsSchedule) {
    delete changes.date;
    delete changes.startTime;
  }
  return changes;
};

const findBookingForCustomer = async ({ bookingId, customerEmail }) => {
  const booking = await Booking.findById(bookingId);
  assertRequestableBooking(booking);
  assertCustomerOwnership({ booking, customerEmail });
  return booking;
};

const submitRequest = async ({ bookingId, customerEmail, payload, requestId = "" }) => {
  const booking = await findBookingForCustomer({ bookingId, customerEmail });
  const existing = await BookingRequest.findOne({ booking: booking._id, type: payload.type, status: { $in: ACTIVE_REQUEST_STATUSES } });
  if (existing) throw new AppError("There is already an active request of this type for this booking.", 409, "ACTIVE_BOOKING_REQUEST_EXISTS");

  const requestedChanges = validateRequestedChanges({ type: payload.type, booking, requestedChanges: payload.requestedChanges });
  const isCancellation = payload.type === "cancel_booking";
  if (isCancellation && payload.cancellationConfirmed !== true) {
    throw new AppError("Please confirm that a cancellation request does not guarantee a full refund.", 422, "CANCELLATION_CONFIRMATION_REQUIRED");
  }
  if (payload.cancellationReason === "other" && !String(payload.customerReason || "").trim()) {
    throw new AppError("Please explain the cancellation reason.", 422, "CANCELLATION_REASON_REQUIRED");
  }
  const verifiedPaidAmount = isCancellation
    ? await paymentsService.getVerifiedPaidAmountByBookingReference({ bookingReference: booking.bookingReference })
    : 0;
  const productSnapshot = isCancellation
    ? await ProductSnapshot.findOne({ bokunProductId: booking.bokunProductId }).lean()
    : null;
  const policy = isCancellation
    ? calculateCancellationPolicy({ booking, productSnapshot, amountPaid: verifiedPaidAmount })
    : null;
  const estimatedRefundAmount = policy?.estimatedRefundAmount;
  const refundStatus = !isCancellation
    ? "not_required"
    : estimatedRefundAmount === null || policy.requiresManualReview
      ? "manual_review"
      : Number(estimatedRefundAmount || 0) > 0
        ? "eligible"
        : "not_required";
  let request;
  try {
    request = await BookingRequest.create({
      requestReference: requestReference(),
      booking: booking._id,
      customer: booking.customer?.customerId || null,
      type: payload.type,
      activeRequestKey: `${booking._id}:${payload.type}`,
      originalSnapshot: snapshotBooking(booking),
      requestedChanges,
      customerReason: String(payload.customerReason || "").trim(),
      customerNotes: String(payload.customerNotes || "").trim(),
      attachments: payload.attachments || [],
      cancellationPolicySnapshot: policy,
      priceAdjustment: { originalAmount: number(booking.amount || booking.pricingSnapshot?.finalPayable), type: "unknown" },
      refund: isCancellation ? {
        required: Number(estimatedRefundAmount || 0) > 0,
        estimatedAmount: number(estimatedRefundAmount || 0),
        eligibleAmount: estimatedRefundAmount === null ? null : number(estimatedRefundAmount || 0),
        approvedAmount: null,
        requestedAmount: 0,
        confirmedRefundedAmount: 0,
        cancellationFee: policy?.estimatedCancellationFee === null || policy?.estimatedCancellationFee === undefined ? null : number(policy.estimatedCancellationFee),
        status: refundStatus
      } : undefined,
      bokunSync: { status: "pending", idempotencyKey: syncKey(), bokunBookingId: booking.bokunBookingId || "", bokunConfirmationCode: booking.bokunConfirmationCode || "" }
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw new AppError("There is already an active request of this type for this booking.", 409, "ACTIVE_BOOKING_REQUEST_EXISTS");
    }
    throw error;
  }
  await recordAudit({ action: "booking_request_submitted", request, booking, requestId, reason: request.customerReason });
  queueRequestEmail({ booking, request, templateKey: "request_received" });
  return publicRequest(request);
};

const listCustomerRequests = async ({ bookingId, customerEmail }) => {
  const booking = await findBookingForCustomer({ bookingId, customerEmail });
  const rows = await BookingRequest.find({ booking: booking._id }).sort({ createdAt: -1 }).lean();
  return rows.map(publicRequest);
};

const getCancellationEstimate = async ({ bookingId, customerEmail }) => {
  const booking = await findBookingForCustomer({ bookingId, customerEmail });
  const amountPaid = await paymentsService.getVerifiedPaidAmountByBookingReference({ bookingReference: booking.bookingReference });
  const productSnapshot = await ProductSnapshot.findOne({ bokunProductId: booking.bokunProductId }).lean();
  return toPublicCancellationPolicy(calculateCancellationPolicy({ booking, productSnapshot, amountPaid }));
};

const getCustomerRequest = async ({ requestId, customerEmail }) => {
  const request = await BookingRequest.findById(requestId).lean();
  if (!request) throw new AppError("Booking request not found", 404, "BOOKING_REQUEST_NOT_FOUND");
  const booking = await Booking.findById(request.booking).lean();
  assertCustomerOwnership({ booking, customerEmail });
  return publicRequest(request);
};

const customerResponse = async ({ requestId, customerEmail, notes, traceId = "" }) => {
  const request = await BookingRequest.findById(requestId);
  if (!request) throw new AppError("Booking request not found", 404, "BOOKING_REQUEST_NOT_FOUND");
  const booking = await Booking.findById(request.booking);
  assertCustomerOwnership({ booking, customerEmail });
  assertTransition({ from: request.status, to: "under_review" });
  const before = { status: request.status };
  request.customerNotes = [request.customerNotes, String(notes || "").trim()].filter(Boolean).join("\n\n").slice(-2500);
  request.status = "under_review";
  await request.save();
  await recordAudit({ action: "booking_request_customer_information_received", request, booking, requestId: traceId, before, after: { status: request.status } });
  queueRequestEmail({ booking, request, templateKey: "request_under_review" });
  return publicRequest(request);
};

const cancelCustomerRequest = async ({ requestId, customerEmail, traceId = "" }) => {
  const request = await BookingRequest.findById(requestId);
  if (!request) throw new AppError("Booking request not found", 404, "BOOKING_REQUEST_NOT_FOUND");
  const booking = await Booking.findById(request.booking);
  assertCustomerOwnership({ booking, customerEmail });
  assertTransition({ from: request.status, to: "cancelled_by_customer" });
  request.status = "cancelled_by_customer";
  request.activeRequestKey = undefined;
  await request.save();
  await recordAudit({ action: "booking_request_cancelled_by_customer", request, booking, requestId: traceId });
  return publicRequest(request);
};

const adminListRequests = async ({ filters = {} } = {}) => {
  const query = {};
  if (filters.type) query.type = filters.type;
  if (filters.status) query.status = filters.status;
  if (filters.refundStatus) query["refund.status"] = filters.refundStatus;
  if (filters.bokunStatus) query["bokunSync.status"] = filters.bokunStatus;
  const search = String(filters.search || "").trim();
  if (search) {
    const matchingBookings = await Booking.find({
      $or: [
        { bookingReference: { $regex: search, $options: "i" } },
        { bokunBookingId: { $regex: search, $options: "i" } },
        { "customer.email": { $regex: search, $options: "i" } },
        { "customer.firstName": { $regex: search, $options: "i" } },
        { "customer.lastName": { $regex: search, $options: "i" } }
      ]
    }).select("_id").lean();
    query.$or = [{ requestReference: { $regex: search, $options: "i" } }, { booking: { $in: matchingBookings.map((booking) => booking._id) } }];
  }
  return BookingRequest.find(query).populate("booking", "bookingReference productTitle travelDate customer amount currency paymentStatus bokunBookingId invoiceSnapshot").sort({ createdAt: -1 }).limit(Math.min(Math.max(number(filters.limit) || 100, 1), 200)).lean();
};

const adminGetRequest = async ({ requestId }) => {
  const request = await BookingRequest.findById(requestId)
    .populate("booking")
    .populate("customer", "firstName lastName email phone country")
    .populate("refund.refundId")
    .populate("additionalPayment.paymentAdjustmentId")
    .lean();
  if (!request) throw new AppError("Booking request not found", 404, "BOOKING_REQUEST_NOT_FOUND");
  ensureRequestWorkflowDefaults(request, request.booking);
  const [payments, invoice, audit] = await Promise.all([
    Payment.find({ bookingReference: request.booking.bookingReference }).sort({ createdAt: -1 }).lean(),
    Invoice.findOne({ bookingReference: request.booking.bookingReference }).lean(),
    AuditLog.find({ entityType: "BookingRequest", entityId: String(request._id) }).sort({ createdAt: 1 }).lean()
  ]);
  let refundContext = null;
  if (request.type === "cancel_booking") {
    try {
      refundContext = await refundsService.resolveRefundContext({
        booking: request.booking,
        eligibleRefundAmount: request.refund?.eligibleAmount ?? request.refund?.estimatedAmount ?? request.cancellationPolicySnapshot?.estimatedRefundAmount ?? null,
        approvedRefundAmount: request.refund?.approvedAmount ?? null
      });
    } catch (error) {
      refundContext = {
        requiresManualReview: true,
        manualReviewReason: "Refund provider and amount require manual review.",
        eligibleRefundAmount: request.refund?.eligibleAmount ?? null,
        defaultApprovedRefundAmount: null,
        provider: "",
        providerLabel: "",
        providerKnown: false
      };
    }
  }
  return { request, payments, invoice, audit, refundContext };
};

const withAdminLock = async ({ requestId, auth, action, callback }) => {
  const request = await BookingRequest.findOneAndUpdate(
    { _id: requestId, "processingLock.lockedAt": null },
    { $set: { "processingLock.lockedAt": new Date(), "processingLock.lockedBy": auth?.id || null, "processingLock.action": action } },
    { new: true }
  );
  if (!request) throw new AppError("This request is currently being processed by another admin.", 409, "BOOKING_REQUEST_LOCKED");
  try {
    return await callback(request);
  } finally {
    await BookingRequest.findByIdAndUpdate(request._id, { $set: { "processingLock.lockedAt": null, "processingLock.lockedBy": null, "processingLock.action": "" } });
  }
};

const checkAvailabilityAndPrice = async ({ request, booking, requestId = "" }) => {
  ensureRequestWorkflowDefaults(request, booking);
  if (request.type === "cancel_booking") return { available: true, pricing: null };
  const targetDate = request.requestedChanges?.date || booking.travelDate;
  const targetTime = request.requestedChanges?.startTime || booking.startTime;
  const targetTravelers = request.requestedChanges?.travelers || request.originalSnapshot?.travelers || {};
  request.bokunSync.status = "checking_availability";
  request.bokunSync.lastAttemptAt = new Date();
  await request.save();
  const availability = await bokunService.fetchAvailability({
    productId: booking.bokunProductId,
    optionId: booking.bokunOptionId,
    travelDate: targetDate,
    startTime: targetTime,
    pax: targetTravelers
  }, requestId);
  const available = Boolean(availability?.available);
  request.bokunSync.status = available ? "available" : "unavailable";
  request.bokunSync.responseSnapshot = { available, travelDate: targetDate, startTime: targetTime, pricing: availability?.pricing || null };
  request.bokunSync.lastError = available ? "" : "The selected date, time, or traveler count is unavailable.";
  if (available) {
    const originalAmount = number(request.originalSnapshot?.totalAmount);
    const newAmount = number(availability?.pricing?.finalPayable || availability?.pricing?.grossAmount || availability?.pricing?.baseAmount);
    request.priceAdjustment.originalAmount = originalAmount;
    request.priceAdjustment.newAmount = newAmount || null;
    request.priceAdjustment.difference = newAmount ? Number((newAmount - originalAmount).toFixed(2)) : null;
    request.priceAdjustment.type = newAmount === originalAmount ? "none" : newAmount > originalAmount ? "additional_payment" : "refund";
    request.priceAdjustment.checkedAt = new Date();
  }
  await request.save();
  return { available, pricing: availability?.pricing || null, request };
};

const isBokunCancellationConfirmed = (response = {}) => {
  if (response === null || response === undefined || response === "") return true;
  if (typeof response === "string") return /cancel|void|success|accepted|ok/i.test(response);
  const cancelledFlags = [
    response.cancelled,
    response.canceled,
    response.isCancelled,
    response.isCanceled,
    response.booking?.cancelled,
    response.booking?.canceled,
    response.data?.cancelled,
    response.data?.canceled,
    response.result?.cancelled,
    response.result?.canceled
  ];
  const status = String(
    response?.status ||
      response?.booking?.status ||
      response?.data?.status ||
      response?.result?.status ||
      response?.state ||
      response?.booking?.state ||
      response?.data?.state ||
      ""
  ).toLowerCase();
  const message = String(response?.message || response?.data?.message || response?.result?.message || "").toLowerCase();
  return response?.success === true ||
    cancelledFlags.some((value) => value === true || String(value).toLowerCase() === "true") ||
    /cancel|void/.test(status) ||
    /already\s+cancel|cancelled|canceled/.test(message);
};

const isBokunAlreadyCancelledError = (error = {}) => {
  const text = [
    error.message,
    error.details?.message,
    error.details?.response,
    error.details?.data?.message
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  return /already\s+cancel|already\s+canceled|booking\s+cancelled|booking\s+canceled/.test(text);
};

const isBokunNotConfirmedCancellationError = (error = {}) => {
  const text = [
    error.message,
    error.details?.message,
    error.details?.response,
    error.details?.data?.message
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  return /booking\s+is\s+not\s+confirmed|not\s+a\s+confirmed\s+booking|booking\s+not\s+confirmed/.test(text);
};

const lookupCancelledSupplierState = async ({ booking, requestId = "" }) => {
  const references = [
    booking.bokunBookingId,
    booking.bokunConfirmationCode,
    booking.bookingReference
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const seen = new Set();
  for (const reference of references) {
    if (seen.has(reference)) continue;
    seen.add(reference);
    try {
      const supplierBooking = await bokunService.lookupBooking(reference, requestId);
      if (isBokunCancellationConfirmed(supplierBooking)) {
        return supplierBooking;
      }
    } catch (error) {
      if (isBokunAlreadyCancelledError(error)) {
        return { recoveredFromSupplierState: true, reference, message: "Supplier reported this booking was already cancelled." };
      }
    }
  }
  return null;
};

const markCancellationSyncedLocally = async ({ request, booking, response = null }) => {
  booking.bookingStatus = "cancelled";
  booking.cancellation = {
    reason: request.customerReason,
    cancelledAt: booking.cancellation?.cancelledAt || new Date(),
    cancelledBy: "admin_request_workflow"
  };
  await booking.save();
  request.bokunSync.status = "synced";
  request.bokunSync.syncedAt = new Date();
  request.bokunSync.lastError = "";
  request.bokunSync.responseSnapshot = response || request.bokunSync.responseSnapshot || { recoveredFromSupplierState: true };
  await request.save();
};

const resolveApprovedRefundContext = async ({ request, booking, approvedAmount }) => {
  const safeApprovedAmount = number(approvedAmount || request.refund?.approvedAmount || request.refund?.eligibleAmount || request.refund?.estimatedAmount || 0);
  if (safeApprovedAmount <= 0) return null;
  return refundsService.resolveRefundContext({
    booking,
    eligibleRefundAmount: safeApprovedAmount,
    approvedRefundAmount: safeApprovedAmount
  });
};

const performBokunSync = async ({ request, booking, requestId = "" }) => {
  ensureRequestWorkflowDefaults(request, booking);
  if (request.bokunSync.status === "synced") return { synced: true, request };
  if (!booking.bokunBookingId) {
    request.bokunSync.status = "manual_action_required";
    request.bokunSync.lastError = "Supplier booking ID is not available yet.";
    await request.save();
    return { synced: false, manual: true, request };
  }

  request.bokunSync.status = "syncing";
  request.bokunSync.attempts += 1;
  request.bokunSync.lastAttemptAt = new Date();
  await request.save();
  try {
    let response;
    if (request.type === "cancel_booking") {
      response = await bokunService.cancelBooking(booking.bokunBookingId, {
        reason: request.customerReason,
        note: request.adminDecision?.customerFacingReason || "",
        confirmationCode: booking.bokunConfirmationCode || "",
        idempotencyKey: request.bokunSync.idempotencyKey
      }, requestId);
      if (!isBokunCancellationConfirmed(response)) {
        const supplierState = await lookupCancelledSupplierState({ booking, requestId });
        if (supplierState) {
          await markCancellationSyncedLocally({ request, booking, response: supplierState });
          await bookingsService.syncInvoiceForBookingReference({ bookingReference: booking.bookingReference, requestId, reason: "Booking request synchronized after supplier state lookup" });
          return { synced: true, request };
        }
        request.bokunSync.status = "manual_action_required";
        request.bokunSync.lastError = "Supplier response did not confirm cancellation.";
        request.bokunSync.responseSnapshot = response;
        await request.save();
        return { synced: false, manual: true, request };
      }
      await markCancellationSyncedLocally({ request, booking, response });
    } else if (env.BOKUN_MOCK_MODE) {
      response = await bokunService.editBooking(booking.bokunBookingId, {
        travelDate: request.requestedChanges?.date || booking.travelDate,
        startTime: request.requestedChanges?.startTime || booking.startTime,
        pax: request.requestedChanges?.travelers || booking.paxSummary,
        idempotencyKey: request.bokunSync.idempotencyKey
      }, requestId);
      booking.travelDate = request.requestedChanges?.date || booking.travelDate;
      booking.startTime = request.requestedChanges?.startTime || booking.startTime;
      if (request.requestedChanges?.travelers) {
        const currentPax = booking.paxSummary?.toObject?.() || booking.paxSummary || {};
        booking.paxSummary = { ...currentPax, ...request.requestedChanges.travelers, total: travelerTotal(request.requestedChanges.travelers) };
      }
      if (request.priceAdjustment?.newAmount !== null && request.priceAdjustment?.newAmount !== undefined) {
        booking.amount = number(request.priceAdjustment.newAmount);
        booking.pricingSnapshot.finalPayable = number(request.priceAdjustment.newAmount);
      }
      await booking.save();
    } else {
      request.bokunSync.status = "manual_action_required";
      request.bokunSync.lastError = "Bokun amendment API payload has not been verified for this account. Complete the approved change in Bokun, then retry sync.";
      await request.save();
      return { synced: false, manual: true, request };
    }

    request.bokunSync.status = "synced";
    request.bokunSync.syncedAt = new Date();
    request.bokunSync.lastError = "";
    request.bokunSync.responseSnapshot = response;
    await request.save();
    await bookingsService.syncInvoiceForBookingReference({ bookingReference: booking.bookingReference, requestId, reason: "Booking request synchronized" });
    return { synced: true, request };
  } catch (error) {
    if (request.type === "cancel_booking" && isBokunAlreadyCancelledError(error)) {
      await markCancellationSyncedLocally({
        request,
        booking,
        response: { recoveredFromSupplierState: true, message: "Supplier reported this booking was already cancelled." }
      });
      await bookingsService.syncInvoiceForBookingReference({ bookingReference: booking.bookingReference, requestId, reason: "Booking request synchronized after supplier cancellation" });
      return { synced: true, request };
    }
    if (request.type === "cancel_booking" && isBokunNotConfirmedCancellationError(error)) {
      await markCancellationSyncedLocally({
        request,
        booking,
        response: {
          recoveredFromSupplierState: true,
          supplierTerminalState: "not_confirmed",
          message: "Bokun reported this booking is not confirmed, so no active confirmed supplier booking remains to cancel."
        }
      });
      await bookingsService.syncInvoiceForBookingReference({ bookingReference: booking.bookingReference, requestId, reason: "Booking request synchronized after supplier not-confirmed response" });
      return { synced: true, request };
    }
    if (request.type === "cancel_booking") {
      const supplierState = await lookupCancelledSupplierState({ booking, requestId });
      if (supplierState) {
        await markCancellationSyncedLocally({ request, booking, response: supplierState });
        await bookingsService.syncInvoiceForBookingReference({ bookingReference: booking.bookingReference, requestId, reason: "Booking request synchronized after supplier cancellation lookup" });
        return { synced: true, request };
      }
    }
    request.bokunSync.status = request.type === "cancel_booking" ? "cancellation_pending_supplier" : "failed";
    request.bokunSync.lastError = String(error.message || "Bokun update failed").slice(0, 1000);
    await request.save();
    return { synced: false, request, error };
  }
};

const createRefundRecord = async ({ request, booking, amount, reason, auth, initialStatus = "approved", refundContext = null }) => {
  const safeAmount = Math.max(0, number(amount));
  if (!safeAmount) return null;
  const existing = request.refund?.refundId ? await Refund.findById(request.refund.refundId) : null;
  if (existing) return existing;
  const context = refundContext || await refundsService.resolveRefundContext({
    booking,
    eligibleRefundAmount: request.refund?.eligibleAmount ?? request.refund?.estimatedAmount ?? safeAmount,
    approvedRefundAmount: safeAmount
  });
  refundsService.assertRefundAmountAllowed({ amount: safeAmount, context });
  if (!context.providerKnown || !context.selectedPaymentId) {
    throw new AppError(context.manualReviewReason || "Refund provider requires manual review.", 422, "REFUND_PROVIDER_REQUIRES_REVIEW");
  }
  const latestPayment = await Payment.findById(context.selectedPaymentId);
  const invoice = await Invoice.findOne({ bookingReference: booking.bookingReference });
  const refundStatus = ["approved", "processing", "manual_review", "manual_refund_required", "pending_approval", "verification_required"].includes(initialStatus)
    ? initialStatus
    : "approved";
  const generatedRefundReference = refundReference();
  const refund = await Refund.create({
    refundReference: generatedRefundReference,
    bookingId: booking._id,
    bookingRequestId: request._id,
    customerId: booking.customer?.customerId || null,
    paymentId: latestPayment?._id || null,
    invoiceId: invoice?._id || null,
    provider: context.provider,
    originalTransactionReference: refundsService.extractOriginalTransactionReference(latestPayment || {}),
    amount: safeAmount,
    requestedAmount: safeAmount,
    confirmedRefundedAmount: 0,
    eligibleRefundAmount: context.eligibleRefundAmount,
    cancellationFee: request.refund?.cancellationFee ?? request.cancellationPolicySnapshot?.estimatedCancellationFee ?? null,
    currency: booking.currency || "USD",
    reason: reason || request.customerReason,
    status: refundStatus,
    approvedAt: refundStatus === "approved" || refundStatus === "processing" ? new Date() : undefined,
    approvedBy: auth?.id || null,
    idempotencyKey: `${context.provider}-${generatedRefundReference}`,
    metadata: {
      providerResolution: context,
      originalTransactionReferenceMasked: refundsService.maskReference(refundsService.extractOriginalTransactionReference(latestPayment || {}))
    }
  });
  request.refund = {
    ...(request.refund || {}),
    required: true,
    estimatedAmount: context.eligibleRefundAmount ?? safeAmount,
    eligibleAmount: context.eligibleRefundAmount,
    approvedAmount: safeAmount,
    requestedAmount: 0,
    confirmedRefundedAmount: 0,
    cancellationFee: request.refund?.cancellationFee ?? request.cancellationPolicySnapshot?.estimatedCancellationFee ?? null,
    provider: context.provider,
    providerLabel: context.providerLabel,
    providerResolution: context,
    refundId: refund._id,
    status: refundStatus
  };
  await request.save();
  return refund;
};

const createAdjustmentRecord = async ({ request, booking, amount, provider = "other" }) => {
  const existing = request.additionalPayment?.paymentAdjustmentId ? await PaymentAdjustment.findById(request.additionalPayment.paymentAdjustmentId) : null;
  if (existing) return existing;
  const adjustment = await PaymentAdjustment.create({
    adjustmentReference: adjustmentReference(),
    bookingId: booking._id,
    bookingRequestId: request._id,
    amount: Math.max(0, number(amount)),
    currency: booking.currency || "USD",
    provider: ["pesapal", "dpo", "paypal", "manual_bank_transfer", "cash", "other"].includes(provider) ? provider : "other",
    status: "pending",
    notes: "Awaiting verified additional payment before Bokun booking change."
  });
  request.additionalPayment = { required: true, paymentAdjustmentId: adjustment._id, status: "pending" };
  await request.save();
  return adjustment;
};

const finalizeApprovedRequest = async ({ request, booking, auth, requestId }) => {
  const sync = await performBokunSync({ request, booking, requestId });
  if (!sync.synced) {
    await recordAudit({ action: "booking_request_bokun_sync_failed", request, booking, auth, requestId, metadata: { status: request.bokunSync.status } });
    return { request, synced: false };
  }
  request.status = "completed";
  request.activeRequestKey = undefined;
  request.completedAt = new Date();
  await request.save();
  await recordAudit({ action: "booking_request_completed", request, booking, auth, requestId });
  queueRequestEmail({ booking, request, templateKey: request.type === "cancel_booking" ? "cancellation_confirmed" : request.type === "change_travelers" ? "traveler_change_completed" : "reschedule_completed" });
  return { request, synced: true };
};

const approveRequest = async ({ requestId, auth, payload = {}, traceId = "" }) =>
  withAdminLock({ requestId, auth, action: "approve", callback: async (request) => {
    const booking = await Booking.findById(request.booking);
    assertRequestableBooking(booking);
    ensureRequestWorkflowDefaults(request, booking);
    if (!["submitted", "under_review", "awaiting_availability_check", "approved"].includes(request.status)) {
      throw new AppError("This request cannot be approved in its current state.", 409, "BOOKING_REQUEST_NOT_ACTIONABLE");
    }
    const before = { status: request.status, bokunSync: request.bokunSync?.status || "" };
    request.adminDecision = { decision: "approved", customerFacingReason: String(payload.customerFacingReason || "").trim(), internalNote: String(payload.internalNote || "").trim(), decidedBy: auth?.id || null, decidedAt: new Date() };
    request.status = "approved";
    if (request.type === "cancel_booking") {
      const amountPaid = await paymentsService.getVerifiedPaidAmountByBookingReference({ bookingReference: booking.bookingReference });
      const productSnapshot = await ProductSnapshot.findOne({ bokunProductId: booking.bokunProductId }).lean();
      request.cancellationPolicySnapshot = calculateCancellationPolicy({ booking, productSnapshot, amountPaid });
    }
    if (request.type !== "cancel_booking") {
      const availability = await checkAvailabilityAndPrice({ request, booking, requestId: traceId });
      if (!availability.available) {
        request.status = "awaiting_availability_check";
        await request.save();
        throw new AppError("This option is no longer available for the requested change.", 409, "REQUESTED_CHANGE_UNAVAILABLE");
      }
    }
    const override = payload.overrideAmount;
    if (override !== undefined && override !== null) {
      if (!String(payload.overrideReason || "").trim()) throw new AppError("An override reason is required.", 422, "OVERRIDE_REASON_REQUIRED");
      request.priceAdjustment.adminOverrideAmount = number(override);
      request.priceAdjustment.adminOverrideReason = String(payload.overrideReason).trim();
      request.priceAdjustment.difference = number(override);
      request.priceAdjustment.type = number(override) > 0 ? "additional_payment" : number(override) < 0 ? "refund" : "none";
    }
    const difference = number(request.priceAdjustment.difference);
    const refundPlan = { amount: 0, context: null, reason: payload.refundReason || request.customerReason };
    if (request.type === "cancel_booking") {
      const eligibleAmount = request.cancellationPolicySnapshot?.estimatedRefundAmount;
      refundPlan.context = await refundsService.resolveRefundContext({
        booking,
        eligibleRefundAmount: eligibleAmount,
        approvedRefundAmount: payload.refundAmount !== undefined ? payload.refundAmount : eligibleAmount
      });
      refundPlan.amount = payload.refundAmount !== undefined
        ? number(payload.refundAmount)
        : number(refundPlan.context.defaultApprovedRefundAmount || 0);
      if (refundPlan.amount > 0 && !refundPlan.context.requiresManualReview) {
        refundsService.assertRefundAmountAllowed({ amount: refundPlan.amount, context: refundPlan.context });
      }
      const cancellationRefundStatus = eligibleAmount === null || eligibleAmount === undefined || request.cancellationPolicySnapshot?.requiresManualReview || refundPlan.context.requiresManualReview
        ? "manual_review"
        : refundPlan.amount > 0
          ? "approved"
          : "not_required";
      request.refund = {
        required: refundPlan.amount > 0,
        estimatedAmount: eligibleAmount === null || eligibleAmount === undefined ? 0 : number(eligibleAmount || 0),
        eligibleAmount: eligibleAmount === null || eligibleAmount === undefined ? null : number(eligibleAmount || 0),
        approvedAmount: refundPlan.amount > 0 ? refundPlan.amount : null,
        requestedAmount: 0,
        confirmedRefundedAmount: 0,
        cancellationFee: request.cancellationPolicySnapshot?.estimatedCancellationFee === null || request.cancellationPolicySnapshot?.estimatedCancellationFee === undefined
          ? null
          : number(request.cancellationPolicySnapshot.estimatedCancellationFee),
        provider: refundPlan.context.providerKnown ? refundPlan.context.provider : "",
        providerLabel: refundPlan.context.providerKnown ? refundPlan.context.providerLabel : "",
        providerResolution: refundPlan.context,
        status: cancellationRefundStatus
      };
    } else if (difference > 0) {
      await createAdjustmentRecord({ request, booking, amount: difference, provider: payload.paymentProvider || booking.paymentMethod });
      request.status = "awaiting_additional_payment";
      await request.save();
      await recordAudit({ action: "booking_request_additional_payment_required", request, booking, auth, requestId: traceId, before, after: { status: request.status, difference } });
      queueRequestEmail({ booking, request, templateKey: "additional_payment_required" });
      return { request, additionalPaymentRequired: true };
    } else if (difference < 0) {
      refundPlan.amount = Math.abs(difference);
      refundPlan.reason = "Price reduction after approved booking change";
      request.refund = { required: true, estimatedAmount: refundPlan.amount, status: "pending_approval" };
    }
    await request.save();
    await recordAudit({ action: "booking_request_approved", request, booking, auth, requestId: traceId, before, after: { status: request.status } });
    queueRequestEmail({ booking, request, templateKey: "request_approved" });
    const finalized = await finalizeApprovedRequest({ request, booking, auth, requestId: traceId });
    if (finalized.synced && refundPlan.amount > 0) {
      const approvedContext = refundPlan.context?.providerKnown && !refundPlan.context?.requiresManualReview
        ? refundPlan.context
        : await resolveApprovedRefundContext({ request, booking, approvedAmount: refundPlan.amount });
      if (!approvedContext?.providerKnown || approvedContext?.requiresManualReview) {
        return finalized;
      }
      const refund = await createRefundRecord({
        request,
        booking,
        amount: refundPlan.amount,
        reason: refundPlan.reason,
        auth,
        refundContext: approvedContext
      });
      return { ...finalized, refund };
    }
    return finalized;
  }});

const rejectRequest = async ({ requestId, auth, customerFacingReason, internalNote = "", traceId = "" }) =>
  withAdminLock({ requestId, auth, action: "reject", callback: async (request) => {
    const booking = await Booking.findById(request.booking);
    assertTransition({ from: request.status, to: "rejected" });
    const before = { status: request.status };
    request.status = "rejected";
    request.activeRequestKey = undefined;
    request.adminDecision = { decision: "rejected", customerFacingReason: String(customerFacingReason).trim(), internalNote: String(internalNote).trim(), decidedBy: auth?.id || null, decidedAt: new Date() };
    await request.save();
    await recordAudit({ action: "booking_request_rejected", request, booking, auth, requestId: traceId, before, after: { status: request.status }, reason: request.adminDecision.customerFacingReason });
    queueRequestEmail({ booking, request, templateKey: "request_rejected" });
    return request;
  }});

const requestMoreInformation = async ({ requestId, auth, customerFacingReason, internalNote = "", traceId = "" }) =>
  withAdminLock({ requestId, auth, action: "request_information", callback: async (request) => {
    const booking = await Booking.findById(request.booking);
    assertTransition({ from: request.status, to: "awaiting_customer_information" });
    request.status = "awaiting_customer_information";
    request.adminDecision = { decision: "more_information", customerFacingReason: String(customerFacingReason).trim(), internalNote: String(internalNote).trim(), decidedBy: auth?.id || null, decidedAt: new Date() };
    await request.save();
    await recordAudit({ action: "booking_request_information_requested", request, booking, auth, requestId: traceId, reason: request.adminDecision.customerFacingReason });
    queueRequestEmail({ booking, request, templateKey: "request_more_information" });
    return request;
  }});

const recalculateRequest = async ({ requestId, auth, traceId = "" }) =>
  withAdminLock({ requestId, auth, action: "recalculate", callback: async (request) => {
    const booking = await Booking.findById(request.booking);
    ensureRequestWorkflowDefaults(request, booking);
    if (request.type === "cancel_booking") {
      const amountPaid = await paymentsService.getVerifiedPaidAmountByBookingReference({ bookingReference: booking.bookingReference });
      const productSnapshot = await ProductSnapshot.findOne({ bokunProductId: booking.bokunProductId }).lean();
      request.cancellationPolicySnapshot = calculateCancellationPolicy({ booking, productSnapshot, amountPaid });
      const context = await refundsService.resolveRefundContext({
        booking,
        eligibleRefundAmount: request.cancellationPolicySnapshot.estimatedRefundAmount
      });
      request.refund.estimatedAmount = request.cancellationPolicySnapshot.estimatedRefundAmount === null ? 0 : number(request.cancellationPolicySnapshot.estimatedRefundAmount || 0);
      request.refund.eligibleAmount = request.cancellationPolicySnapshot.estimatedRefundAmount === null ? null : number(request.cancellationPolicySnapshot.estimatedRefundAmount || 0);
      request.refund.cancellationFee = request.cancellationPolicySnapshot.estimatedCancellationFee === null || request.cancellationPolicySnapshot.estimatedCancellationFee === undefined ? null : number(request.cancellationPolicySnapshot.estimatedCancellationFee);
      request.refund.provider = context.providerKnown ? context.provider : "";
      request.refund.providerLabel = context.providerKnown ? context.providerLabel : "";
      request.refund.providerResolution = context;
      request.refund.status = request.cancellationPolicySnapshot.requiresManualReview || context.requiresManualReview
        ? "manual_review"
        : request.refund.estimatedAmount > 0
          ? "eligible"
          : "not_required";
      await request.save();
      return request;
    }
    const result = await checkAvailabilityAndPrice({ request, booking, requestId: traceId });
    await recordAudit({ action: "booking_request_price_recalculated", request, booking, auth, requestId: traceId, metadata: { available: result.available, difference: request.priceAdjustment.difference } });
    return request;
  }});

const retryBokunSync = async ({ requestId, auth, traceId = "" }) =>
  withAdminLock({ requestId, auth, action: "retry_bokun", callback: async (request) => {
    const booking = await Booking.findById(request.booking);
    ensureRequestWorkflowDefaults(request, booking);
    if (!["approved", "processing", "failed", "completed"].includes(request.status)) throw new AppError("Approve the request before retrying supplier sync.", 409, "REQUEST_NOT_APPROVED");
    const result = await performBokunSync({ request, booking, requestId: traceId });
    if (result.synced && request.status !== "completed") {
      request.status = "completed";
      request.completedAt = new Date();
      await request.save();
    }
    if (
      result.synced &&
      request.type === "cancel_booking" &&
      Number(request.refund?.approvedAmount || 0) > 0 &&
      !request.refund?.refundId
    ) {
      const refundContext = request.refund?.providerResolution?.providerKnown && !request.refund?.providerResolution?.requiresManualReview
        ? request.refund.providerResolution
        : await resolveApprovedRefundContext({ request, booking, approvedAmount: request.refund.approvedAmount });
      if (!refundContext?.providerKnown || refundContext?.requiresManualReview) {
        await recordAudit({ action: "booking_request_refund_manual_review_required", request, booking, auth, requestId: traceId, metadata: { approvedAmount: request.refund.approvedAmount, reason: refundContext?.manualReviewReason || "Refund provider requires review" } });
        return result;
      }
      await createRefundRecord({
        request,
        booking,
        amount: request.refund.approvedAmount,
        reason: request.customerReason,
        auth,
        refundContext
      });
    }
    await recordAudit({ action: result.synced ? "booking_request_bokun_sync_succeeded" : "booking_request_bokun_sync_failed", request, booking, auth, requestId: traceId });
    return result;
  }});

const markAdjustmentPaid = async ({ adjustmentId, auth, paymentReference = "", traceId = "" }) => {
  const adjustment = await PaymentAdjustment.findById(adjustmentId);
  if (!adjustment) throw new AppError("Payment adjustment not found", 404, "PAYMENT_ADJUSTMENT_NOT_FOUND");
  if (adjustment.status === "paid") return adjustment;
  adjustment.status = "paid";
  adjustment.paidAt = new Date();
  adjustment.paymentReference = String(paymentReference || adjustment.paymentReference || "").trim();
  await adjustment.save();
  const request = await BookingRequest.findById(adjustment.bookingRequestId);
  const booking = await Booking.findById(adjustment.bookingId);
  ensureRequestWorkflowDefaults(request, booking);
  const provider = adjustment.provider === "manual_bank_transfer" ? "manual_bank" : adjustment.provider === "cash" ? "cash_on_arrival" : adjustment.provider;
  await Payment.findOneAndUpdate(
    { intentId: `adjustment-${adjustment._id}` },
    {
      $set: {
        bookingReference: booking.bookingReference,
        provider,
        providerTransactionId: adjustment.paymentReference || adjustment.adjustmentReference,
        merchantReference: adjustment.adjustmentReference,
        orderTrackingId: adjustment.paymentReference || "",
        amount: adjustment.amount,
        currency: adjustment.currency,
        status: "paid",
        amountPaid: adjustment.amount,
        paidAmount: adjustment.amount,
        paidAt: adjustment.paidAt,
        lastVerifiedAt: new Date(),
        rawResponse: { source: "admin_verified_adjustment", adjustmentReference: adjustment.adjustmentReference, verifiedBy: auth?.id || "" }
      },
      $setOnInsert: { intentId: `adjustment-${adjustment._id}` }
    },
    { upsert: true, new: true }
  );
  request.additionalPayment.status = "paid";
  request.status = "approved";
  await request.save();
  await bookingsService.syncInvoiceForBookingReference({ bookingReference: booking.bookingReference, requestId: traceId, reason: "Verified additional payment recorded" });
  await recordAudit({ action: "booking_request_additional_payment_marked_paid", request, booking, auth, requestId: traceId, metadata: { adjustmentReference: adjustment.adjustmentReference } });
  const finalized = await finalizeApprovedRequest({ request, booking, auth, requestId: traceId });
  return { adjustment, request: finalized.request };
};

const updateRefundStatus = async ({ refundId, auth, status, providerRefundReference = "", failureReason = "", confirmedAmount = undefined, traceId = "" }) => {
  const refund = await Refund.findById(refundId);
  if (!refund) throw new AppError("Refund not found", 404, "REFUND_NOT_FOUND");
  if (["refunded", "partially_refunded"].includes(refund.status) && status !== refund.status) throw new AppError("Completed refunds cannot be edited.", 409, "REFUND_ALREADY_COMPLETED");
  const allowed = ["eligible", "approved", "processing", "verification_required", "partially_refunded", "refunded", "failed", "rejected", "cancelled", "manual_review", "manual_refund_required"];
  if (!allowed.includes(status)) throw new AppError("Invalid refund status.", 422, "INVALID_REFUND_STATUS");
  const booking = await Booking.findById(refund.bookingId);
  const request = await BookingRequest.findById(refund.bookingRequestId);
  ensureRequestWorkflowDefaults(request, booking);
  if (["refunded", "partially_refunded"].includes(status)) {
    const completed = await Refund.aggregate([
      { $match: { bookingId: booking._id, _id: { $ne: refund._id }, status: { $in: ["refunded", "partially_refunded"] } } },
      { $group: { _id: null, amount: { $sum: { $ifNull: ["$confirmedRefundedAmount", "$amount"] } } } }
    ]);
    const paid = await paymentsService.getVerifiedPaidAmountByBookingReference({ bookingReference: booking.bookingReference });
    const confirmedRefundAmount = confirmedAmount !== undefined ? number(confirmedAmount) : number(refund.amount);
    if (confirmedRefundAmount <= 0) throw new AppError("Confirmed refund amount is required.", 422, "CONFIRMED_REFUND_AMOUNT_REQUIRED");
    if (number(completed[0]?.amount) + confirmedRefundAmount > paid + 0.009) throw new AppError("Completed refunds cannot exceed the verified amount paid.", 422, "REFUND_EXCEEDS_PAID_AMOUNT");
    refund.confirmedRefundedAmount = confirmedRefundAmount;
    refund.completedAt = new Date();
    const payment = refund.paymentId ? await Payment.findById(refund.paymentId) : await Payment.findOne({ bookingReference: booking.bookingReference, status: "paid" }).sort({ createdAt: -1 });
    if (payment) {
      payment.refundedAmount = number(completed[0]?.amount) + confirmedRefundAmount;
      await payment.save();
    }
  }
  if (status === "processing") refund.processingStartedAt = new Date();
  if (status === "failed") { refund.failedAt = new Date(); refund.failureReason = String(failureReason || "Refund failed").trim(); }
  if (!["refunded", "partially_refunded"].includes(status)) refund.confirmedRefundedAmount = 0;
  refund.status = status;
  if (providerRefundReference) refund.providerRefundReference = String(providerRefundReference).trim();
  refund.processedBy = auth?.id || refund.processedBy;
  await refund.save();
  request.refund.status = status;
  request.refund.confirmedRefundedAmount = refund.confirmedRefundedAmount || 0;
  request.refund.requestedAmount = refund.requestedAmount || refund.amount || 0;
  request.refund.approvedAmount = refund.amount || request.refund.approvedAmount || null;
  request.refund.provider = refund.provider || request.refund.provider || "";
  request.refund.providerLabel = refundsService.providerLabel(refund.provider || request.refund.provider || "");
  await request.save();
  await bookingsService.syncInvoiceForBookingReference({ bookingReference: booking.bookingReference, requestId: traceId, reason: "Refund status updated" });
  await recordAudit({ action: "booking_request_refund_updated", request, booking, auth, requestId: traceId, metadata: { refundReference: refund.refundReference, status } });
  queueRequestEmail({ booking, request, templateKey: status === "refunded" || status === "partially_refunded" ? "refund_completed" : status === "failed" ? "refund_failed" : "refund_processing" });
  return refund;
};

const processRefund = async ({ refundId, auth, traceId = "", notes = "" }) =>
  refundsService.processRefund({ refundId, auth, traceId, notes });

const retryRequestEmail = async ({ requestId, auth, traceId = "" }) => {
  const request = await BookingRequest.findById(requestId);
  if (!request) throw new AppError("Booking request not found", 404, "BOOKING_REQUEST_NOT_FOUND");
  const booking = await Booking.findById(request.booking);
  const templateKey = request.lastEmailTemplate || "request_received";
  const delivery = await emailService.sendBookingRequestEmailOnce({ booking, request, templateKey });
  await recordAudit({ action: "booking_request_email_retried", request, booking, auth, requestId: traceId, metadata: { templateKey, deliveryStatus: delivery.status } });
  return delivery;
};

module.exports = {
  submitRequest,
  listCustomerRequests,
  getCancellationEstimate,
  getCustomerRequest,
  customerResponse,
  cancelCustomerRequest,
  adminListRequests,
  adminGetRequest,
  approveRequest,
  rejectRequest,
  requestMoreInformation,
  recalculateRequest,
  retryBokunSync,
  markAdjustmentPaid,
  updateRefundStatus,
  processRefund,
  retryRequestEmail,
  __testables: {
    ensureRequestWorkflowDefaults,
    isBokunAlreadyCancelledError,
    isBokunNotConfirmedCancellationError,
    isBokunCancellationConfirmed
  }
};
