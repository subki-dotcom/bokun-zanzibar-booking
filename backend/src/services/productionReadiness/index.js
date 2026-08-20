const auditControlService = require("../auditControl");
const dataQualityService = require("../dataQuality");
const disasterRecoveryService = require("../disasterRecovery");
const opsControlService = require("../opsControl");
const performanceReviewService = require("../performanceReview");
const systemHealthService = require("../systemHealth");
const { listReportDefinitions } = require("../../reportCenter/reportRegistry");
const { REPORT_AVAILABILITY, REPORT_EXPORT_FORMAT } = require("../../reportCenter/constants");
const { PERMISSIONS, getPermissionsForRole } = require("../../security/permissions");
const { ROLES } = require("../../config/constants");

const CHECK_STATUS = Object.freeze({
  PASS: "pass",
  WARN: "warn",
  FAIL: "fail"
});

const READINESS_STATUS = Object.freeze({
  READY: "ready",
  REVIEW_REQUIRED: "review_required",
  BLOCKED: "blocked"
});

const requiredReportFormats = Object.freeze(Object.values(REPORT_EXPORT_FORMAT));

const nowIso = () => new Date().toISOString();
const asNumber = (value = 0) => Number(value || 0);
const hasValue = (value = "") => String(value || "").trim().length > 0;
const safeError = (error = {}) => ({
  code: String(error.code || error.name || "READINESS_EVIDENCE_FAILED").slice(0, 120),
  message: String(error.message || "Readiness evidence could not be collected.").slice(0, 500)
});

const makeCheck = ({
  id,
  category,
  label,
  status = CHECK_STATUS.PASS,
  message = "",
  evidence = {},
  nextAction = ""
}) => ({
  id,
  category,
  label,
  status,
  message,
  evidence,
  nextAction
});

const deriveOverallStatus = (checks = []) => {
  if (checks.some((check) => check.status === CHECK_STATUS.FAIL)) return READINESS_STATUS.BLOCKED;
  if (checks.some((check) => check.status === CHECK_STATUS.WARN)) return READINESS_STATUS.REVIEW_REQUIRED;
  return READINESS_STATUS.READY;
};

const countByStatus = (checks = []) =>
  checks.reduce((counts, check) => {
    counts[check.status] = (counts[check.status] || 0) + 1;
    counts.total += 1;
    return counts;
  }, {
    pass: 0,
    warn: 0,
    fail: 0,
    total: 0
  });

const buildSystemHealthChecks = (summary = {}) => {
  const failing = asNumber(summary.counts?.fail);
  const warnings = asNumber(summary.counts?.warn);
  const workerFailures = (summary.workers || []).filter((worker) => asNumber(worker.consecutiveFailures) >= 3);
  const workerWarnings = (summary.workers || []).filter((worker) => asNumber(worker.consecutiveFailures) > 0);

  return [
    makeCheck({
      id: "system_health",
      category: "runtime",
      label: "System health checks",
      status: failing > 0 ? CHECK_STATUS.FAIL : warnings > 0 ? CHECK_STATUS.WARN : CHECK_STATUS.PASS,
      message: failing > 0
        ? "System health has failing checks."
        : warnings > 0
          ? "System health has warnings that need review before release."
          : "System health checks are passing.",
      evidence: {
        overallStatus: summary.status || "",
        pass: asNumber(summary.counts?.pass),
        warn: warnings,
        fail: failing,
        total: asNumber(summary.counts?.total)
      },
      nextAction: failing > 0 || warnings > 0 ? "Open System Health and resolve failed or warning checks." : ""
    }),
    makeCheck({
      id: "worker_health",
      category: "operations",
      label: "Worker health",
      status: workerFailures.length ? CHECK_STATUS.FAIL : workerWarnings.length ? CHECK_STATUS.WARN : CHECK_STATUS.PASS,
      message: workerFailures.length
        ? "One or more workers have repeated failures."
        : workerWarnings.length
          ? "One or more workers have recent failures."
          : "Worker checks do not show repeated failures.",
      evidence: {
        workersReviewed: (summary.workers || []).length,
        repeatedFailureWorkers: workerFailures.map((worker) => worker.name),
        recentFailureWorkers: workerWarnings.map((worker) => worker.name)
      },
      nextAction: workerFailures.length || workerWarnings.length ? "Open Ops Control/System Health and review worker failures." : ""
    }),
    makeCheck({
      id: "observability",
      category: "monitoring",
      label: "Structured observability",
      status: summary.observability?.structuredLogs &&
        summary.observability?.requestIds &&
        summary.observability?.correlationIds &&
        summary.observability?.secretsRedacted
        ? CHECK_STATUS.PASS
        : CHECK_STATUS.WARN,
      message: "Request IDs, correlation IDs, structured logs and secret redaction are reviewed.",
      evidence: summary.observability || {},
      nextAction: "Keep production logs secret-safe and traceable by request/correlation ID."
    })
  ];
};

const buildReportChecks = ({ definitions = [] } = {}) => {
  const availableReports = definitions.filter((definition) => definition.availability === REPORT_AVAILABILITY.AVAILABLE);
  const duplicateTruthRisks = availableReports.filter((definition) => definition.sourceOfTruth?.duplicatesFinancialTruth !== false);
  const missingExports = availableReports.filter((definition) => {
    const formats = new Set(definition.supportedExports || []);
    return requiredReportFormats.some((format) => !formats.has(format));
  });
  const availableGroups = new Set(availableReports.map((definition) => definition.group).filter(Boolean));

  return [
    makeCheck({
      id: "report_center_catalog",
      category: "reports",
      label: "Report Center catalog",
      status: availableReports.length > 0 ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
      message: availableReports.length > 0
        ? "Report Center has available canonical report definitions."
        : "Report Center has no available report definitions.",
      evidence: {
        availableReports: availableReports.length,
        reportGroups: availableGroups.size
      },
      nextAction: availableReports.length > 0 ? "" : "Enable at least the core management reports before release."
    }),
    makeCheck({
      id: "report_financial_truth",
      category: "reports",
      label: "Report financial source of truth",
      status: duplicateTruthRisks.length ? CHECK_STATUS.FAIL : CHECK_STATUS.PASS,
      message: duplicateTruthRisks.length
        ? "Some reports do not explicitly declare that they avoid duplicate financial truth."
        : "Available reports declare canonical source-of-truth boundaries.",
      evidence: {
        duplicateTruthRiskCount: duplicateTruthRisks.length,
        reportTypes: duplicateTruthRisks.map((definition) => definition.type)
      },
      nextAction: duplicateTruthRisks.length ? "Fix report definitions to consume canonical accounting/analytics services only." : ""
    }),
    makeCheck({
      id: "report_exports",
      category: "reports",
      label: "Report export formats",
      status: missingExports.length ? CHECK_STATUS.WARN : CHECK_STATUS.PASS,
      message: missingExports.length
        ? "Some available reports do not expose every required export format."
        : "Available reports expose CSV, Excel, PDF and Print export contracts.",
      evidence: {
        requiredFormats: requiredReportFormats,
        missingExportReportCount: missingExports.length,
        reportTypes: missingExports.map((definition) => definition.type)
      },
      nextAction: missingExports.length ? "Add missing export contracts or mark unsupported reports as planned." : ""
    })
  ];
};

const buildAuditCheck = (summary = {}) =>
  makeCheck({
    id: "audit_immutability",
    category: "audit",
    label: "Audit and financial change evidence",
    status: summary.immutableAudit && summary.secretsSanitized ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
    message: summary.immutableAudit && summary.secretsSanitized
      ? "Audit logs are exposed as immutable and sanitized financial-change evidence."
      : "Audit controls are missing immutability or secret-sanitization guarantees.",
    evidence: {
      immutableAudit: Boolean(summary.immutableAudit),
      secretsSanitized: Boolean(summary.secretsSanitized),
      totalAuditEvents: asNumber(summary.totalAuditEvents),
      totalFinancialChanges: asNumber(summary.totalFinancialChanges),
      latestFinancialChangeAt: summary.latestFinancialChangeAt || ""
    },
    nextAction: summary.immutableAudit && summary.secretsSanitized
      ? ""
      : "Harden AuditLog immutability and sensitive payload sanitization before release."
  });

const buildDataQualityCheck = (summary = {}) => {
  const critical = asNumber(summary.summary?.severityCounts?.CRITICAL);
  const errors = asNumber(summary.summary?.severityCounts?.ERROR);
  const completeness = asNumber(summary.summary?.completenessPercent);
  const status = critical > 0 ? CHECK_STATUS.FAIL : errors > 0 || completeness < 95 ? CHECK_STATUS.WARN : CHECK_STATUS.PASS;

  return makeCheck({
    id: "data_quality",
    category: "data_quality",
    label: "Data quality scan",
    status,
    message: critical > 0
      ? "Critical data-quality issues block production readiness."
      : errors > 0
        ? "Data-quality errors need review before relying on reports."
        : "Data-quality scan is within the release threshold.",
    evidence: {
      totalRecords: asNumber(summary.summary?.totalRecords),
      issueCount: asNumber(summary.summary?.issueCount),
      completenessPercent: completeness,
      severityCounts: summary.summary?.severityCounts || {},
      boundedScan: Boolean(summary.scan?.boundedScan),
      scanLimit: asNumber(summary.scan?.scanLimit)
    },
    nextAction: status === CHECK_STATUS.PASS ? "" : "Open Data Quality and fix critical/error issues or document accepted limitations."
  });
};

const buildOpsCheck = (summary = {}) => {
  const critical = asNumber(summary.openCriticalAlerts);
  const failedJobs = asNumber(summary.failedJobs?.total);
  return makeCheck({
    id: "ops_control",
    category: "operations",
    label: "System alerts and failed jobs",
    status: critical > 0 ? CHECK_STATUS.FAIL : failedJobs > 0 ? CHECK_STATUS.WARN : CHECK_STATUS.PASS,
    message: critical > 0
      ? "Open critical alerts must be resolved before release."
      : failedJobs > 0
        ? "Failed jobs need review before release."
        : "No blocking ops-control evidence found.",
    evidence: {
      openCriticalAlerts: critical,
      failedJobs: summary.failedJobs || {},
      alerts: summary.alerts || {}
    },
    nextAction: critical > 0 || failedJobs > 0 ? "Open Ops Control and resolve/acknowledge failed operational evidence." : ""
  });
};

const buildDisasterRecoveryCheck = (summary = {}) =>
  makeCheck({
    id: "backup_restore",
    category: "disaster_recovery",
    label: "Backup and restore readiness",
    status: summary.rpoStatus === "WITHIN_RPO" ? CHECK_STATUS.PASS : CHECK_STATUS.WARN,
    message: summary.rpoStatus === "WITHIN_RPO"
      ? "A completed backup is within the configured RPO."
      : "No completed backup within RPO is recorded by the disaster recovery control plane.",
    evidence: {
      rpoStatus: summary.rpoStatus || "",
      latestCompletedBackup: summary.latestCompletedBackup?.operationReference || "",
      backupPolicy: summary.backupPolicy || {},
      restoreExecutionInApi: summary.safeguards?.restoreExecutionInApi
    },
    nextAction: summary.rpoStatus === "WITHIN_RPO"
      ? ""
      : "Run a backup dry-run/apply and verify restore procedure on staging before release."
  });

const buildPerformanceCheck = (summary = {}) => {
  const criticalMissing = (summary.criticalMissing || []).length;
  const migrationRequired = asNumber(summary.counts?.migrationRequired);
  return makeCheck({
    id: "performance_index_review",
    category: "performance",
    label: "Index and query-pattern coverage",
    status: criticalMissing > 0 ? CHECK_STATUS.FAIL : migrationRequired > 0 ? CHECK_STATUS.WARN : CHECK_STATUS.PASS,
    message: criticalMissing > 0
      ? "Critical query patterns are missing declared index coverage."
      : migrationRequired > 0
        ? "Some query patterns need reviewed index migrations."
        : "Reviewed query patterns are covered.",
    evidence: {
      coveragePercent: asNumber(summary.coveragePercent),
      migrationRequired,
      criticalMissing
    },
    nextAction: criticalMissing > 0 || migrationRequired > 0
      ? "Open Performance Review and plan safe index migrations with dry-run explain evidence."
      : ""
  });
};

const buildPermissionCheck = () => {
  const superAdminPermissions = getPermissionsForRole(ROLES.SUPER_ADMIN);
  const adminPermissions = getPermissionsForRole(ROLES.ADMIN);
  const staffPermissions = getPermissionsForRole(ROLES.STAFF);
  const sensitivePermissions = [
    PERMISSIONS.BUSINESS_ACCOUNTING_READ,
    PERMISSIONS.BUSINESS_INTELLIGENCE_READ,
    PERMISSIONS.REPORT_CENTER_EXPORT,
    PERMISSIONS.DISASTER_RECOVERY_WRITE,
    PERMISSIONS.USER_MANAGEMENT_WRITE,
    PERMISSIONS.SYSTEM_SETTINGS_WRITE,
    PERMISSIONS.PRODUCTION_READINESS_READ
  ].filter(Boolean);
  const missingForAdmin = [
    PERMISSIONS.PRODUCTION_READINESS_READ,
    PERMISSIONS.SYSTEM_HEALTH_READ,
    PERMISSIONS.PERFORMANCE_REVIEW_READ,
    PERMISSIONS.DISASTER_RECOVERY_READ
  ].filter((permission) => !adminPermissions.includes(permission));
  const staffSensitiveLeaks = sensitivePermissions.filter((permission) => staffPermissions.includes(permission));
  const permissionDeclared = Object.values(PERMISSIONS).includes(PERMISSIONS.PRODUCTION_READINESS_READ);

  return makeCheck({
    id: "rbac_sensitive_controls",
    category: "security",
    label: "RBAC and sensitive controls",
    status: !permissionDeclared || missingForAdmin.length || staffSensitiveLeaks.length ? CHECK_STATUS.FAIL : CHECK_STATUS.PASS,
    message: permissionDeclared && !missingForAdmin.length && !staffSensitiveLeaks.length
      ? "Production readiness and sensitive financial controls are protected by backend permissions."
      : "Production readiness permissions need review.",
    evidence: {
      permissionDeclared,
      superAdminHasProductionReadiness: superAdminPermissions.includes(PERMISSIONS.PRODUCTION_READINESS_READ),
      adminHasProductionReadiness: adminPermissions.includes(PERMISSIONS.PRODUCTION_READINESS_READ),
      missingForAdmin,
      staffSensitiveLeaks
    },
    nextAction: permissionDeclared && !missingForAdmin.length && !staffSensitiveLeaks.length
      ? ""
      : "Update backend permissions so only authorized admin roles can read release readiness."
  });
};

const collectEvidence = async ({ id, task, fallback }) => {
  try {
    return {
      id,
      data: await task(),
      error: null
    };
  } catch (error) {
    return {
      id,
      data: fallback,
      error: safeError(error)
    };
  }
};

const buildEvidenceFailureChecks = (results = []) =>
  results
    .filter((result) => result.error)
    .map((result) => makeCheck({
      id: `evidence_${result.id}`,
      category: "readiness",
      label: `${result.id.replaceAll("_", " ")} evidence`,
      status: CHECK_STATUS.FAIL,
      message: "Production readiness could not collect one of its required evidence sources.",
      evidence: result.error,
      nextAction: "Open the related admin module and fix the evidence source before release."
    }));

const createProductionReadinessService = ({
  systemHealth = systemHealthService,
  performanceReview = performanceReviewService,
  disasterRecovery = disasterRecoveryService,
  dataQuality = dataQualityService,
  opsControl = opsControlService,
  auditControl = auditControlService,
  reports = { listReportDefinitions },
  clock = nowIso
} = {}) => {
  const getSummary = async () => {
    const evidence = await Promise.all([
      collectEvidence({
        id: "system_health",
        task: () => Promise.resolve(systemHealth.getAdminSummary()),
        fallback: { counts: { pass: 0, warn: 0, fail: 1, total: 1 }, workers: [], observability: {} }
      }),
      collectEvidence({
        id: "performance_review",
        task: () => Promise.resolve(performanceReview.getSummary()),
        fallback: { coveragePercent: 0, counts: { migrationRequired: 1 }, criticalMissing: [{}] }
      }),
      collectEvidence({
        id: "disaster_recovery",
        task: () => disasterRecovery.getSummary(),
        fallback: { rpoStatus: "UNKNOWN", backupPolicy: {}, safeguards: {} }
      }),
      collectEvidence({
        id: "data_quality",
        task: () => dataQuality.getSummary({ limit: 1000 }),
        fallback: {
          scan: { boundedScan: false, scanLimit: 0 },
          summary: {
            totalRecords: 0,
            issueCount: 1,
            completenessPercent: 0,
            severityCounts: { INFO: 0, WARNING: 0, ERROR: 0, CRITICAL: 1 }
          }
        }
      }),
      collectEvidence({
        id: "ops_control",
        task: () => opsControl.getSummary({ limit: 200 }),
        fallback: { openCriticalAlerts: 1, failedJobs: { total: 1 }, alerts: { total: 1 } }
      }),
      collectEvidence({
        id: "audit_control",
        task: () => auditControl.getSummary(),
        fallback: { immutableAudit: false, secretsSanitized: false }
      }),
      collectEvidence({
        id: "report_center",
        task: () => Promise.resolve(reports.listReportDefinitions()),
        fallback: []
      })
    ]);

    const [
      systemResult,
      performanceResult,
      disasterResult,
      dataQualityResult,
      opsResult,
      auditResult,
      reportResult
    ] = evidence;
    const systemSummary = systemResult.data;
    const performanceSummary = performanceResult.data;
    const disasterSummary = disasterResult.data;
    const dataQualitySummary = dataQualityResult.data;
    const opsSummary = opsResult.data;
    const auditSummary = auditResult.data;
    const definitions = Array.isArray(reportResult.data) ? reportResult.data : [];
    const checks = [
      ...buildEvidenceFailureChecks(evidence),
      ...buildSystemHealthChecks(systemSummary),
      ...buildReportChecks({ definitions }),
      buildAuditCheck(auditSummary),
      buildDataQualityCheck(dataQualitySummary),
      buildOpsCheck(opsSummary),
      buildDisasterRecoveryCheck(disasterSummary),
      buildPerformanceCheck(performanceSummary),
      buildPermissionCheck()
    ];
    const counts = countByStatus(checks);
    const status = deriveOverallStatus(checks);

    return {
      generatedAt: clock(),
      status,
      releaseGate: {
        canRelease: status === READINESS_STATUS.READY,
        requiresReview: status === READINESS_STATUS.REVIEW_REQUIRED,
        blocked: status === READINESS_STATUS.BLOCKED,
        rule: "Production release is blocked by any fail; warn requires documented review."
      },
      counts,
      categories: checks.reduce((result, check) => {
        if (!result[check.category]) result[check.category] = { pass: 0, warn: 0, fail: 0, total: 0 };
        result[check.category][check.status] += 1;
        result[check.category].total += 1;
        return result;
      }, {}),
      checks,
      sourceEvidence: {
        systemHealthGeneratedAt: systemSummary.generatedAt || "",
        dataQualityGeneratedAt: dataQualitySummary.generatedAt || "",
        opsControlGeneratedAt: opsSummary.generatedAt || "",
        disasterRecoveryGeneratedAt: disasterSummary.generatedAt || "",
        performanceGeneratedAt: performanceSummary.generatedAt || "",
        auditGeneratedAt: auditSummary.generatedAt || "",
        reportDefinitionsReviewed: definitions.length
      },
      invariants: [
        "This readiness view is read-only and does not mutate bookings, payments, refunds, invoices, reports or audit records.",
        "Financial totals remain owned by canonical accounting/reporting services.",
        "Operational Bokun dates and financial transaction dates remain separate.",
        "Refund provider-confirmation rules are not changed by readiness verification."
      ],
      nextActions: checks
        .filter((check) => check.status !== CHECK_STATUS.PASS && hasValue(check.nextAction))
        .map((check) => ({
          checkId: check.id,
          label: check.label,
          status: check.status,
          nextAction: check.nextAction
        }))
    };
  };

  return {
    getSummary
  };
};

const service = createProductionReadinessService();

module.exports = {
  ...service,
  CHECK_STATUS,
  READINESS_STATUS,
  createProductionReadinessService,
  __testables: {
    buildAuditCheck,
    buildDataQualityCheck,
    buildDisasterRecoveryCheck,
    buildOpsCheck,
    buildPerformanceCheck,
    buildPermissionCheck,
    buildReportChecks,
    buildSystemHealthChecks,
    countByStatus,
    deriveOverallStatus
  }
};
