const crypto = require("crypto");
const ServiceCompletion = require("../../models/ServiceCompletion");
const RevenueRecognition = require("../../models/RevenueRecognition");
const Booking = require("../../models/Booking");
const AuditLog = require("../../models/AuditLog");
const revenueRecognition = require("../revenueRecognition");
const { env } = require("../../config/env");
const AppError = require("../../utils/AppError");
const { PERMISSIONS, hasPermission } = require("../../security/permissions");
const { ROLES } = require("../../config/constants");

const COMPLETION_POLICY = "BOKUN_ARRIVED_REQUIRES_EXPLICIT_LOCAL_CONFIRMATION";
const completionKey = ({ bookingId, serviceKey }) => crypto.createHash("sha256").update(`${bookingId}:${serviceKey}`).digest("hex");
const safeStatus = (value) => String(value || "").trim().toUpperCase();
const isAdminVerifier = (auth = {}) => [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(auth.role) && hasPermission(auth, PERMISSIONS.SERVICE_COMPLETION_VERIFY);
const audit = ({ AuditLogModel = AuditLog, action, completion, auth = {}, requestId = "", reason = "", after = null }) => AuditLogModel.create({ actorId: auth.id || auth.email || null, actorRole: auth.role || "system", action, entityType: "ServiceCompletion", entityId: String(completion?._id || ""), reference: completion?.bookingReference || "", requestId, reason, after });

const createServiceCompletionService = ({ CompletionModel = ServiceCompletion, RecognitionModel = RevenueRecognition, BookingModel = Booking, AuditLogModel = AuditLog, RevenueService = revenueRecognition } = {}) => {
  const getBooking = async (bookingReference) => { const booking = await BookingModel.findOne({ bookingReference }).lean(); if (!booking) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND"); return booking; };
  const create = async ({ input, auth = {}, requestId = "" }) => {
    const booking = await getBooking(input.bookingReference); const status = safeStatus(input.status); const source = safeStatus(input.evidenceSource); if (!status || !["COMPLETION_PENDING", "COMPLETED", "NO_SHOW", "CANCELLED", "NEEDS_REVIEW"].includes(status)) throw new AppError("Invalid completion status", 422, "COMPLETION_STATUS_INVALID"); if (!input.reason && ["COMPLETION_PENDING", "COMPLETED", "NEEDS_REVIEW"].includes(status)) throw new AppError("Completion reason is required", 422, "COMPLETION_REASON_REQUIRED"); if (status === "COMPLETED" && (!isAdminVerifier(auth) || source !== "ADMIN_CONFIRMATION")) throw new AppError("Only an authorized admin may confirm completion", 403, "COMPLETION_ADMIN_CONFIRMATION_FORBIDDEN"); if (status === "COMPLETED" && !input.completedAt) throw new AppError("Actual completion timestamp is required", 422, "COMPLETION_TIMESTAMP_REQUIRED"); if (status === "COMPLETED" && safeStatus(booking.bokunOperationalEvidence?.activityStatus) !== "ARRIVED") throw new AppError("Bókun ARRIVED evidence is required for admin confirmation", 409, "BOKUN_ARRIVAL_EVIDENCE_REQUIRED"); if (status === "COMPLETED" && /CANCEL/.test(safeStatus(booking.bookingStatus))) throw new AppError("Cancelled bookings require review and cannot be silently completed", 409, "CANCELLATION_REVIEW_REQUIRED");
    const key = completionKey({ bookingId: booking._id, serviceKey: input.serviceKey }); const existing = await CompletionModel.findOne({ completionKey: key }); if (existing) return { completion: existing, replay: true, accounting: null };
    const payload = { completionKey: key, bookingId: booking._id, bookingReference: booking.bookingReference, serviceKey: input.serviceKey, serviceName: input.serviceName || booking.productTitle || "", serviceDate: input.serviceDate || booking.travelDate || "", status, evidenceSource: source, externalStatus: input.externalStatus || "", externalProductId: input.externalProductId || booking.bokunProductId || "", externalReference: input.externalReference || booking.bokunConfirmationCode || "", evidenceTimestamp: input.evidenceTimestamp || null, completedAt: status === "COMPLETED" ? input.completedAt || new Date() : null, verifiedAt: status === "COMPLETED" ? new Date() : null, verifiedBy: status === "COMPLETED" ? auth.id || auth.email || "" : "", createdBy: auth.id || auth.email || "", reason: input.reason || "", notes: input.notes || "" };
    let completion;
    try { completion = await CompletionModel.create(payload); } catch (error) { if (error?.code !== 11000) throw error; completion = await CompletionModel.findOne({ completionKey: key }); return { completion, replay: true, accounting: null }; }
    await audit({ AuditLogModel, action: "SERVICE_COMPLETION_CREATED", completion, auth, requestId, reason: input.reason || "Service completion evidence recorded", after: { bookingReference: completion.bookingReference, status, evidenceSource: source, serviceKey: completion.serviceKey } });
    const accounting = env.REVENUE_RECOGNITION_AUTOMATIC_ENABLED === true && status === "COMPLETED" ? await RevenueService.post({ completionId: completion._id, auth }) : null;
    return { completion, accounting, replay: false, policy: COMPLETION_POLICY };
  };
  const verify = async ({ completionId, input, auth = {}, requestId = "" }) => {
    if (!isAdminVerifier(auth)) throw new AppError("Only an authorized admin may verify completion", 403, "COMPLETION_ADMIN_CONFIRMATION_FORBIDDEN");
    const completion = await CompletionModel.findById(completionId);
    if (!completion) throw new AppError("Service completion not found", 404, "COMPLETION_NOT_FOUND");
    if (completion.status !== "COMPLETION_PENDING" && completion.status !== "NEEDS_REVIEW") throw new AppError("Only pending or review completion evidence can be verified", 409, "COMPLETION_VERIFICATION_STATE_INVALID");
    if (!input.completedAt) throw new AppError("Actual completion timestamp is required", 422, "COMPLETION_TIMESTAMP_REQUIRED");
    completion.status = "COMPLETED"; completion.completedAt = input.completedAt; completion.verifiedAt = new Date(); completion.verifiedBy = auth.id || auth.email || ""; completion.evidenceSource = "ADMIN_CONFIRMATION"; completion.reason = input.reason; if (input.notes) completion.notes = input.notes;
    await completion.save();
    await audit({ AuditLogModel, action: "SERVICE_COMPLETION_VERIFIED", completion, auth, requestId, reason: input.reason, after: { status: completion.status, completedAt: completion.completedAt, verifiedAt: completion.verifiedAt } });
    return { completion, accounting: env.REVENUE_RECOGNITION_AUTOMATIC_ENABLED === true ? await RevenueService.post({ completionId: completion._id, auth }) : null };
  };
  const list = async ({ status = "", bookingReference = "", search = "", limit = 100 } = {}) => { const query = {}; if (status) query.status = safeStatus(status); if (bookingReference) query.bookingReference = bookingReference; if (search) { const expression = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")); query.$or = [{ bookingReference: expression }, { serviceName: expression }, { serviceKey: expression }]; } return CompletionModel.find(query).sort({ serviceDate: -1, createdAt: -1 }).limit(Math.min(100, Number(limit))).lean(); };
  const review = async (reference) => { const booking = await BookingModel.findOne({ $or: [{ bookingReference: reference }, { bokunConfirmationCode: reference }] }).lean(); if (!booking) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND"); const completions = await CompletionModel.find({ bookingId: booking._id }).sort({ createdAt: -1 }).lean(); return { booking: { bookingReference: booking.bookingReference, bokunConfirmationCode: booking.bokunConfirmationCode, customer: booking.customer, productTitle: booking.productTitle, bokunProductId: booking.bokunProductId, travelDate: booking.travelDate, bookingStatus: booking.bookingStatus, paymentState: booking.paymentStatus || booking.bookingPaymentStatus || "", bokunActivityStatus: booking.bokunOperationalEvidence?.activityStatus || "", bokunOperationalEvidence: booking.bokunOperationalEvidence || null }, completions, serviceCompletionStatus: completions[0]?.status || "NOT_COMPLETED" }; };
  const detail = async (id) => { const completion = await CompletionModel.findById(id).lean(); if (!completion) throw new AppError("Service completion not found", 404, "COMPLETION_NOT_FOUND"); const recognitions = await RecognitionModel.find({ serviceCompletionId: id }).sort({ createdAt: -1 }).lean(); return { completion, recognitions, policy: COMPLETION_POLICY }; };
  const reverse = (input) => RevenueService.requestCompletionReversal(input);
  const recognitionPreview = (input) => RevenueService.preview(input);
  return { create, verify, list, detail, review, reverse, recognitionPreview };
};
module.exports = { createServiceCompletionService, completionKey, COMPLETION_POLICY, ...createServiceCompletionService() };
