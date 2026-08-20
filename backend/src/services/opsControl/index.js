const mongoose = require("mongoose");
const AuditLog = require("../../models/AuditLog");
const Booking = require("../../models/Booking");
const BookingRequest = require("../../models/BookingRequest");
const EmailDelivery = require("../../models/EmailDelivery");
const Payment = require("../../models/Payment");
const Refund = require("../../models/Refund");
const ReportExport = require("../../models/ReportExport");
const SyncLog = require("../../models/SyncLog");
const SystemAlert = require("../../models/SystemAlert");
const bookingRequestsService = require("../bookingRequests");
const bookingsService = require("../bookings");
const dataQualityService = require("../dataQuality");
const AppError = require("../../utils/AppError");

const ALERT_CATEGORY = Object.freeze({
  OPERATIONS: "OPERATIONS",
  FINANCE: "FINANCE",
  PAYMENTS: "PAYMENTS",
  REFUNDS: "REFUNDS",
  RECONCILIATION: "RECONCILIATION",
  DATA_QUALITY: "DATA_QUALITY",
  SECURITY: "SECURITY",
  BOKUN_SYNC: "BOKUN_SYNC",
  BUSINESS_PERFORMANCE: "BUSINESS_PERFORMANCE"
});

const ALERT_STATE = Object.freeze({
  OPEN: "OPEN",
  ACKNOWLEDGED: "ACKNOWLEDGED",
  RESOLVED: "RESOLVED",
  DISMISSED: "DISMISSED"
});

const ALERT_SEVERITY = Object.freeze({
  INFO: "INFO",
  WARNING: "WARNING",
  ERROR: "ERROR",
  CRITICAL: "CRITICAL"
});

const FAILED_JOB_TYPE = Object.freeze({
  BOKUN_SYNC_LOG: "BOKUN_SYNC_LOG",
  BOOKING_FINALIZATION: "BOOKING_FINALIZATION",
  BOOKING_LEGACY_BOKUN_RECOVERY: "BOOKING_LEGACY_BOKUN_RECOVERY",
  BOOKING_REQUEST_BOKUN_SYNC: "BOOKING_REQUEST_BOKUN_SYNC",
  BOOKING_REQUEST_EMAIL: "BOOKING_REQUEST_EMAIL",
  BOOKING_REQUEST_WORKFLOW: "BOOKING_REQUEST_WORKFLOW",
  REFUND_VERIFICATION: "REFUND_VERIFICATION",
  REPORT_EXPORT: "REPORT_EXPORT",
  PAYMENT_RECONCILIATION: "PAYMENT_RECONCILIATION"
});

const EXPLICIT_RESOLUTION_CATEGORIES = new Set([
  ALERT_CATEGORY.FINANCE,
  ALERT_CATEGORY.PAYMENTS,
  ALERT_CATEGORY.REFUNDS,
  ALERT_CATEGORY.RECONCILIATION,
  ALERT_CATEGORY.SECURITY
]);

const defaultModels = {
  AlertModel: SystemAlert,
  AuditLogModel: AuditLog,
  BookingModel: Booking,
  BookingRequestModel: BookingRequest,
  EmailDeliveryModel: EmailDelivery,
  PaymentModel: Payment,
  RefundModel: Refund,
  ReportExportModel: ReportExport,
  SyncLogModel: SyncLog
};

const defaultRetryHandlers = {
  [FAILED_JOB_TYPE.BOOKING_FINALIZATION]: ({ sourceId, auth, requestId, force }) =>
    bookingsService.retryBookingFinalization({ bookingId: sourceId, auth, requestId, force }),
  [FAILED_JOB_TYPE.BOOKING_REQUEST_BOKUN_SYNC]: ({ sourceId, auth, requestId }) =>
    bookingRequestsService.retryBokunSync({ requestId: sourceId, auth, traceId: requestId }),
  [FAILED_JOB_TYPE.BOOKING_REQUEST_EMAIL]: ({ sourceId, auth, requestId }) =>
    bookingRequestsService.retryRequestEmail({ requestId: sourceId, auth, traceId: requestId }),
  [FAILED_JOB_TYPE.REFUND_VERIFICATION]: ({ sourceId, auth, requestId }) =>
    bookingRequestsService.verifyRefundStatus({ refundId: sourceId, auth, traceId: requestId })
};

const normalizeToken = (value = "") => String(value || "").trim();
const normalizeUpper = (value = "") => normalizeToken(value).toUpperCase();
const getId = (record = {}) => normalizeToken(record.id || record._id);
const parseDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const toIso = (value) => {
  const date = parseDate(value);
  return date ? date.toISOString() : "";
};
const actorId = (auth = {}) => normalizeToken(auth?.id || auth?._id || auth?.email || auth?.role || "system");
const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const compactError = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 1000);
  if (value.message) return String(value.message).slice(0, 1000);
  if (value.code || value.statusCode) return `${value.code || "ERROR"} ${value.statusCode || ""}`.trim();
  try {
    return JSON.stringify(value).slice(0, 1000);
  } catch (_error) {
    return "Unserializable error";
  }
};

const safeMetadata = (value, depth = 0) => {
  if (value === null || value === undefined) return value;
  if (depth > 6) return "[truncated]";
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => safeMetadata(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 100)
      .map(([key, item]) => [
        key,
        /token|secret|password|authorization|api[_-]?key|card|cvv|cvc|signature/i.test(key)
          ? "[redacted]"
          : safeMetadata(item, depth + 1)
      ])
  );
};

const createPagination = ({ page = 1, limit = 50, total = 0 } = {}) => {
  const currentPage = Math.max(Number(page || 1), 1);
  const safeLimit = Math.min(Math.max(Number(limit || 50), 1), 200);
  return {
    page: currentPage,
    limit: safeLimit,
    total,
    totalPages: total > 0 ? Math.ceil(total / safeLimit) : 0,
    hasNextPage: currentPage * safeLimit < total
  };
};

const queryToArray = async ({ queryResult, sort = { updatedAt: -1 }, skip = 0, limit = 100 } = {}) => {
  if (!queryResult) return [];
  if (Array.isArray(queryResult)) {
    return queryResult
      .slice()
      .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0))
      .slice(skip, skip + limit);
  }
  if (typeof queryResult.then === "function" && !queryResult.sort) {
    const resolved = await queryResult;
    return Array.isArray(resolved) ? resolved.slice(skip, skip + limit) : resolved ? [resolved] : [];
  }

  let query = queryResult;
  if (query.sort) query = query.sort(sort);
  if (query.skip) query = query.skip(skip);
  if (query.limit) query = query.limit(limit);
  if (query.lean) query = query.lean();
  const rows = await query;
  return Array.isArray(rows) ? rows : rows ? [rows] : [];
};

const queryOne = async (queryResult) => {
  if (!queryResult) return null;
  if (Array.isArray(queryResult)) return queryResult[0] || null;
  if (typeof queryResult.then === "function" && !queryResult.lean) return queryResult;
  const result = queryResult.lean ? await queryResult.lean() : await queryResult;
  return result || null;
};

const countDocuments = async ({ Model, query = {}, fallback = [] }) => {
  if (Model?.countDocuments) return Model.countDocuments(query);
  return Array.isArray(fallback) ? fallback.length : 0;
};

const hasDateInRange = (record = {}, filters = {}) => {
  const from = parseDate(filters.fromDate);
  const to = parseDate(filters.toDate);
  if (!from && !to) return true;
  const date = parseDate(record.lastFailureAt || record.lastSeenAt || record.updatedAt || record.createdAt || record.completedAt || record.startedAt);
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
};

const stableKey = (...parts) =>
  parts
    .map((part) => normalizeToken(part).replace(/\s+/g, "_"))
    .filter(Boolean)
    .join("::");

const extractSyncLogReference = (log = {}) =>
  normalizeToken(
    log.details?.bookingReference ||
      log.details?.bookingId ||
      log.details?.reference ||
      log.details?.requestId ||
      log.operation ||
      getId(log)
  );

const extractSyncLogError = (log = {}) =>
  compactError(
    log.details?.error ||
      log.details?.lastError ||
      log.details?.message ||
      log.details?.summary?.error ||
      log.details?.results?.find?.((item) => item.error || item.errorMessage)
  );

const normalizeFailedJob = ({
  jobType,
  category,
  sourceType,
  sourceId,
  reference = "",
  attempts = 0,
  lastError = "",
  firstFailureAt = "",
  lastFailureAt = "",
  nextRetryAt = "",
  status = "failed",
  severity = ALERT_SEVERITY.WARNING,
  canRetry = false,
  retryLabel = "",
  retryEndpoint = "",
  metadata = {}
}) => {
  const id = stableKey("FAILED_JOB", jobType, sourceType, sourceId || reference);
  return {
    id,
    jobType,
    category,
    sourceType,
    sourceId: normalizeToken(sourceId),
    reference: normalizeToken(reference || sourceId),
    attempts: Number(attempts || 0),
    lastError: compactError(lastError),
    firstFailureAt: toIso(firstFailureAt),
    lastFailureAt: toIso(lastFailureAt || firstFailureAt),
    nextRetryAt: toIso(nextRetryAt),
    status: normalizeToken(status || "failed"),
    severity,
    retry: {
      canRetry: Boolean(canRetry),
      label: retryLabel || (canRetry ? "Retry" : "Manual review required"),
      endpoint: retryEndpoint
    },
    metadata: safeMetadata(metadata)
  };
};

const systemAlertRequiresExplicitResolution = (alert = {}) =>
  alert.severity === ALERT_SEVERITY.CRITICAL && EXPLICIT_RESOLUTION_CATEGORIES.has(alert.category);

const normalizeAlert = (alert = {}, { persisted = false } = {}) => {
  const normalized = {
    id: normalizeToken(alert.id || alert._id || alert.alertKey),
    alertKey: normalizeToken(alert.alertKey || alert.id),
    category: normalizeUpper(alert.category || ALERT_CATEGORY.OPERATIONS),
    severity: normalizeUpper(alert.severity || ALERT_SEVERITY.WARNING),
    state: normalizeUpper(alert.state || ALERT_STATE.OPEN),
    title: normalizeToken(alert.title || "System alert"),
    message: normalizeToken(alert.message || ""),
    sourceType: normalizeToken(alert.sourceType || ""),
    sourceId: normalizeToken(alert.sourceId || ""),
    reference: normalizeToken(alert.reference || ""),
    assignedTo: normalizeToken(alert.assignedTo || ""),
    acknowledgedBy: normalizeToken(alert.acknowledgedBy || ""),
    acknowledgedAt: toIso(alert.acknowledgedAt),
    resolvedBy: normalizeToken(alert.resolvedBy || ""),
    resolvedAt: toIso(alert.resolvedAt),
    dismissedBy: normalizeToken(alert.dismissedBy || ""),
    dismissedAt: toIso(alert.dismissedAt),
    resolutionNote: normalizeToken(alert.resolutionNote || ""),
    firstSeenAt: toIso(alert.firstSeenAt || alert.createdAt),
    lastSeenAt: toIso(alert.lastSeenAt || alert.updatedAt || alert.createdAt),
    metadata: safeMetadata(alert.metadata || {}),
    persisted: Boolean(persisted)
  };
  normalized.requiresExplicitResolution = systemAlertRequiresExplicitResolution(normalized);
  return normalized;
};

const alertFromFailedJob = (job = {}) =>
  normalizeAlert({
    alertKey: stableKey("ALERT", "FAILED_JOB", job.jobType, job.sourceType, job.sourceId || job.reference),
    category: job.category,
    severity: job.severity,
    state: ALERT_STATE.OPEN,
    title: `${job.jobType.replace(/_/g, " ")} failed`,
    message: job.lastError || "A background or operational job needs attention.",
    sourceType: job.sourceType,
    sourceId: job.sourceId,
    reference: job.reference,
    firstSeenAt: job.firstFailureAt,
    lastSeenAt: job.lastFailureAt,
    metadata: {
      failedJobId: job.id,
      attempts: job.attempts,
      nextRetryAt: job.nextRetryAt,
      retry: job.retry
    }
  });

const alertFromDataQualityIssue = (issue = {}) =>
  normalizeAlert({
    alertKey: stableKey("ALERT", "DATA_QUALITY", issue.code, issue.entityType, issue.entityId || issue.reference),
    category: ALERT_CATEGORY.DATA_QUALITY,
    severity: issue.severity || ALERT_SEVERITY.WARNING,
    state: ALERT_STATE.OPEN,
    title: `${issue.code || "DATA_QUALITY_ISSUE"} on ${issue.entityType || "record"}`,
    message: issue.message || "Data quality issue needs review.",
    sourceType: issue.entityType || "DataQuality",
    sourceId: issue.entityId || "",
    reference: issue.reference || "",
    metadata: {
      code: issue.code || "",
      evidence: issue.evidence || {},
      recommendedAction: issue.recommendedAction || ""
    }
  });

const filterJobs = (jobs, filters = {}) => {
  const jobType = normalizeUpper(filters.jobType);
  const status = normalizeToken(filters.status).toLowerCase();
  const category = normalizeUpper(filters.category);
  const reference = normalizeToken(filters.reference).toLowerCase();

  return jobs.filter((job) => {
    if (jobType && job.jobType !== jobType) return false;
    if (status && job.status.toLowerCase() !== status) return false;
    if (category && job.category !== category) return false;
    if (reference && !`${job.reference} ${job.sourceId} ${job.lastError}`.toLowerCase().includes(reference)) return false;
    return hasDateInRange(job, filters);
  });
};

const filterAlerts = (alerts, filters = {}) => {
  const state = normalizeUpper(filters.state);
  const severity = normalizeUpper(filters.severity);
  const category = normalizeUpper(filters.category);
  const reference = normalizeToken(filters.reference).toLowerCase();
  const includeClosed = String(filters.includeClosed || "false") === "true";

  return alerts.filter((alert) => {
    if (state && alert.state !== state) return false;
    if (!state && !includeClosed && [ALERT_STATE.RESOLVED, ALERT_STATE.DISMISSED].includes(alert.state)) return false;
    if (severity && alert.severity !== severity) return false;
    if (category && alert.category !== category) return false;
    if (reference && !`${alert.reference} ${alert.sourceId} ${alert.title} ${alert.message}`.toLowerCase().includes(reference)) return false;
    return hasDateInRange(alert, filters);
  });
};

const buildAlertIdentityQuery = (alertId = "") => {
  const id = normalizeToken(alertId);
  if (!id) throw new AppError("Alert ID is required.", 422, "ALERT_ID_REQUIRED");
  const clauses = [{ alertKey: id }];
  if (isObjectId(id)) clauses.push({ _id: id });
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
};

const createOpsControlService = ({
  models = defaultModels,
  retryHandlers = defaultRetryHandlers,
  dataQuality = dataQualityService,
  now = () => new Date()
} = {}) => {
  const listFailedJobs = async (filters = {}) => {
    const pagination = createPagination(filters);
    const scanLimit = Math.min(Math.max(Number(filters.scanLimit || pagination.limit || 50), 1), 500);
    const [
      syncLogs,
      bookings,
      bookingRequests,
      emailDeliveries,
      refunds,
      payments,
      reportExports
    ] = await Promise.all([
      queryToArray({
        queryResult: models.SyncLogModel.find({ status: "failed" }),
        sort: { updatedAt: -1 },
        limit: scanLimit
      }),
      queryToArray({
        queryResult: models.BookingModel.find({
          $or: [
            { "pendingCheckout.finalization.status": { $in: ["failed", "pending_retry"] } },
            { "legacyBokunRecovery.status": "manual_review_required" },
            { supplierStatus: "supplier_failed" },
            { "syncState.lastBokunSyncError": { $type: "string", $ne: "" } },
            { "bokunImport.lastError": { $type: "string", $ne: "" } }
          ]
        }),
        sort: { updatedAt: -1 },
        limit: scanLimit
      }),
      queryToArray({
        queryResult: models.BookingRequestModel.find({
          $or: [
            { status: "failed" },
            { "bokunSync.status": { $in: ["failed", "manual_action_required"] } },
            { "refund.status": { $in: ["failed", "verification_required", "manual_refund_required"] } }
          ]
        }),
        sort: { updatedAt: -1 },
        limit: scanLimit
      }),
      queryToArray({
        queryResult: models.EmailDeliveryModel.find({ status: "failed" }),
        sort: { updatedAt: -1 },
        limit: scanLimit
      }),
      queryToArray({
        queryResult: models.RefundModel.find({
          status: { $in: ["failed", "verification_required", "manual_refund_required"] }
        }),
        sort: { updatedAt: -1 },
        limit: scanLimit
      }),
      queryToArray({
        queryResult: models.PaymentModel.find({
          $or: [
            { "anomaly.flagged": true },
            { verificationStatus: { $in: ["amount_mismatch", "currency_review_required", "reference_mismatch", "provider_error", "manual_review"] } },
            { accountingAllocationStatus: "blocked" },
            { status: "failed" },
            { paymentStatus: "failed" }
          ]
        }),
        sort: { updatedAt: -1 },
        limit: scanLimit
      }),
      queryToArray({
        queryResult: models.ReportExportModel.find({ status: "failed" }),
        sort: { generatedAt: -1 },
        limit: scanLimit
      })
    ]);

    const jobs = [];

    syncLogs.forEach((log) => {
      jobs.push(normalizeFailedJob({
        jobType: FAILED_JOB_TYPE.BOKUN_SYNC_LOG,
        category: ALERT_CATEGORY.BOKUN_SYNC,
        sourceType: "SyncLog",
        sourceId: getId(log),
        reference: extractSyncLogReference(log),
        attempts: log.details?.attempts || log.details?.summary?.processed || 1,
        lastError: extractSyncLogError(log) || "Sync log ended as failed.",
        firstFailureAt: log.startedAt || log.createdAt,
        lastFailureAt: log.completedAt || log.updatedAt || log.createdAt,
        nextRetryAt: log.details?.retryAt || "",
        status: log.status || "failed",
        severity: log.operation === "confirmed_booking_import" ? ALERT_SEVERITY.ERROR : ALERT_SEVERITY.WARNING,
        canRetry: false,
        retryLabel: "Use the matching manual sync action",
        metadata: {
          operation: log.operation,
          source: log.source,
          details: log.details || {}
        }
      }));
    });

    bookings.forEach((booking) => {
      const finalization = booking.pendingCheckout?.finalization || {};
      if (["failed", "pending_retry"].includes(finalization.status)) {
        jobs.push(normalizeFailedJob({
          jobType: FAILED_JOB_TYPE.BOOKING_FINALIZATION,
          category: ALERT_CATEGORY.BOKUN_SYNC,
          sourceType: "Booking",
          sourceId: getId(booking),
          reference: booking.bookingReference,
          attempts: finalization.attemptCount || 0,
          lastError: finalization.lastError || "Paid booking finalization did not complete.",
          firstFailureAt: finalization.firstFailedAt || finalization.lastAttemptAt || booking.updatedAt,
          lastFailureAt: finalization.lastError?.at || finalization.lastAttemptAt || booking.updatedAt,
          nextRetryAt: finalization.nextRetryAt || "",
          status: finalization.status,
          severity: ALERT_SEVERITY.ERROR,
          canRetry: true,
          retryLabel: "Retry Bokun finalization",
          retryEndpoint: `/api/bookings/${getId(booking)}/finalization/retry`,
          metadata: {
            bookingReference: booking.bookingReference,
            paymentStatus: booking.paymentStatus,
            invoiceStatus: booking.invoiceSnapshot?.paymentStatus || ""
          }
        }));
      }

      if (booking.legacyBokunRecovery?.status === "manual_review_required") {
        jobs.push(normalizeFailedJob({
          jobType: FAILED_JOB_TYPE.BOOKING_LEGACY_BOKUN_RECOVERY,
          category: ALERT_CATEGORY.BOKUN_SYNC,
          sourceType: "Booking",
          sourceId: getId(booking),
          reference: booking.bookingReference,
          attempts: booking.legacyBokunRecovery?.attemptCount || 0,
          lastError: booking.legacyBokunRecovery?.lastError || "Legacy Bokun recovery requires manual review.",
          firstFailureAt: booking.legacyBokunRecovery?.recoveryAttemptedAt || booking.updatedAt,
          lastFailureAt: booking.legacyBokunRecovery?.lastError?.at || booking.updatedAt,
          status: booking.legacyBokunRecovery?.status,
          severity: ALERT_SEVERITY.ERROR,
          canRetry: false,
          retryLabel: "Manual review required",
          metadata: {
            classification: booking.legacyBokunRecovery?.classification || ""
          }
        }));
      }

      const syncError = booking.syncState?.lastBokunSyncError || booking.bokunImport?.lastError || booking.supplierFailureReason || "";
      if (syncError || booking.supplierStatus === "supplier_failed") {
        jobs.push(normalizeFailedJob({
          jobType: FAILED_JOB_TYPE.BOKUN_SYNC_LOG,
          category: ALERT_CATEGORY.BOKUN_SYNC,
          sourceType: "Booking",
          sourceId: getId(booking),
          reference: booking.bookingReference,
          attempts: 0,
          lastError: syncError || "Supplier status is failed.",
          firstFailureAt: booking.syncState?.lastBokunSyncAt || booking.bokunImport?.lastSyncedAt || booking.updatedAt,
          lastFailureAt: booking.updatedAt,
          status: booking.supplierStatus === "supplier_failed" ? "supplier_failed" : "failed",
          severity: ALERT_SEVERITY.WARNING,
          canRetry: false,
          retryLabel: "Use Bokun resync",
          metadata: {
            supplierStatus: booking.supplierStatus || "",
            lastBokunStatus: booking.syncState?.lastBokunStatus || ""
          }
        }));
      }
    });

    bookingRequests.forEach((request) => {
      if (["failed", "manual_action_required"].includes(request.bokunSync?.status)) {
        jobs.push(normalizeFailedJob({
          jobType: FAILED_JOB_TYPE.BOOKING_REQUEST_BOKUN_SYNC,
          category: ALERT_CATEGORY.BOKUN_SYNC,
          sourceType: "BookingRequest",
          sourceId: getId(request),
          reference: request.requestReference,
          attempts: request.bokunSync?.attempts || 0,
          lastError: request.bokunSync?.lastError || "Booking request Bokun sync needs attention.",
          firstFailureAt: request.bokunSync?.lastAttemptAt || request.updatedAt,
          lastFailureAt: request.bokunSync?.lastAttemptAt || request.updatedAt,
          status: request.bokunSync?.status,
          severity: ALERT_SEVERITY.ERROR,
          canRetry: request.bokunSync?.status === "failed",
          retryLabel: "Retry request Bokun sync",
          retryEndpoint: `/api/admin/booking-requests/${getId(request)}/retry-bokun-sync`,
          metadata: {
            requestType: request.type,
            bookingId: normalizeToken(request.booking)
          }
        }));
      }

      if (["failed", "verification_required", "manual_refund_required"].includes(request.refund?.status)) {
        jobs.push(normalizeFailedJob({
          jobType: FAILED_JOB_TYPE.REFUND_VERIFICATION,
          category: ALERT_CATEGORY.REFUNDS,
          sourceType: request.refund?.refundId ? "Refund" : "BookingRequest",
          sourceId: normalizeToken(request.refund?.refundId || getId(request)),
          reference: request.requestReference,
          attempts: 0,
          lastError: request.refund?.providerResolution?.manualReviewReason || request.refund?.status || "Refund requires verification.",
          firstFailureAt: request.updatedAt,
          lastFailureAt: request.updatedAt,
          status: request.refund?.status,
          severity: request.refund?.status === "failed" ? ALERT_SEVERITY.ERROR : ALERT_SEVERITY.WARNING,
          canRetry: Boolean(request.refund?.refundId && request.refund?.status === "verification_required"),
          retryLabel: request.refund?.status === "verification_required" ? "Verify refund status" : "Manual refund review required",
          retryEndpoint: request.refund?.refundId ? `/api/admin/refunds/${request.refund.refundId}/verify` : "",
          metadata: {
            provider: request.refund?.provider || "",
            providerRefundRequestReference: request.refund?.providerRefundRequestReference || ""
          }
        }));
      }

      if (request.status === "failed") {
        jobs.push(normalizeFailedJob({
          jobType: FAILED_JOB_TYPE.BOOKING_REQUEST_WORKFLOW,
          category: ALERT_CATEGORY.OPERATIONS,
          sourceType: "BookingRequest",
          sourceId: getId(request),
          reference: request.requestReference,
          attempts: request.bokunSync?.attempts || 0,
          lastError: request.bokunSync?.lastError || "Booking request workflow failed.",
          firstFailureAt: request.updatedAt,
          lastFailureAt: request.updatedAt,
          status: request.status,
          severity: ALERT_SEVERITY.WARNING,
          canRetry: false,
          retryLabel: "Review booking request"
        }));
      }
    });

    emailDeliveries.forEach((delivery) => {
      jobs.push(normalizeFailedJob({
        jobType: FAILED_JOB_TYPE.BOOKING_REQUEST_EMAIL,
        category: ALERT_CATEGORY.OPERATIONS,
        sourceType: "EmailDelivery",
        sourceId: getId(delivery),
        reference: delivery.bookingReference,
        attempts: delivery.lastAttemptAt ? 1 : 0,
        lastError: delivery.error || "Transactional email failed.",
        firstFailureAt: delivery.lastAttemptAt || delivery.updatedAt,
        lastFailureAt: delivery.lastAttemptAt || delivery.updatedAt,
        status: delivery.status,
        severity: ALERT_SEVERITY.WARNING,
        canRetry: false,
        retryLabel: "Retry from booking request when available",
        metadata: {
          templateKey: delivery.templateKey,
          recipient: delivery.recipient,
          provider: delivery.provider
        }
      }));
    });

    refunds.forEach((refund) => {
      jobs.push(normalizeFailedJob({
        jobType: FAILED_JOB_TYPE.REFUND_VERIFICATION,
        category: ALERT_CATEGORY.REFUNDS,
        sourceType: "Refund",
        sourceId: getId(refund),
        reference: refund.refundReference,
        attempts: 0,
        lastError: refund.failureReason || refund.metadata?.providerMessage || "Refund provider status needs review.",
        firstFailureAt: refund.failedAt || refund.lastRefundSyncAt || refund.updatedAt,
        lastFailureAt: refund.failedAt || refund.lastRefundSyncAt || refund.updatedAt,
        status: refund.status,
        severity: refund.status === "failed" ? ALERT_SEVERITY.ERROR : ALERT_SEVERITY.WARNING,
        canRetry: refund.status === "verification_required",
        retryLabel: refund.status === "verification_required" ? "Verify refund status" : "Manual refund review required",
        retryEndpoint: `/api/admin/refunds/${getId(refund)}/verify`,
        metadata: {
          provider: refund.provider,
          providerRefundRequestReference: refund.providerRefundRequestReference || "",
          providerRefundReference: refund.providerRefundReference || ""
        }
      }));
    });

    payments.forEach((payment) => {
      jobs.push(normalizeFailedJob({
        jobType: FAILED_JOB_TYPE.PAYMENT_RECONCILIATION,
        category: ALERT_CATEGORY.PAYMENTS,
        sourceType: "Payment",
        sourceId: getId(payment),
        reference: payment.bookingReference || payment.intentId,
        attempts: 0,
        lastError: payment.anomaly?.message || payment.verificationReason || payment.providerStatus || "Payment reconciliation needs review.",
        firstFailureAt: payment.lastVerifiedAt || payment.updatedAt,
        lastFailureAt: payment.updatedAt,
        status: payment.verificationStatus || payment.accountingAllocationStatus || payment.status || payment.paymentStatus || "failed",
        severity: ALERT_SEVERITY.ERROR,
        canRetry: false,
        retryLabel: "Use payment reconciliation action",
        metadata: {
          provider: payment.provider,
          anomaly: payment.anomaly || {},
          verificationStatus: payment.verificationStatus || "",
          accountingAllocationStatus: payment.accountingAllocationStatus || ""
        }
      }));
    });

    reportExports.forEach((reportExport) => {
      jobs.push(normalizeFailedJob({
        jobType: FAILED_JOB_TYPE.REPORT_EXPORT,
        category: ALERT_CATEGORY.OPERATIONS,
        sourceType: "ReportExport",
        sourceId: getId(reportExport),
        reference: `${reportExport.reportType || "report"}:${reportExport.format || "export"}`,
        attempts: 1,
        lastError: reportExport.error || "Report export failed.",
        firstFailureAt: reportExport.generatedAt || reportExport.createdAt,
        lastFailureAt: reportExport.generatedAt || reportExport.updatedAt,
        status: reportExport.status,
        severity: ALERT_SEVERITY.WARNING,
        canRetry: false,
        retryLabel: "Run export again from report center",
        metadata: {
          reportType: reportExport.reportType,
          format: reportExport.format,
          filters: reportExport.filters || {}
        }
      }));
    });

    const filtered = filterJobs(jobs, filters);
    const start = (pagination.page - 1) * pagination.limit;
    const paged = filtered
      .sort((left, right) => new Date(right.lastFailureAt || 0) - new Date(left.lastFailureAt || 0))
      .slice(start, start + pagination.limit);

    return {
      generatedAt: now().toISOString(),
      items: paged,
      pagination: createPagination({ ...pagination, total: filtered.length }),
      counts: {
        total: filtered.length,
        retryable: filtered.filter((job) => job.retry.canRetry).length,
        manualActionRequired: filtered.filter((job) => !job.retry.canRetry).length
      },
      jobTypes: Object.values(FAILED_JOB_TYPE),
      limitations: [
        "Failed jobs are derived from existing persisted workflow evidence; this view does not invent a separate queue.",
        "Retry is enabled only for job types with existing backend-safe retry or verification handlers."
      ]
    };
  };

  const buildDerivedAlerts = async (filters = {}) => {
    const [jobs, dataQualityIssues] = await Promise.all([
      listFailedJobs({ ...filters, limit: Math.min(Number(filters.limit || 50), 100) }),
      dataQuality.listIssues({
        limit: Math.min(Number(filters.dataQualityScanLimit || 500), 5000),
        issueLimit: Math.min(Number(filters.dataQualityIssueLimit || 100), 500)
      }).catch(() => ({ items: [] }))
    ]);

    return [
      ...jobs.items.map(alertFromFailedJob),
      ...(dataQualityIssues.items || [])
        .filter((issue) => [ALERT_SEVERITY.ERROR, ALERT_SEVERITY.CRITICAL].includes(issue.severity))
        .map(alertFromDataQualityIssue)
    ];
  };

  const listSystemAlerts = async (filters = {}) => {
    const pagination = createPagination(filters);
    const persistentQuery = {};
    if (filters.state) persistentQuery.state = normalizeUpper(filters.state);
    if (filters.category) persistentQuery.category = normalizeUpper(filters.category);
    if (filters.severity) persistentQuery.severity = normalizeUpper(filters.severity);

    const [persistedRows, derivedRows] = await Promise.all([
      queryToArray({
        queryResult: models.AlertModel.find(persistentQuery),
        sort: { lastSeenAt: -1, updatedAt: -1 },
        limit: 500
      }),
      buildDerivedAlerts(filters)
    ]);
    const persistedByKey = new Map(persistedRows.map((row) => [normalizeToken(row.alertKey), normalizeAlert(row, { persisted: true })]));
    const mergedByKey = new Map(persistedByKey);

    derivedRows.forEach((derived) => {
      const persisted = persistedByKey.get(derived.alertKey);
      mergedByKey.set(derived.alertKey, persisted ? { ...derived, ...persisted, metadata: { ...derived.metadata, ...persisted.metadata } } : derived);
    });

    const filtered = filterAlerts([...mergedByKey.values()], filters);
    const start = (pagination.page - 1) * pagination.limit;
    const paged = filtered
      .sort((left, right) => new Date(right.lastSeenAt || 0) - new Date(left.lastSeenAt || 0))
      .slice(start, start + pagination.limit);

    const countsByState = Object.values(ALERT_STATE).reduce((counts, state) => {
      counts[state] = filtered.filter((alert) => alert.state === state).length;
      return counts;
    }, {});
    const countsByCategory = Object.values(ALERT_CATEGORY).reduce((counts, category) => {
      const count = filtered.filter((alert) => alert.category === category).length;
      if (count > 0) counts[category] = count;
      return counts;
    }, {});
    const countsBySeverity = Object.values(ALERT_SEVERITY).reduce((counts, severity) => {
      counts[severity] = filtered.filter((alert) => alert.severity === severity).length;
      return counts;
    }, {});

    return {
      generatedAt: now().toISOString(),
      items: paged,
      pagination: createPagination({ ...pagination, total: filtered.length }),
      counts: {
        total: filtered.length,
        byState: countsByState,
        byCategory: countsByCategory,
        bySeverity: countsBySeverity,
        requiresExplicitResolution: filtered.filter(systemAlertRequiresExplicitResolution).length
      },
      states: Object.values(ALERT_STATE),
      categories: Object.values(ALERT_CATEGORY),
      severities: Object.values(ALERT_SEVERITY)
    };
  };

  const findOrMaterializeAlert = async (alertId) => {
    const identityQuery = buildAlertIdentityQuery(alertId);
    const existing = await queryOne(models.AlertModel.findOne(identityQuery));
    if (existing) return existing;

    const derived = (await buildDerivedAlerts({ limit: 200 })).find((alert) => alert.alertKey === alertId);
    if (!derived) throw new AppError("System alert not found.", 404, "SYSTEM_ALERT_NOT_FOUND");

    const created = await models.AlertModel.create({
      ...derived,
      alertKey: derived.alertKey,
      state: ALERT_STATE.OPEN,
      firstSeenAt: parseDate(derived.firstSeenAt) || now(),
      lastSeenAt: parseDate(derived.lastSeenAt) || now(),
      metadata: derived.metadata || {}
    });
    return typeof created.toObject === "function" ? created.toObject() : created;
  };

  const updateAlertState = async ({ alertId, state, auth, requestId = "", resolutionNote = "" }) => {
    const alert = normalizeAlert(await findOrMaterializeAlert(alertId), { persisted: true });
    const nextState = normalizeUpper(state);
    if (!Object.values(ALERT_STATE).includes(nextState)) {
      throw new AppError("Invalid alert state.", 422, "INVALID_ALERT_STATE");
    }
    if (
      nextState === ALERT_STATE.DISMISSED &&
      systemAlertRequiresExplicitResolution(alert)
    ) {
      throw new AppError(
        "Critical financial/security alerts require explicit resolution, not dismissal.",
        409,
        "ALERT_EXPLICIT_RESOLUTION_REQUIRED"
      );
    }
    if (
      nextState === ALERT_STATE.RESOLVED &&
      systemAlertRequiresExplicitResolution(alert) &&
      !normalizeToken(resolutionNote)
    ) {
      throw new AppError(
        "Resolution note is required for critical financial/security alerts.",
        422,
        "ALERT_RESOLUTION_NOTE_REQUIRED"
      );
    }

    const at = now();
    const actor = actorId(auth);
    const update = {
      state: nextState,
      updatedBy: actor,
      lastSeenAt: at
    };
    if (nextState === ALERT_STATE.ACKNOWLEDGED) {
      update.acknowledgedBy = actor;
      update.acknowledgedAt = at;
    }
    if (nextState === ALERT_STATE.RESOLVED) {
      update.resolvedBy = actor;
      update.resolvedAt = at;
      update.resolutionNote = normalizeToken(resolutionNote);
    }
    if (nextState === ALERT_STATE.DISMISSED) {
      update.dismissedBy = actor;
      update.dismissedAt = at;
    }

    const updated = await models.AlertModel.findOneAndUpdate(
      buildAlertIdentityQuery(alert.alertKey),
      { $set: update },
      { new: true }
    );
    const normalized = normalizeAlert(updated, { persisted: true });

    await models.AuditLogModel.create({
      actorId: actor,
      actorRole: auth?.role || "system",
      action: `system_alert_${nextState.toLowerCase()}`,
      entityType: "SystemAlert",
      entityId: normalized.alertKey,
      reference: normalized.reference,
      reason: resolutionNote || `Alert marked ${nextState.toLowerCase()}`,
      requestId,
      before: alert,
      after: normalized,
      metadata: {
        category: normalized.category,
        severity: normalized.severity,
        sourceType: normalized.sourceType,
        sourceId: normalized.sourceId
      }
    });

    return normalized;
  };

  const acknowledgeAlert = (args = {}) => updateAlertState({ ...args, state: ALERT_STATE.ACKNOWLEDGED });
  const resolveAlert = (args = {}) => updateAlertState({ ...args, state: ALERT_STATE.RESOLVED });
  const dismissAlert = (args = {}) => updateAlertState({ ...args, state: ALERT_STATE.DISMISSED });

  const retryFailedJob = async ({ jobId, auth, requestId = "", force = false } = {}) => {
    const allJobs = await listFailedJobs({ limit: 200, includeClosed: true });
    const job = allJobs.items.find((item) => item.id === jobId);
    if (!job) throw new AppError("Failed job not found.", 404, "FAILED_JOB_NOT_FOUND");
    if (!job.retry.canRetry || !retryHandlers[job.jobType]) {
      throw new AppError(
        "This failed job does not have a safe automated retry path in ops control.",
        409,
        "FAILED_JOB_RETRY_NOT_SUPPORTED",
        {
          jobType: job.jobType,
          reference: job.reference,
          recommendedAction: job.retry.label
        }
      );
    }

    const retryResult = await retryHandlers[job.jobType]({
      sourceId: job.sourceId,
      job,
      auth,
      requestId,
      force: Boolean(force)
    });

    await models.AuditLogModel.create({
      actorId: actorId(auth),
      actorRole: auth?.role || "system",
      action: "failed_job_retry_triggered",
      entityType: job.sourceType || "FailedJob",
      entityId: job.sourceId || job.id,
      reference: job.reference,
      reason: "Authorized admin retried a failed operational job",
      requestId,
      metadata: {
        jobId: job.id,
        jobType: job.jobType,
        force: Boolean(force),
        retryEndpoint: job.retry.endpoint || ""
      }
    });

    return {
      job,
      retriedAt: now().toISOString(),
      result: retryResult
    };
  };

  const getSummary = async (filters = {}) => {
    const [alerts, jobs] = await Promise.all([
      listSystemAlerts({ ...filters, limit: 200 }),
      listFailedJobs({ ...filters, limit: 200 })
    ]);
    return {
      generatedAt: now().toISOString(),
      alerts: alerts.counts,
      failedJobs: jobs.counts,
      openCriticalAlerts: alerts.items.filter((alert) => alert.state === ALERT_STATE.OPEN && alert.severity === ALERT_SEVERITY.CRITICAL).length,
      retryableFailedJobs: jobs.counts.retryable,
      categories: Object.values(ALERT_CATEGORY),
      failedJobTypes: Object.values(FAILED_JOB_TYPE),
      safety: {
        criticalFinancialAlertsRequireResolution: true,
        retriesUseExistingBackendHandlersOnly: true,
        derivedFromPersistedWorkflowEvidence: true
      }
    };
  };

  return {
    acknowledgeAlert,
    dismissAlert,
    getSummary,
    listFailedJobs,
    listSystemAlerts,
    resolveAlert,
    retryFailedJob
  };
};

const service = createOpsControlService();

module.exports = {
  ...service,
  createOpsControlService,
  ALERT_CATEGORY,
  ALERT_SEVERITY,
  ALERT_STATE,
  FAILED_JOB_TYPE,
  __testables: {
    alertFromDataQualityIssue,
    alertFromFailedJob,
    filterAlerts,
    filterJobs,
    normalizeAlert,
    normalizeFailedJob,
    systemAlertRequiresExplicitResolution
  }
};
