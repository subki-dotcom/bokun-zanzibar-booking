const mongoose = require("mongoose");
const packageJson = require("../../../package.json");
const {
  env,
  isBokunConfigured,
  isDpoConfigured,
  isEmailConfigured,
  isPesapalConfigured,
  isPaypalConfigured
} = require("../../config/env");
const { getBookingFinalizationWorkerStatus } = require("../../jobs/bookingFinalization.job");
const { getBookingSyncWorkerStatus } = require("../../jobs/bookingSync.job");
const { getBokunConfirmedBookingImportWorkerStatus } = require("../../jobs/bokunConfirmedBookingImport.job");
const { getRefundReconciliationWorkerStatus } = require("../../jobs/refundReconciliation.job");

const HEALTH_STATUS = Object.freeze({
  HEALTHY: "healthy",
  DEGRADED: "degraded",
  UNHEALTHY: "unhealthy"
});

const CHECK_STATUS = Object.freeze({
  PASS: "pass",
  WARN: "warn",
  FAIL: "fail"
});

const dbStateName = (readyState) =>
  ({
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting"
  })[Number(readyState)] || "unknown";

const nowIso = () => new Date().toISOString();
const bool = (value) => value === true || String(value || "").toLowerCase() === "true";
const hasValue = (value = "") => String(value || "").trim().length > 0;
const toSeconds = (value = 0) => Number(Number(value || 0).toFixed(2));

const check = ({
  id,
  category,
  label,
  status = CHECK_STATUS.PASS,
  message = "",
  severity = status === CHECK_STATUS.FAIL ? "critical" : status === CHECK_STATUS.WARN ? "warning" : "info",
  public: isPublic = false,
  details = {}
}) => ({
  id,
  category,
  label,
  status,
  severity,
  message,
  public: Boolean(isPublic),
  details
});

const overallStatus = (checks = []) => {
  if (checks.some((item) => item.status === CHECK_STATUS.FAIL)) return HEALTH_STATUS.UNHEALTHY;
  if (checks.some((item) => item.status === CHECK_STATUS.WARN)) return HEALTH_STATUS.DEGRADED;
  return HEALTH_STATUS.HEALTHY;
};

const runtimeSummary = ({ envConfig = env, packageInfo = packageJson } = {}) => ({
  service: packageInfo.name || "zanzibar-booking-backend",
  version: packageInfo.version || "",
  environment: envConfig.NODE_ENV || "development",
  uptimeSeconds: toSeconds(process.uptime()),
  generatedAt: nowIso()
});

const databaseCheck = ({ connection = mongoose.connection } = {}) => {
  const state = Number(connection?.readyState ?? 0);
  const connected = state === 1;
  return check({
    id: "database_connection",
    category: "database",
    label: "MongoDB connection",
    status: connected ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
    message: connected ? "MongoDB connection is ready." : "MongoDB connection is not ready.",
    public: true,
    details: {
      readyState: state,
      state: dbStateName(state),
      host: connection?.host || "",
      name: connection?.name || ""
    }
  });
};

const runtimeChecks = ({ envConfig = env } = {}) => {
  const production = envConfig.NODE_ENV === "production";
  const jwtSecret = String(envConfig.JWT_SECRET || "");
  const weakJwt =
    !jwtSecret ||
    /change|secret|test|dev|local/i.test(jwtSecret) ||
    (production && jwtSecret.length < 32);

  return [
    check({
      id: "node_environment",
      category: "runtime",
      label: "Node environment",
      status: hasValue(envConfig.NODE_ENV) ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
      message: hasValue(envConfig.NODE_ENV) ? `Running in ${envConfig.NODE_ENV}.` : "NODE_ENV is missing.",
      public: true,
      details: { environment: envConfig.NODE_ENV || "" }
    }),
    check({
      id: "jwt_secret",
      category: "security",
      label: "JWT secret",
      status: weakJwt ? (production ? CHECK_STATUS.FAIL : CHECK_STATUS.WARN) : CHECK_STATUS.PASS,
      message: weakJwt
        ? "JWT secret should be rotated to a strong production-only value."
        : "JWT secret is configured.",
      details: { configured: hasValue(jwtSecret), production }
    }),
    check({
      id: "frontend_origin",
      category: "security",
      label: "Allowed frontend origin",
      status: hasValue(envConfig.FRONTEND_URL) ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
      message: hasValue(envConfig.FRONTEND_URL)
        ? "Frontend origin allow-list is configured."
        : "FRONTEND_URL is missing.",
      details: {
        originsConfigured: String(envConfig.FRONTEND_URL || "").split(",").filter(Boolean).length
      }
    }),
    check({
      id: "rate_limit",
      category: "security",
      label: "API rate limit",
      status: Number(envConfig.RATE_LIMIT_MAX || 0) > 0 ? CHECK_STATUS.PASS : CHECK_STATUS.WARN,
      message: Number(envConfig.RATE_LIMIT_MAX || 0) > 0
        ? "Global API rate limiting is configured."
        : "Global API rate limit appears disabled.",
      details: {
        windowMs: Number(envConfig.RATE_LIMIT_WINDOW_MS || 0),
        max: Number(envConfig.RATE_LIMIT_MAX || 0)
      }
    })
  ];
};

const integrationCheck = ({ id, label, configured, mockMode, production, requiredInProduction = false }) => {
  if (mockMode) {
    return check({
      id,
      category: "integration",
      label,
      status: production ? CHECK_STATUS.WARN : CHECK_STATUS.PASS,
      message: production ? `${label} is in mock mode in production.` : `${label} is running in mock mode.`,
      details: { configured: Boolean(configured), mockMode: true }
    });
  }

  if (configured) {
    return check({
      id,
      category: "integration",
      label,
      status: CHECK_STATUS.PASS,
      message: `${label} credentials are configured.`,
      details: { configured: true, mockMode: false }
    });
  }

  return check({
    id,
    category: "integration",
    label,
    status: production && requiredInProduction ? CHECK_STATUS.FAIL : CHECK_STATUS.WARN,
    message: `${label} credentials are not configured.`,
    details: { configured: false, mockMode: false, requiredInProduction }
  });
};

const integrationChecks = ({ envConfig = env, flags = {} } = {}) => {
  const production = envConfig.NODE_ENV === "production";
  const resolved = {
    bokun: flags.isBokunConfigured ?? isBokunConfigured,
    pesapal: flags.isPesapalConfigured ?? isPesapalConfigured,
    dpo: flags.isDpoConfigured ?? isDpoConfigured,
    paypal: flags.isPaypalConfigured ?? isPaypalConfigured,
    email: flags.isEmailConfigured ?? isEmailConfigured
  };
  const paymentProviderReady =
    resolved.pesapal ||
    resolved.dpo ||
    resolved.paypal ||
    bool(envConfig.PESAPAL_MOCK_MODE) ||
    bool(envConfig.DPO_MOCK_MODE) ||
    bool(envConfig.PAYPAL_MOCK_MODE);

  return [
    integrationCheck({
      id: "bokun_configuration",
      label: "Bokun API",
      configured: resolved.bokun,
      mockMode: bool(envConfig.BOKUN_MOCK_MODE),
      production,
      requiredInProduction: true
    }),
    check({
      id: "payment_provider_available",
      category: "integration",
      label: "Payment provider availability",
      status: paymentProviderReady ? CHECK_STATUS.PASS : production ? CHECK_STATUS.FAIL : CHECK_STATUS.WARN,
      message: paymentProviderReady
        ? "At least one payment provider is configured or in mock mode."
        : "No payment provider is configured.",
      details: {
        pesapalConfigured: Boolean(resolved.pesapal),
        dpoConfigured: Boolean(resolved.dpo),
        paypalConfigured: Boolean(resolved.paypal)
      }
    }),
    integrationCheck({
      id: "pesapal_configuration",
      label: "Pesapal",
      configured: resolved.pesapal,
      mockMode: bool(envConfig.PESAPAL_MOCK_MODE),
      production,
      requiredInProduction: false
    }),
    integrationCheck({
      id: "dpo_configuration",
      label: "DPO",
      configured: resolved.dpo,
      mockMode: bool(envConfig.DPO_MOCK_MODE),
      production,
      requiredInProduction: false
    }),
    integrationCheck({
      id: "paypal_configuration",
      label: "PayPal",
      configured: resolved.paypal,
      mockMode: bool(envConfig.PAYPAL_MOCK_MODE),
      production,
      requiredInProduction: false
    }),
    check({
      id: "email_configuration",
      category: "integration",
      label: "Transactional email",
      status: resolved.email ? CHECK_STATUS.PASS : CHECK_STATUS.WARN,
      message: resolved.email ? "Transactional email is enabled and configured." : "Transactional email is disabled or incomplete.",
      details: {
        enabled: bool(envConfig.EMAIL_ENABLED),
        provider: envConfig.EMAIL_PROVIDER || ""
      }
    })
  ];
};

const backupChecks = ({ envConfig = env } = {}) => {
  const production = envConfig.NODE_ENV === "production";
  return [
    check({
      id: "backup_directory",
      category: "backup",
      label: "Backup directory",
      status: hasValue(envConfig.DR_BACKUP_DIRECTORY) ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
      message: hasValue(envConfig.DR_BACKUP_DIRECTORY)
        ? "Backup directory is configured."
        : "Backup directory is missing.",
      details: { storageProvider: envConfig.DR_BACKUP_STORAGE_PROVIDER || "" }
    }),
    check({
      id: "backup_storage_provider",
      category: "backup",
      label: "Backup storage provider",
      status: production && envConfig.DR_BACKUP_STORAGE_PROVIDER === "local_filesystem"
        ? CHECK_STATUS.WARN
        : CHECK_STATUS.PASS,
      message: production && envConfig.DR_BACKUP_STORAGE_PROVIDER === "local_filesystem"
        ? "Local filesystem backups should be copied to encrypted off-host storage."
        : "Backup storage provider policy is configured.",
      details: {
        provider: envConfig.DR_BACKUP_STORAGE_PROVIDER || "",
        retentionDays: Number(envConfig.DR_BACKUP_RETENTION_DAYS || 0),
        rpoHours: Number(envConfig.DR_BACKUP_RPO_HOURS || 0),
        rtoHours: Number(envConfig.DR_BACKUP_RTO_HOURS || 0)
      }
    }),
    check({
      id: "production_restore_guard",
      category: "backup",
      label: "Production restore guard",
      status: bool(envConfig.DR_ALLOW_PRODUCTION_RESTORE) ? CHECK_STATUS.WARN : CHECK_STATUS.PASS,
      message: bool(envConfig.DR_ALLOW_PRODUCTION_RESTORE)
        ? "Production restore override is enabled. Keep this temporary and audited."
        : "Production restore override is disabled.",
      details: { allowProductionRestore: bool(envConfig.DR_ALLOW_PRODUCTION_RESTORE) }
    })
  ];
};

const normalizeWorkerStatus = (worker = {}) => {
  const status = worker.status || (!worker.enabled ? "disabled" : worker.active ? "running" : "stopped");
  return {
    name: worker.name || "",
    status,
    enabled: Boolean(worker.enabled),
    active: Boolean(worker.active),
    running: Boolean(worker.running),
    intervalSeconds: Number(worker.intervalSeconds || 0),
    batchSize: Number(worker.batchSize || 0),
    maxPages: worker.maxPages === undefined ? undefined : Number(worker.maxPages || 0),
    lastRunAt: worker.lastRunAt || "",
    lastSuccessAt: worker.lastSuccessAt || "",
    lastFailureAt: worker.lastFailureAt || "",
    nextAllowedRunAt: worker.nextAllowedRunAt || "",
    consecutiveFailures: Number(worker.consecutiveFailures || 0),
    lastError: worker.lastError || "",
    lastSummary: worker.lastSummary || null
  };
};

const workerStatusToCheck = (worker = {}) => {
  const normalized = normalizeWorkerStatus(worker);
  let status = CHECK_STATUS.PASS;
  let message = `${normalized.name} worker is ${normalized.status}.`;

  if (normalized.enabled && !normalized.active) {
    status = CHECK_STATUS.WARN;
    message = `${normalized.name} is enabled but not active in this process.`;
  }
  if (normalized.consecutiveFailures >= 3) {
    status = CHECK_STATUS.FAIL;
    message = `${normalized.name} has ${normalized.consecutiveFailures} consecutive failures.`;
  } else if (normalized.consecutiveFailures > 0) {
    status = CHECK_STATUS.WARN;
    message = `${normalized.name} has recent failures.`;
  }

  return check({
    id: `worker_${normalized.name}`,
    category: "worker",
    label: normalized.name.replaceAll("_", " "),
    status,
    message,
    details: normalized
  });
};

const defaultWorkers = () => [
  getBookingSyncWorkerStatus(),
  getBokunConfirmedBookingImportWorkerStatus(),
  getBookingFinalizationWorkerStatus(),
  getRefundReconciliationWorkerStatus()
];

const createSystemHealthService = ({
  envConfig = env,
  connection = mongoose.connection,
  packageInfo = packageJson,
  flags = {},
  workers = defaultWorkers
} = {}) => {
  const getLiveHealth = () => {
    const runtime = runtimeSummary({ envConfig, packageInfo });
    return {
      ...runtime,
      status: HEALTH_STATUS.HEALTHY
    };
  };

  const buildChecks = ({ includeWorkers = true } = {}) => {
    const workerRows = includeWorkers ? workers().map(normalizeWorkerStatus) : [];
    const workerChecks = workerRows.map(workerStatusToCheck);
    const checks = [
      databaseCheck({ connection }),
      ...runtimeChecks({ envConfig }),
      ...integrationChecks({ envConfig, flags }),
      ...backupChecks({ envConfig }),
      ...workerChecks
    ];
    return { checks, workers: workerRows };
  };

  const getReadinessHealth = () => {
    const runtime = runtimeSummary({ envConfig, packageInfo });
    const checks = [
      databaseCheck({ connection }),
      ...runtimeChecks({ envConfig }).filter((item) => ["node_environment", "jwt_secret", "frontend_origin"].includes(item.id)),
      ...integrationChecks({ envConfig, flags }).filter((item) => item.status === CHECK_STATUS.FAIL)
    ];
    const failing = checks.filter((item) => item.status === CHECK_STATUS.FAIL);
    return {
      ...runtime,
      status: failing.length ? HEALTH_STATUS.UNHEALTHY : HEALTH_STATUS.HEALTHY,
      ready: failing.length === 0,
      checks
    };
  };

  const getAdminSummary = () => {
    const runtime = runtimeSummary({ envConfig, packageInfo });
    const { checks, workers: workerRows } = buildChecks();
    const status = overallStatus(checks);
    const byCategory = checks.reduce((summary, item) => {
      if (!summary[item.category]) summary[item.category] = { pass: 0, warn: 0, fail: 0, total: 0 };
      summary[item.category][item.status] += 1;
      summary[item.category].total += 1;
      return summary;
    }, {});

    return {
      ...runtime,
      status,
      checks,
      byCategory,
      workers: workerRows,
      counts: {
        pass: checks.filter((item) => item.status === CHECK_STATUS.PASS).length,
        warn: checks.filter((item) => item.status === CHECK_STATUS.WARN).length,
        fail: checks.filter((item) => item.status === CHECK_STATUS.FAIL).length,
        total: checks.length
      },
      observability: {
        structuredLogs: true,
        requestIds: true,
        correlationIds: true,
        secretsRedacted: true,
        publicHealthEndpoint: "/api/health",
        readinessEndpoint: "/api/health/ready"
      }
    };
  };

  return {
    getAdminSummary,
    getLiveHealth,
    getReadinessHealth
  };
};

const service = createSystemHealthService();

module.exports = {
  ...service,
  CHECK_STATUS,
  HEALTH_STATUS,
  createSystemHealthService,
  __testables: {
    databaseCheck,
    integrationChecks,
    normalizeWorkerStatus,
    overallStatus,
    runtimeChecks,
    workerStatusToCheck
  }
};
