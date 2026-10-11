process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/system-health-core-test";
process.env.JWT_SECRET = "system-health-core-test-secret-with-enough-length";

const test = require("node:test");
const assert = require("node:assert/strict");
const logger = require("../src/config/logger");
const {
  CHECK_STATUS,
  HEALTH_STATUS,
  createSystemHealthService,
  __testables
} = require("../src/services/systemHealth");

const baseEnv = {
  NODE_ENV: "production",
  JWT_SECRET: "production-jwt-signing-value-with-very-good-length",
  FRONTEND_URL: "https://example.test",
  RATE_LIMIT_WINDOW_MS: 900000,
  RATE_LIMIT_MAX: 1200,
  BOKUN_MOCK_MODE: false,
  PESAPAL_MOCK_MODE: false,
  DPO_MOCK_MODE: false,
  PAYPAL_MOCK_MODE: false,
  EMAIL_ENABLED: true,
  EMAIL_PROVIDER: "resend",
  DR_BACKUP_DIRECTORY: "backups/mongodb",
  DR_BACKUP_STORAGE_PROVIDER: "s3",
  DR_BACKUP_RETENTION_DAYS: 30,
  DR_BACKUP_RPO_HOURS: 24,
  DR_BACKUP_RTO_HOURS: 4,
  DR_ALLOW_PRODUCTION_RESTORE: false
};

const connectedDb = {
  readyState: 1,
  host: "127.0.0.1",
  name: "health-test"
};

const workers = () => [
  {
    name: "booking_finalization",
    enabled: true,
    active: true,
    intervalSeconds: 30,
    batchSize: 20,
    consecutiveFailures: 0
  },
  {
    name: "refund_reconciliation",
    enabled: false,
    active: false,
    intervalSeconds: 600,
    batchSize: 20,
    consecutiveFailures: 0
  }
];

test("structured logger redacts secrets, bearer tokens and MongoDB credentials", () => {
  const safe = logger.__testables.sanitizeLogMeta({
    authorization: "Bearer live-token-123",
    mongoUri: "mongodb://user:pass@127.0.0.1:27017/app?password=query-secret",
    nested: {
      apiKey: "abc123",
      message: "access_token=secret-token"
    }
  });

  assert.equal(safe.authorization, "[redacted]");
  assert.equal(safe.mongoUri.includes("user:pass"), false);
  assert.equal(safe.mongoUri.includes("query-secret"), false);
  assert.equal(safe.mongoUri.startsWith("mongodb://[redacted]:[redacted]@"), true);
  assert.equal(safe.nested.apiKey, "[redacted]");
  assert.equal(safe.nested.message, "access_token=[redacted]");
});

test("system health summary is degraded by optional warnings while required runtime is ready", () => {
  const service = createSystemHealthService({
    envConfig: baseEnv,
    connection: connectedDb,
    flags: {
      isBokunConfigured: true,
      isPesapalConfigured: true,
      isDpoConfigured: false,
      isPaypalConfigured: false,
      isEmailConfigured: true
    },
    workers
  });

  const summary = service.getAdminSummary();

  assert.equal(summary.status, HEALTH_STATUS.DEGRADED);
  assert.equal(summary.checks.some((check) => check.id === "database_connection" && check.status === CHECK_STATUS.PASS), true);
  assert.equal(summary.checks.some((check) => check.id === "payment_provider_available" && check.status === CHECK_STATUS.PASS), true);
  assert.equal(summary.workers.length, 2);
  assert.equal(summary.observability.secretsRedacted, true);
});

test("readiness fails when database is disconnected or production critical config is missing", () => {
  const service = createSystemHealthService({
    envConfig: {
      ...baseEnv,
      FRONTEND_URL: "",
      BOKUN_MOCK_MODE: false,
      PESAPAL_MOCK_MODE: false,
      DPO_MOCK_MODE: false,
      PAYPAL_MOCK_MODE: false
    },
    connection: { readyState: 0 },
    flags: {
      isBokunConfigured: false,
      isPesapalConfigured: false,
      isDpoConfigured: false,
      isPaypalConfigured: false,
      isEmailConfigured: false
    },
    workers: () => []
  });

  const ready = service.getReadinessHealth();

  assert.equal(ready.ready, false);
  assert.equal(ready.status, HEALTH_STATUS.UNHEALTHY);
  assert.equal(ready.checks.some((check) => check.id === "database_connection" && check.status === CHECK_STATUS.FAIL), true);
  assert.equal(ready.checks.some((check) => check.id === "frontend_origin" && check.status === CHECK_STATUS.FAIL), true);
  assert.equal(ready.checks.some((check) => check.id === "bokun_configuration" && check.status === CHECK_STATUS.FAIL), true);
});

test("worker health flags repeated failures as failed monitoring evidence", () => {
  const workerCheck = __testables.workerStatusToCheck({
    name: "refund_reconciliation",
    enabled: true,
    active: true,
    consecutiveFailures: 3,
    lastError: "Provider timeout"
  });

  assert.equal(workerCheck.status, CHECK_STATUS.FAIL);
  assert.equal(workerCheck.details.consecutiveFailures, 3);
  assert.equal(workerCheck.message.includes("3 consecutive failures"), true);
});

test("public readiness payload never exposes check details such as database host or name", () => {
  const service = createSystemHealthService({
    envConfig: { ...baseEnv, JWT_SECRET: "short" },
    connection: { readyState: 1, host: "cluster0-shard-00-00.example.mongodb.net", name: "riser_booking" },
    flags: {
      isBokunConfigured: true,
      isPesapalConfigured: true,
      isDpoConfigured: false,
      isPaypalConfigured: false,
      isEmailConfigured: true
    },
    workers: () => []
  });

  const ready = service.getReadinessHealth();
  const serialized = JSON.stringify(ready);

  assert.equal(ready.ready, false);
  assert.equal(serialized.includes("mongodb.net"), false);
  assert.equal(serialized.includes("riser_booking"), false);
  assert.equal(ready.checks.every((check) => check.details === undefined), true);
  assert.equal(ready.checks.some((check) => check.id === "jwt_secret" && check.status === CHECK_STATUS.FAIL), true);
});

test("admin JWT check explains weakness reasons without exposing the secret", () => {
  assert.deepEqual(__testables.jwtWeaknessReasons("", true), ["missing"]);
  assert.deepEqual(__testables.jwtWeaknessReasons("short-but-random", true), ["too_short"]);
  assert.deepEqual(
    __testables.jwtWeaknessReasons("my-dev-value-that-is-long-enough-for-production-use", true),
    ["placeholder_pattern"]
  );
  assert.deepEqual(__testables.jwtWeaknessReasons("Zq8vN3kLp9WmR2xT7yHb4cJf6gAe1sUo", true), []);

  const [, jwtCheck] = __testables.runtimeChecks({ envConfig: { ...baseEnv, JWT_SECRET: "tiny-jwt" } });
  assert.equal(jwtCheck.status, CHECK_STATUS.FAIL);
  assert.deepEqual(jwtCheck.details.weaknessReasons, ["too_short"]);
  assert.equal(JSON.stringify(jwtCheck).includes("tiny-jwt"), false);
});

test("observability secret redaction is verified with a canary, not assumed", () => {
  const leaking = createSystemHealthService({
    envConfig: baseEnv,
    connection: { readyState: 1 },
    workers: () => [],
    verifyRedaction: () => false
  });
  assert.equal(leaking.getAdminSummary().observability.secretsRedacted, false);
  assert.equal(logger.verifyRedaction(), true);
  assert.equal(logger.__testables.redactString("token=abc123").includes("abc123"), false);
  assert.equal(
    logger.__testables.redactString("Authorization: Basic dXNlcjpwYXNzd29yZA==").includes("dXNlcjpwYXNzd29yZA"),
    false
  );
});
