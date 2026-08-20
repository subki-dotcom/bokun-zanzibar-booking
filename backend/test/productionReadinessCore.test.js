process.env.NODE_ENV ||= "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/production-readiness-core-test";
process.env.JWT_SECRET ||= "production-readiness-core-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CHECK_STATUS,
  READINESS_STATUS,
  createProductionReadinessService,
  __testables
} = require("../src/services/productionReadiness");
const { REPORT_AVAILABILITY, REPORT_EXPORT_FORMAT } = require("../src/reportCenter/constants");

const healthyDependencies = () => ({
  systemHealth: {
    getAdminSummary: () => ({
      generatedAt: "2026-08-20T10:00:00.000Z",
      status: "healthy",
      counts: { pass: 12, warn: 0, fail: 0, total: 12 },
      workers: [{ name: "booking_sync", consecutiveFailures: 0 }],
      observability: {
        structuredLogs: true,
        requestIds: true,
        correlationIds: true,
        secretsRedacted: true
      }
    })
  },
  performanceReview: {
    getSummary: () => ({
      generatedAt: "2026-08-20T10:00:00.000Z",
      coveragePercent: 100,
      counts: { migrationRequired: 0 },
      criticalMissing: []
    })
  },
  disasterRecovery: {
    getSummary: async () => ({
      generatedAt: "2026-08-20T10:00:00.000Z",
      rpoStatus: "WITHIN_RPO",
      latestCompletedBackup: { operationReference: "BACKUP-test-20260820100000" },
      backupPolicy: { rpoHours: 24 },
      safeguards: { restoreExecutionInApi: false }
    })
  },
  dataQuality: {
    getSummary: async () => ({
      generatedAt: "2026-08-20T10:00:00.000Z",
      scan: { boundedScan: true, scanLimit: 1000 },
      summary: {
        totalRecords: 10,
        issueCount: 0,
        completenessPercent: 100,
        severityCounts: { INFO: 0, WARNING: 0, ERROR: 0, CRITICAL: 0 }
      }
    })
  },
  opsControl: {
    getSummary: async () => ({
      generatedAt: "2026-08-20T10:00:00.000Z",
      openCriticalAlerts: 0,
      failedJobs: { total: 0 },
      alerts: { total: 0 }
    })
  },
  auditControl: {
    getSummary: async () => ({
      generatedAt: "2026-08-20T10:00:00.000Z",
      immutableAudit: true,
      secretsSanitized: true,
      totalAuditEvents: 2,
      totalFinancialChanges: 1
    })
  },
  reports: {
    listReportDefinitions: () => [
      {
        type: "DAILY_MANAGEMENT_REPORT",
        availability: REPORT_AVAILABILITY.AVAILABLE,
        group: "EXECUTIVE",
        supportedExports: Object.values(REPORT_EXPORT_FORMAT),
        sourceOfTruth: { duplicatesFinancialTruth: false }
      }
    ]
  },
  clock: () => "2026-08-20T10:00:01.000Z"
});

test("production readiness passes only when existing control services are green", async () => {
  const service = createProductionReadinessService(healthyDependencies());
  const summary = await service.getSummary();

  assert.equal(summary.status, READINESS_STATUS.READY);
  assert.equal(summary.releaseGate.canRelease, true);
  assert.equal(summary.counts.fail, 0);
  assert.equal(summary.counts.warn, 0);
  assert.equal(summary.sourceEvidence.reportDefinitionsReviewed, 1);
  assert.ok(summary.invariants.some((item) => item.includes("Refund provider-confirmation rules")));
});

test("production readiness blocks duplicate financial truth and critical data-quality issues", async () => {
  const dependencies = healthyDependencies();
  dependencies.dataQuality.getSummary = async () => ({
    generatedAt: "2026-08-20T10:00:00.000Z",
    scan: { boundedScan: true, scanLimit: 1000 },
    summary: {
      totalRecords: 10,
      issueCount: 1,
      completenessPercent: 90,
      severityCounts: { INFO: 0, WARNING: 0, ERROR: 0, CRITICAL: 1 }
    }
  });
  dependencies.reports.listReportDefinitions = () => [
    {
      type: "UNSAFE_REPORT",
      availability: REPORT_AVAILABILITY.AVAILABLE,
      group: "EXECUTIVE",
      supportedExports: Object.values(REPORT_EXPORT_FORMAT),
      sourceOfTruth: { duplicatesFinancialTruth: true }
    }
  ];

  const summary = await createProductionReadinessService(dependencies).getSummary();

  assert.equal(summary.status, READINESS_STATUS.BLOCKED);
  assert.equal(summary.releaseGate.blocked, true);
  assert.ok(summary.checks.some((check) => check.id === "report_financial_truth" && check.status === CHECK_STATUS.FAIL));
  assert.ok(summary.checks.some((check) => check.id === "data_quality" && check.status === CHECK_STATUS.FAIL));
});

test("permission readiness confirms staff cannot read sensitive release controls", () => {
  const check = __testables.buildPermissionCheck();

  assert.equal(check.status, CHECK_STATUS.PASS);
  assert.equal(check.evidence.permissionDeclared, true);
  assert.equal(check.evidence.adminHasProductionReadiness, true);
  assert.deepEqual(check.evidence.staffSensitiveLeaks, []);
});

test("production readiness blocks release when an evidence source fails", async () => {
  const dependencies = healthyDependencies();
  dependencies.auditControl.getSummary = async () => {
    throw new Error("Audit store unavailable");
  };

  const summary = await createProductionReadinessService(dependencies).getSummary();

  assert.equal(summary.status, READINESS_STATUS.BLOCKED);
  assert.ok(summary.checks.some((check) => check.id === "evidence_audit_control" && check.status === CHECK_STATUS.FAIL));
  assert.ok(summary.nextActions.some((item) => item.checkId === "evidence_audit_control"));
});
