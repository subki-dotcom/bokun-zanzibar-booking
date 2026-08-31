const { env, isBokunConfigured } = require("../../config/env");
const {
  getBokunConfirmedBookingImportWorkerStatus
} = require("../../jobs/bokunConfirmedBookingImport.job");

const bool = (value) => value === true || String(value || "").toLowerCase() === "true";

const normalizeWorkerStatus = (worker = {}) => ({
  name: worker.name || "bokun_confirmed_booking_import",
  status: worker.status || (!worker.enabled ? "disabled" : worker.active ? "running" : "stopped"),
  enabled: Boolean(worker.enabled),
  configured: worker.configured === undefined ? true : Boolean(worker.configured),
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
});

const resolveDataMode = ({ mockMode, configured }) => {
  if (mockMode) return "mock";
  if (configured) return "live";
  return "not_configured";
};

const parseStatuses = (value = "") =>
  String(value || "")
    .split(",")
    .map((status) => status.trim())
    .filter(Boolean);

const getBokunSyncStatus = ({
  envConfig = env,
  configured = isBokunConfigured,
  workerStatus = getBokunConfirmedBookingImportWorkerStatus()
} = {}) => {
  const mockMode = bool(envConfig.BOKUN_MOCK_MODE);
  const credentialsConfigured = Boolean(configured);
  const dataMode = resolveDataMode({ mockMode, configured: credentialsConfigured });
  const worker = normalizeWorkerStatus(workerStatus);
  const importEnabled = bool(envConfig.BOKUN_CONFIRMED_BOOKING_IMPORT_ENABLED);

  return {
    integration: {
      provider: "bokun",
      baseUrl: envConfig.BOKUN_BASE_URL || "",
      dataMode,
      mockMode,
      credentialsConfigured,
      accessKeyConfigured: Boolean(envConfig.BOKUN_ACCESS_KEY),
      secretKeyConfigured: Boolean(envConfig.BOKUN_SECRET_KEY),
      apiKeyConfigured: Boolean(envConfig.BOKUN_API_KEY),
      liveApiReady: dataMode === "live"
    },
    confirmedBookingImport: {
      enabled: importEnabled,
      ready: importEnabled && dataMode === "live",
      worker,
      defaults: {
        intervalSeconds: Number(envConfig.BOKUN_CONFIRMED_BOOKING_IMPORT_INTERVAL_SECONDS || 900),
        pageSize: Number(envConfig.BOKUN_CONFIRMED_BOOKING_IMPORT_BATCH_SIZE || 50),
        maxPages: Number(envConfig.BOKUN_CONFIRMED_BOOKING_IMPORT_MAX_PAGES || 5),
        lookbackDays: Number(envConfig.BOKUN_CONFIRMED_BOOKING_IMPORT_LOOKBACK_DAYS || 30),
        statuses: parseStatuses(envConfig.BOKUN_CONFIRMED_BOOKING_IMPORT_STATUSES || "confirmed,cancelled")
      }
    },
    adminActions: {
      manualImport: dataMode === "live" || mockMode,
      singleBookingResync: dataMode === "live" || mockMode
    },
    sourceOfTruth: {
      operationalBookingSource: "Bokun confirmed bookings",
      localAccountingSource: "Canonical local accounting records"
    }
  };
};

module.exports = {
  getBokunSyncStatus,
  __testables: {
    normalizeWorkerStatus,
    resolveDataMode
  }
};
