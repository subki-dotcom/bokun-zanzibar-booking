const { v4: uuidv4 } = require("uuid");
const Booking = require("../../models/Booking");
const Invoice = require("../../models/Invoice");
const AuditLog = require("../../models/AuditLog");
const logger = require("../../config/logger");
const bokunService = require("../../integrations/bokun");
const paymentsService = require("../payments");
const notificationsService = require("../notifications");

const LEGACY_RECOVERY_LOCK_STALE_AFTER_MS = 15 * 60 * 1000;
const LEGACY_RECOVERY_STATUS = {
  PROCESSING: "processing",
  RECOVERED: "recovered",
  RECONCILED: "reconciled",
  HANDOFF: "handoff_to_standard_retry",
  MANUAL_REVIEW: "manual_review_required",
  SKIPPED: "skipped"
};

const RECOVERY_ERROR_CLASSIFICATION = {
  INVALID_PRICING_CATEGORY: "INVALID_PRICING_CATEGORY",
  MISSING_PRICING_CATEGORY: "MISSING_PRICING_CATEGORY",
  TEMPORARY_PROVIDER_ERROR: "TEMPORARY_PROVIDER_ERROR",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  AUTH_ERROR: "AUTH_ERROR",
  UNKNOWN_ERROR: "UNKNOWN_ERROR"
};

const toIsoDate = (date = new Date()) => new Date(date).toISOString().slice(0, 10);

const normalizeErrorText = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(normalizeErrorText).filter(Boolean).join(" ");
  if (typeof value === "object") {
    return [
      value.message,
      value.error,
      value.reason,
      value.detail,
      value.details,
      value.errors,
      value.fields
    ]
      .map(normalizeErrorText)
      .filter(Boolean)
      .join(" ");
  }
  return "";
};

const summarizeError = (error = {}) => ({
  code: String(error?.code || error?.details?.code || "").trim(),
  statusCode: Number(error?.statusCode || error?.details?.statusCode || 0) || 0,
  message: [normalizeErrorText(error?.message), normalizeErrorText(error?.details)]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
});

const classifyBokunFinalizationError = (error = {}) => {
  const summary = summarizeError(error);
  const token = `${summary.code} ${summary.message}`.toLowerCase();
  const hasPricingCategoryReference = /pricing[\s_-]*category|pricingcategory/.test(token);

  if (hasPricingCategoryReference && /missing|required|must be provided|not present|empty/.test(token)) {
    return RECOVERY_ERROR_CLASSIFICATION.MISSING_PRICING_CATEGORY;
  }

  if (hasPricingCategoryReference && /invalid|unknown|not valid|does not exist|unsupported/.test(token)) {
    return RECOVERY_ERROR_CLASSIFICATION.INVALID_PRICING_CATEGORY;
  }

  if (
    summary.statusCode >= 500 ||
    /timeout|timed out|network|econnreset|socket hang up|service unavailable|bad gateway|gateway timeout|bokun_finalization_pending/.test(
      token
    )
  ) {
    return RECOVERY_ERROR_CLASSIFICATION.TEMPORARY_PROVIDER_ERROR;
  }

  if (summary.statusCode === 401 || summary.statusCode === 403 || /unauthorized|forbidden|authentication|api key/.test(token)) {
    return RECOVERY_ERROR_CLASSIFICATION.AUTH_ERROR;
  }

  if (summary.statusCode >= 400 && summary.statusCode < 500) {
    return RECOVERY_ERROR_CLASSIFICATION.VALIDATION_ERROR;
  }

  return RECOVERY_ERROR_CLASSIFICATION.UNKNOWN_ERROR;
};

const isLegacyPricingCategoryFailure = (finalization = {}) => {
  const lastError = finalization?.lastError || {};
  const classification = classifyBokunFinalizationError(lastError);

  return {
    classification,
    eligible:
      Number(lastError.statusCode || 0) === 422 &&
      [
        RECOVERY_ERROR_CLASSIFICATION.MISSING_PRICING_CATEGORY,
        RECOVERY_ERROR_CLASSIFICATION.INVALID_PRICING_CATEGORY
      ].includes(classification)
  };
};

const isLockActive = (lock = {}, now = new Date()) => {
  if (!lock?.lockToken) return false;
  const lockedAt = new Date(lock.lockedAt || 0).getTime();
  return !Number.isFinite(lockedAt) || lockedAt > now.getTime() - LEGACY_RECOVERY_LOCK_STALE_AFTER_MS;
};

const hasSupplierBooking = (booking = {}) =>
  Boolean(String(booking.bokunBookingId || "").trim() || String(booking.bokunConfirmationCode || "").trim());

const invoiceIsPaid = (invoice = null, booking = {}) => {
  const source = invoice || booking.invoiceSnapshot || {};
  return source?.paymentStatus === "paid" && Number(source?.amountPaid || 0) > 0;
};

const evaluateLegacyRecoveryEligibility = ({ booking, invoice, verifiedPaidAmount = 0, now = new Date() } = {}) => {
  if (!booking) return { eligible: false, reason: "booking_not_found" };
  if (booking.paymentStatus !== "paid" || Number(verifiedPaidAmount || 0) <= 0) {
    return { eligible: false, reason: "payment_not_verified_paid" };
  }
  if (!invoiceIsPaid(invoice, booking)) return { eligible: false, reason: "invoice_not_paid" };
  if (hasSupplierBooking(booking)) return { eligible: false, reason: "supplier_booking_exists" };

  const bookingStatus = String(booking.bookingStatus || "").toLowerCase();
  if (["cancelled", "completed"].includes(bookingStatus)) {
    return { eligible: false, reason: "booking_terminal" };
  }
  if (["refunded", "partially_refunded"].includes(String(booking.paymentStatus || "").toLowerCase())) {
    return { eligible: false, reason: "payment_refunded" };
  }
  if (!booking.travelDate || String(booking.travelDate) < toIsoDate(now)) {
    return { eligible: false, reason: "travel_date_expired" };
  }

  const finalization = booking.pendingCheckout?.finalization || {};
  if (finalization.status !== "failed" || finalization.finalizationPending) {
    return { eligible: false, reason: "retry_not_exhausted" };
  }
  if (finalization.lockToken && isLockActive(finalization, now)) {
    return { eligible: false, reason: "finalization_locked" };
  }

  const legacy = booking.legacyBokunRecovery || {};
  if (legacy.status && !(legacy.status === LEGACY_RECOVERY_STATUS.PROCESSING && !isLockActive(legacy, now))) {
    return { eligible: false, reason: "legacy_recovery_already_handled" };
  }
  if (legacy.lockToken && isLockActive(legacy, now)) {
    return { eligible: false, reason: "legacy_recovery_locked" };
  }

  const pricingFailure = isLegacyPricingCategoryFailure(finalization);
  if (!pricingFailure.eligible) {
    return { eligible: false, reason: "not_legacy_pricing_category_failure", classification: pricingFailure.classification };
  }

  return { eligible: true, classification: pricingFailure.classification };
};

const buildLegacyRecoveryCandidateQuery = ({ now = new Date() } = {}) => {
  const staleBefore = new Date(now.getTime() - LEGACY_RECOVERY_LOCK_STALE_AFTER_MS);

  return {
    paymentStatus: "paid",
    bookingStatus: { $nin: ["cancelled", "completed"] },
    $and: [
      { $or: [{ bokunBookingId: { $exists: false } }, { bokunBookingId: "" }] },
      { $or: [{ bokunConfirmationCode: { $exists: false } }, { bokunConfirmationCode: "" }] },
      { "pendingCheckout.finalization.status": "failed" },
      { "pendingCheckout.finalization.finalizationPending": { $ne: true } },
      { "pendingCheckout.finalization.lastError.statusCode": 422 },
      { travelDate: { $gte: toIsoDate(now) } },
      {
        $or: [
          { "legacyBokunRecovery.status": { $exists: false } },
          {
            "legacyBokunRecovery.status": LEGACY_RECOVERY_STATUS.PROCESSING,
            "legacyBokunRecovery.lockedAt": { $lte: staleBefore }
          }
        ]
      }
    ]
  };
};

const createSummary = (requested) => ({
  requested,
  scanned: 0,
  eligible: 0,
  processed: 0,
  successful: 0,
  confirmed: 0,
  pendingRetry: 0,
  inProgress: 0,
  failed: 0,
  manualReview: 0,
  duplicatesPrevented: 0,
  skipped: 0,
  skipReasons: {}
});

const incrementSkip = (summary, reason) => {
  summary.skipped += 1;
  summary.skipReasons[reason || "unknown"] = Number(summary.skipReasons[reason || "unknown"] || 0) + 1;
};

const createLegacyBokunRecoveryService = ({
  BookingModel = Booking,
  InvoiceModel = Invoice,
  AuditLogModel = AuditLog,
  bokun = bokunService,
  payments = paymentsService,
  notifications = notificationsService,
  loggerInstance = logger,
  now = () => new Date(),
  createLockToken = uuidv4
} = {}) => {
  const recordAudit = async ({ booking, action, requestId = "", reason = "", metadata = {} }) => {
    if (!booking?._id) return;
    try {
      await AuditLogModel.create({
        actorId: null,
        actorRole: "system",
        action,
        entityType: "Booking",
        entityId: booking._id.toString(),
        reason,
        requestId,
        metadata: {
          bookingReference: booking.bookingReference,
          legacyRecovery: true,
          ...metadata
        }
      });
    } catch (error) {
      loggerInstance.error("Legacy Bokun recovery audit write failed", {
        bookingReference: booking.bookingReference,
        requestId,
        error: error.message
      });
    }
  };

  const claimRecovery = async ({ booking, requestId, source }) => {
    const claimedAt = now();
    const staleBefore = new Date(claimedAt.getTime() - LEGACY_RECOVERY_LOCK_STALE_AFTER_MS);
    const lockToken = createLockToken();
    const query = {
      _id: booking._id,
      paymentStatus: "paid",
      bookingStatus: { $nin: ["cancelled", "completed"] },
      $and: [
        { $or: [{ bokunBookingId: { $exists: false } }, { bokunBookingId: "" }] },
        { $or: [{ bokunConfirmationCode: { $exists: false } }, { bokunConfirmationCode: "" }] },
        { "pendingCheckout.finalization.status": "failed" },
        { "pendingCheckout.finalization.lastError.statusCode": 422 },
        {
          $or: [
            { "legacyBokunRecovery.status": { $exists: false } },
            {
              "legacyBokunRecovery.status": LEGACY_RECOVERY_STATUS.PROCESSING,
              "legacyBokunRecovery.lockedAt": { $lte: staleBefore }
            }
          ]
        }
      ]
    };

    const claimed = await BookingModel.findOneAndUpdate(
      query,
      {
        $set: {
          "legacyBokunRecovery.status": LEGACY_RECOVERY_STATUS.PROCESSING,
          "legacyBokunRecovery.lockToken": lockToken,
          "legacyBokunRecovery.lockedAt": claimedAt,
          "legacyBokunRecovery.recoveryAttemptedAt": claimedAt,
          "legacyBokunRecovery.classification": isLegacyPricingCategoryFailure(
            booking.pendingCheckout?.finalization || {}
          ).classification,
          "legacyBokunRecovery.lastError": {}
        },
        $inc: { "legacyBokunRecovery.attemptCount": 1 }
      },
      { new: true }
    );

    if (!claimed) return null;

    await recordAudit({
      booking: claimed,
      action: "legacy_bokun_recovery_started",
      requestId,
      reason: "Paid legacy booking is eligible for one pricing-category recovery attempt.",
      metadata: { source }
    });

    return { booking: claimed, lockToken };
  };

  const completeRecovery = async ({ bookingId, lockToken, status, classification = "", error = null }) => {
    const update = {
      $set: {
        "legacyBokunRecovery.status": status,
        "legacyBokunRecovery.completedAt": now(),
        "legacyBokunRecovery.classification": classification
      },
      $unset: {
        "legacyBokunRecovery.lockToken": "",
        "legacyBokunRecovery.lockedAt": ""
      }
    };

    if (error) {
      const summary = summarizeError(error);
      update.$set["legacyBokunRecovery.lastError"] = {
        code: summary.code || "UNKNOWN_ERROR",
        statusCode: summary.statusCode || null,
        message: summary.message || "Legacy recovery failed",
        at: now()
      };
    } else {
      update.$set["legacyBokunRecovery.lastError"] = {};
    }

    return BookingModel.findOneAndUpdate(
      { _id: bookingId, "legacyBokunRecovery.lockToken": lockToken },
      update,
      { new: true }
    );
  };

  const lookupExistingSupplierBooking = async ({ booking, requestId }) => {
    const lookupReference = String(
      booking.bokunBookingId || booking.bokunConfirmationCode || booking.bookingReference || ""
    ).trim();
    if (!lookupReference) return null;

    try {
      const supplierBooking = await bokun.lookupBooking(lookupReference, requestId);
      return supplierBooking?.bokunBookingId ? supplierBooking : null;
    } catch (error) {
      const summary = summarizeError(error);
      if (summary.statusCode === 404 || /not found/.test(summary.message.toLowerCase())) {
        return null;
      }
      throw error;
    }
  };

  const reconcileExistingSupplierBooking = async ({ booking, lockToken, supplierBooking, requestId, source }) => {
    const supplierStatus = String(supplierBooking.status || "").toUpperCase();
    const confirmed = supplierStatus === "CONFIRMED";
    const updated = await BookingModel.findOneAndUpdate(
      { _id: booking._id, "legacyBokunRecovery.lockToken": lockToken },
      {
        $set: {
          bokunBookingId: String(supplierBooking.bokunBookingId || ""),
          bokunConfirmationCode: String(supplierBooking.confirmationCode || supplierBooking.bookingReference || ""),
          bookingStatus: confirmed ? "confirmed" : "pending",
          "syncState.lastBokunSyncAt": now(),
          "syncState.lastBokunSyncSource": "system",
          "syncState.lastBokunStatus": supplierStatus || "RECONCILED",
          "syncState.lastBokunSyncError": "",
          "pendingCheckout.finalization.status": confirmed ? "confirmed" : "pending_retry",
          "pendingCheckout.finalization.finalizationPending": !confirmed,
          "pendingCheckout.finalization.processingCompletedAt": now(),
          "legacyBokunRecovery.status": LEGACY_RECOVERY_STATUS.RECONCILED,
          "legacyBokunRecovery.completedAt": now(),
          "legacyBokunRecovery.lastError": {}
        },
        $unset: {
          "legacyBokunRecovery.lockToken": "",
          "legacyBokunRecovery.lockedAt": ""
        }
      },
      { new: true }
    );

    await recordAudit({
      booking: updated || booking,
      action: "legacy_bokun_recovery_reconciled",
      requestId,
      reason: "Existing supplier booking found before legacy recovery create attempt.",
      metadata: {
        source,
        bokunBookingId: supplierBooking.bokunBookingId,
        supplierStatus
      }
    });

    if (updated && confirmed) {
      await notifications.notifyBookingConfirmed({
        booking: updated,
        provider: updated.paymentMethod || "pesapal",
        requestId
      });
    }

    return { booking: updated, confirmed };
  };

  const recoverLegacyBooking = async ({
    bookingId,
    requestId = "",
    source = "system_reconciliation",
    finalizeBooking,
    syncInvoice
  } = {}) => {
    if (typeof finalizeBooking !== "function") {
      throw new Error("finalizeBooking dependency is required for legacy Bokun recovery");
    }

    let booking = await BookingModel.findById(bookingId);
    if (!booking) return { status: "skipped", reason: "booking_not_found" };

    let invoice = await InvoiceModel.findOne({ bookingReference: booking.bookingReference });
    if (!invoiceIsPaid(invoice, booking) && typeof syncInvoice === "function") {
      await syncInvoice({ bookingId: booking._id, requestId });
      booking = await BookingModel.findById(bookingId);
      invoice = await InvoiceModel.findOne({ bookingReference: booking.bookingReference });
    }

    const verifiedPaidAmount = await payments.getVerifiedPaidAmountByBookingReference({
      bookingReference: booking.bookingReference
    });
    const eligibility = evaluateLegacyRecoveryEligibility({
      booking,
      invoice,
      verifiedPaidAmount,
      now: now()
    });
    if (!eligibility.eligible) return { status: "skipped", reason: eligibility.reason, classification: eligibility.classification };

    const claimed = await claimRecovery({ booking, requestId, source });
    if (!claimed) return { status: "in_progress", reason: "recovery_lock_busy" };

    booking = claimed.booking;
    const { lockToken } = claimed;

    try {
      await recordAudit({
        booking,
        action: "legacy_bokun_recovery_reconciliation_started",
        requestId,
        reason: "Checking Bókun before rebuilding the legacy booking payload.",
        metadata: { source }
      });
      const supplierBooking = await lookupExistingSupplierBooking({ booking, requestId });
      if (supplierBooking) {
        const reconciled = await reconcileExistingSupplierBooking({
          booking,
          lockToken,
          supplierBooking,
          requestId,
          source
        });
        return {
          status: "reconciled",
          booking: reconciled.booking,
          duplicatePrevented: true,
          confirmed: reconciled.confirmed
        };
      }

      await recordAudit({
        booking,
        action: "legacy_bokun_recovery_payload_rebuilt",
        requestId,
        reason: "Rebuilding the supplier payload from current live Bókun categories.",
        metadata: { source }
      });
      await recordAudit({
        booking,
        action: "legacy_bokun_recovery_retry_sent",
        requestId,
        reason: "Sending one rebuilt, payment-safe Bókun recovery request.",
        metadata: { source }
      });

      const finalized = await finalizeBooking({
        bookingId: booking._id,
        transactionToken: String(booking.paymentTransactionId || booking.dpoTransactionToken || ""),
        paymentMethod: booking.paymentMethod || "pesapal",
        paymentProvider: ["dpo", "paypal", "pesapal"].includes(booking.paymentMethod)
          ? booking.paymentMethod
          : "pesapal",
        requestId,
        source: "legacy_pricing_category_recovery",
        force: false,
        auditReason: "Legacy Bókun pricing-category recovery confirmed the paid booking"
      });

      const completed = await completeRecovery({
        bookingId: booking._id,
        lockToken,
        status: LEGACY_RECOVERY_STATUS.RECOVERED,
        classification: eligibility.classification
      });
      await recordAudit({
        booking: completed || finalized.booking || booking,
        action: "legacy_bokun_recovery_payload_validation_passed",
        requestId,
        reason: "Current payload validation passed and Bókun confirmed the booking.",
        metadata: { source, bokunBookingId: finalized.response?.bokunBookingId || "" }
      });
      await recordAudit({
        booking: completed || finalized.booking || booking,
        action: "legacy_bokun_recovery_booking_confirmed",
        requestId,
        reason: "Legacy Bókun recovery completed without changing payment or invoice records.",
        metadata: { source }
      });

      return { status: "recovered", booking: finalized.booking, response: finalized.response };
    } catch (error) {
      const classification = classifyBokunFinalizationError(error);
      const temporary = classification === RECOVERY_ERROR_CLASSIFICATION.TEMPORARY_PROVIDER_ERROR;
      const completed = await completeRecovery({
        bookingId: booking._id,
        lockToken,
        status: temporary ? LEGACY_RECOVERY_STATUS.HANDOFF : LEGACY_RECOVERY_STATUS.MANUAL_REVIEW,
        classification,
        error
      });

      await recordAudit({
        booking: completed || booking,
        action: temporary
          ? "legacy_bokun_recovery_handed_to_standard_retry"
          : "legacy_bokun_recovery_manual_review_required",
        requestId,
        reason: temporary
          ? "Supplier was temporarily unavailable; standard finalization retry remains responsible."
          : "Legacy recovery encountered a permanent supplier validation or configuration error.",
        metadata: { source, classification, error: summarizeError(error) }
      });

      if (classification === RECOVERY_ERROR_CLASSIFICATION.MISSING_PRICING_CATEGORY) {
        await recordAudit({
          booking: completed || booking,
          action: "legacy_bokun_recovery_payload_validation_failed",
          requestId,
          reason: "Rebuilt payload still has no valid Bókun pricing category.",
          metadata: { source, error: summarizeError(error) }
        });
      }

      return {
        status: temporary ? "pending_retry" : "manual_review_required",
        booking: completed || booking,
        classification,
        error: summarizeError(error)
      };
    }
  };

  const recoverLegacyPricingCategoryBookings = async ({
    limit = 20,
    requestId = "",
    source = "system_reconciliation",
    finalizeBooking,
    syncInvoice
  } = {}) => {
    const safeLimit = Math.max(1, Math.min(100, Number(limit || 20)));
    const summary = createSummary(safeLimit);
    const candidates = await BookingModel.find(buildLegacyRecoveryCandidateQuery({ now: now() }))
      .sort({ travelDate: 1, updatedAt: 1 })
      .limit(safeLimit);

    const results = [];
    for (const candidate of candidates) {
      summary.scanned += 1;
      const result = await recoverLegacyBooking({
        bookingId: candidate._id,
        requestId,
        source,
        finalizeBooking,
        syncInvoice
      });
      results.push({ bookingId: candidate._id.toString(), bookingReference: candidate.bookingReference, ...result });

      if (result.status === "skipped") {
        incrementSkip(summary, result.reason);
        continue;
      }
      if (result.status === "in_progress") {
        summary.inProgress += 1;
        incrementSkip(summary, result.reason);
        continue;
      }

      summary.eligible += 1;
      summary.processed += 1;
      if (result.status === "recovered") {
        summary.successful += 1;
        summary.confirmed += 1;
      }
      if (result.status === "reconciled") {
        summary.successful += 1;
        summary.duplicatesPrevented += 1;
        if (result.confirmed) summary.confirmed += 1;
      }
      if (result.status === "pending_retry") {
        summary.pendingRetry += 1;
      }
      if (result.status === "manual_review_required") {
        summary.failed += 1;
        summary.manualReview += 1;
      }
    }

    return { summary, results };
  };

  return {
    recoverLegacyBooking,
    recoverLegacyPricingCategoryBookings
  };
};

const legacyBokunRecoveryService = createLegacyBokunRecoveryService();

module.exports = {
  ...legacyBokunRecoveryService,
  createLegacyBokunRecoveryService,
  LEGACY_RECOVERY_STATUS,
  RECOVERY_ERROR_CLASSIFICATION,
  classifyBokunFinalizationError,
  evaluateLegacyRecoveryEligibility,
  buildLegacyRecoveryCandidateQuery,
  isLegacyPricingCategoryFailure
};
