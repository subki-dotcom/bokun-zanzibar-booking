process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/ops-control-core-test";
process.env.JWT_SECRET ||= "ops-control-core-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const AppError = require("../src/utils/AppError");
const {
  ALERT_CATEGORY,
  ALERT_SEVERITY,
  ALERT_STATE,
  FAILED_JOB_TYPE,
  createOpsControlService,
  __testables
} = require("../src/services/opsControl");

const date = (value) => new Date(value);

const matchesIdentity = (row, query = {}) => {
  if (query.alertKey) return row.alertKey === query.alertKey;
  if (query._id) return String(row._id) === String(query._id);
  if (Array.isArray(query.$or)) return query.$or.some((clause) => matchesIdentity(row, clause));
  return true;
};

const arrayModel = (rows = []) => ({
  rows,
  find: () => rows,
  findOne: (query) => ({
    lean: async () => rows.find((row) => matchesIdentity(row, query)) || null
  }),
  findOneAndUpdate: async (query, update) => {
    const row = rows.find((item) => matchesIdentity(item, query));
    if (!row) return null;
    Object.assign(row, update.$set || {});
    return row;
  },
  create: async (payload) => {
    const row = {
      _id: payload._id || `created-${rows.length + 1}`,
      ...payload
    };
    rows.push(row);
    return row;
  },
  countDocuments: async () => rows.length
});

const emptyModel = () => arrayModel([]);

const modelsFor = (overrides = {}) => ({
  AlertModel: emptyModel(),
  AuditLogModel: emptyModel(),
  BookingModel: emptyModel(),
  BookingRequestModel: emptyModel(),
  EmailDeliveryModel: emptyModel(),
  PaymentModel: emptyModel(),
  RefundModel: emptyModel(),
  ReportExportModel: emptyModel(),
  SyncLogModel: emptyModel(),
  ...overrides
});

test("failed jobs normalize existing booking finalization failures and retry through the safe handler", async () => {
  const bookingRows = [
    {
      _id: "booking-1",
      bookingReference: "ZNZ-OPS-1",
      paymentStatus: "paid",
      invoiceSnapshot: { paymentStatus: "paid" },
      pendingCheckout: {
        finalization: {
          status: "failed",
          attemptCount: 3,
          nextRetryAt: date("2026-08-20T11:00:00.000Z"),
          lastAttemptAt: date("2026-08-20T10:00:00.000Z"),
          lastError: {
            code: "BOKUN_REQUEST_FAILED",
            message: "Bokun rejected the booking payload"
          }
        }
      },
      updatedAt: date("2026-08-20T10:00:00.000Z")
    }
  ];
  const auditRows = [];
  let retriedWith = null;
  const service = createOpsControlService({
    models: modelsFor({
      AuditLogModel: arrayModel(auditRows),
      BookingModel: arrayModel(bookingRows)
    }),
    retryHandlers: {
      [FAILED_JOB_TYPE.BOOKING_FINALIZATION]: async (args) => {
        retriedWith = args;
        return { status: "confirmed" };
      }
    },
    dataQuality: { listIssues: async () => ({ items: [] }) },
    now: () => date("2026-08-20T12:00:00.000Z")
  });

  const jobs = await service.listFailedJobs({ limit: 10 });
  assert.equal(jobs.items.length, 1);
  assert.equal(jobs.items[0].jobType, FAILED_JOB_TYPE.BOOKING_FINALIZATION);
  assert.equal(jobs.items[0].reference, "ZNZ-OPS-1");
  assert.equal(jobs.items[0].attempts, 3);
  assert.equal(jobs.items[0].retry.canRetry, true);

  const retry = await service.retryFailedJob({
    jobId: jobs.items[0].id,
    auth: { id: "admin-1", role: "admin" },
    requestId: "ops-test-1"
  });

  assert.equal(retry.result.status, "confirmed");
  assert.equal(retriedWith.sourceId, "booking-1");
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].action, "failed_job_retry_triggered");
});

test("refund verification failures are visible without automatic financial mutation", async () => {
  const refundRows = [
    {
      _id: "refund-1",
      refundReference: "REF-OPS-1",
      provider: "pesapal",
      status: "verification_required",
      failureReason: "Pesapal final refund completion is not verified yet.",
      providerRefundRequestReference: "CONF-123",
      lastRefundSyncAt: date("2026-08-20T09:00:00.000Z"),
      updatedAt: date("2026-08-20T09:00:00.000Z")
    }
  ];
  let verifyCalled = false;
  const service = createOpsControlService({
    models: modelsFor({ RefundModel: arrayModel(refundRows) }),
    retryHandlers: {
      [FAILED_JOB_TYPE.REFUND_VERIFICATION]: async () => {
        verifyCalled = true;
        return { refundSummary: { status: "awaiting_merchant_approval" } };
      }
    },
    dataQuality: { listIssues: async () => ({ items: [] }) }
  });

  const jobs = await service.listFailedJobs({ category: ALERT_CATEGORY.REFUNDS });
  assert.equal(jobs.items.length, 1);
  assert.equal(jobs.items[0].jobType, FAILED_JOB_TYPE.REFUND_VERIFICATION);
  assert.equal(jobs.items[0].retry.canRetry, true);
  assert.equal(jobs.items[0].metadata.provider, "pesapal");

  await service.retryFailedJob({
    jobId: jobs.items[0].id,
    auth: { id: "admin-1", role: "admin" },
    requestId: "ops-refund-verify"
  });
  assert.equal(verifyCalled, true);
  assert.equal(refundRows[0].status, "verification_required");
});

test("critical financial and security alerts require explicit resolution", async () => {
  const alertRows = [
    {
      _id: "alert-1",
      alertKey: "ALERT::PAYMENT::CRITICAL",
      category: ALERT_CATEGORY.PAYMENTS,
      severity: ALERT_SEVERITY.CRITICAL,
      state: ALERT_STATE.OPEN,
      title: "Payment mismatch",
      message: "Payment amount mismatch needs review.",
      sourceType: "Payment",
      sourceId: "payment-1",
      reference: "ZNZ-PAY-1",
      firstSeenAt: date("2026-08-20T08:00:00.000Z"),
      lastSeenAt: date("2026-08-20T08:00:00.000Z")
    }
  ];
  const auditRows = [];
  const service = createOpsControlService({
    models: modelsFor({
      AlertModel: arrayModel(alertRows),
      AuditLogModel: arrayModel(auditRows)
    }),
    dataQuality: { listIssues: async () => ({ items: [] }) },
    now: () => date("2026-08-20T12:00:00.000Z")
  });

  await assert.rejects(
    () => service.dismissAlert({ alertId: "ALERT::PAYMENT::CRITICAL", auth: { id: "admin-1", role: "admin" } }),
    (error) => error instanceof AppError && error.code === "ALERT_EXPLICIT_RESOLUTION_REQUIRED"
  );
  await assert.rejects(
    () => service.resolveAlert({ alertId: "ALERT::PAYMENT::CRITICAL", auth: { id: "admin-1", role: "admin" } }),
    (error) => error instanceof AppError && error.code === "ALERT_RESOLUTION_NOTE_REQUIRED"
  );

  const resolved = await service.resolveAlert({
    alertId: "ALERT::PAYMENT::CRITICAL",
    auth: { id: "admin-1", role: "admin" },
    requestId: "ops-alert-1",
    resolutionNote: "Payment reviewed against provider settlement and corrected."
  });

  assert.equal(resolved.state, ALERT_STATE.RESOLVED);
  assert.equal(resolved.resolutionNote, "Payment reviewed against provider settlement and corrected.");
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].action, "system_alert_resolved");
});

test("persisted alert state overrides derived data-quality alerts", async () => {
  const issue = {
    code: "MISSING_BOKUN_DATE",
    severity: ALERT_SEVERITY.ERROR,
    entityType: "Booking",
    entityId: "booking-1",
    reference: "ZNZ-DQ-1",
    message: "Bokun date missing.",
    evidence: {},
    recommendedAction: "Resync from Bokun."
  };
  const derived = __testables.alertFromDataQualityIssue(issue);
  const alertRows = [
    {
      _id: "alert-dq-1",
      alertKey: derived.alertKey,
      category: ALERT_CATEGORY.DATA_QUALITY,
      severity: ALERT_SEVERITY.ERROR,
      state: ALERT_STATE.ACKNOWLEDGED,
      title: derived.title,
      message: derived.message,
      reference: "ZNZ-DQ-1",
      firstSeenAt: date("2026-08-20T08:00:00.000Z"),
      lastSeenAt: date("2026-08-20T09:00:00.000Z")
    }
  ];
  const service = createOpsControlService({
    models: modelsFor({ AlertModel: arrayModel(alertRows) }),
    dataQuality: { listIssues: async () => ({ items: [issue] }) }
  });

  const alerts = await service.listSystemAlerts({ includeClosed: "true" });
  const item = alerts.items.find((alert) => alert.alertKey === derived.alertKey);
  assert.equal(item.state, ALERT_STATE.ACKNOWLEDGED);
  assert.equal(item.persisted, true);
});

test("unsupported failed jobs return an explicit safe-retry error", async () => {
  const exportRows = [
    {
      _id: "export-1",
      reportType: "sales",
      format: "CSV",
      status: "failed",
      generatedAt: date("2026-08-20T08:30:00.000Z"),
      error: { code: "EXPORT_FAILED", message: "Template render failed" }
    }
  ];
  const service = createOpsControlService({
    models: modelsFor({ ReportExportModel: arrayModel(exportRows) }),
    retryHandlers: {},
    dataQuality: { listIssues: async () => ({ items: [] }) }
  });

  const jobs = await service.listFailedJobs({ jobType: FAILED_JOB_TYPE.REPORT_EXPORT });
  assert.equal(jobs.items.length, 1);
  assert.equal(jobs.items[0].retry.canRetry, false);
  await assert.rejects(
    () => service.retryFailedJob({ jobId: jobs.items[0].id, auth: { id: "admin-1", role: "admin" } }),
    (error) => error instanceof AppError && error.code === "FAILED_JOB_RETRY_NOT_SUPPORTED"
  );
});
