process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/bokun-webhook-import-test";
process.env.JWT_SECRET ||= "bokun-webhook-import-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const path = require("path");

const loadWithMocks = ({ bookingFindOne = null, manualResync = null, nodeEnv = "test" } = {}) => {
  // Reset require cache for target modules
  const bookingPath = path.resolve(__dirname, "..", "src", "models", "Booking.js");
  const confirmedPath = path.resolve(__dirname, "..", "src", "services", "bokunConfirmedBookings", "index.js");
  const syncLogPath = path.resolve(__dirname, "..", "src", "models", "SyncLog.js");
  const auditLogPath = path.resolve(__dirname, "..", "src", "models", "AuditLog.js");
  delete require.cache[bookingPath];
  delete require.cache[confirmedPath];
  delete require.cache[syncLogPath];
  delete require.cache[auditLogPath];

  if (bookingFindOne !== null) {
    require.cache[bookingPath] = {
      id: bookingPath,
      filename: bookingPath,
      loaded: true,
      exports: {
        findOne: bookingFindOne
      }
    };
  }

  if (manualResync !== null) {
    require.cache[confirmedPath] = {
      id: confirmedPath,
      filename: confirmedPath,
      loaded: true,
      exports: {
        manualResync
      }
    };
  }

  // Stub SyncLog and AuditLog to avoid DB access in unit tests
  require.cache[syncLogPath] = {
    id: syncLogPath,
    filename: syncLogPath,
    loaded: true,
    exports: {
      create: async (payload) => ({ _id: `sync-mock-${Date.now()}`, ...payload, save: async function save() { return this; } })
    }
  };

  require.cache[auditLogPath] = {
    id: auditLogPath,
    filename: auditLogPath,
    loaded: true,
    exports: {
      create: async (payload) => payload
    }
  };

  process.env.NODE_ENV = nodeEnv;
  // Ensure config/env is reloaded so envalid reads current process.env
  const envPath = path.resolve(__dirname, "..", "src", "config", "env.js");
  delete require.cache[envPath];
  // Require the webhooks module after mocks are in place
  const webhooksPath = path.resolve(__dirname, "..", "src", "services", "webhooks", "index.js");
  delete require.cache[webhooksPath];
  const webhooks = require("../src/services/webhooks");
  return webhooks;
};

test("missing confirmed booking + flag OFF => skipped", async () => {
  process.env.BOKUN_WEBHOOK_IMPORT_MISSING = "false";

  const webhooks = loadWithMocks({ bookingFindOne: async () => null, manualResync: null, nodeEnv: "test" });

  const payload = { bookingReference: "", bookingId: "", confirmationCode: "CONF-1001" };
  const res = await webhooks.handleBokunWebhook({ payload, headers: {}, requestId: "test-1" });
  assert.equal(res.summary.skipped, 1);
});

test("missing confirmed booking + flag ON => importer invoked and booking imported", async () => {
  process.env.BOKUN_WEBHOOK_IMPORT_MISSING = "true";

  let called = false;
  const manualResync = async ({ reference, requestId } = {}) => {
    called = true;
    return { syncLogId: "sync-1", result: { action: "imported", bookingReference: reference } };
  };

  const webhooks = loadWithMocks({ bookingFindOne: async () => null, manualResync, nodeEnv: "test" });

  const payload = { bookingReference: "VTR-1001", bookingId: "BOKUN-1001", confirmationCode: "CONF-1001" };
  const res = await webhooks.handleBokunWebhook({ payload, headers: {}, requestId: "test-2" });
  assert.equal(called, true);
  assert.equal(res.summary.updated, 1);
});

test("same webhook twice -> importer idempotent behaviour simulated", async () => {
  process.env.BOKUN_WEBHOOK_IMPORT_MISSING = "true";
  const results = [
    { syncLogId: "s1", result: { action: "imported", bookingReference: "VTR-1001" } },
    { syncLogId: "s2", result: { action: "unchanged", bookingReference: "VTR-1001" } }
  ];
  let calls = 0;
  const manualResync = async () => {
    const out = results[calls] || results[results.length - 1];
    calls += 1;
    return out;
  };

  const webhooks = loadWithMocks({ bookingFindOne: async () => null, manualResync, nodeEnv: "test" });

  const payload = { bookingReference: "VTR-1001", bookingId: "BOKUN-1001", confirmationCode: "CONF-1001" };
  const first = await webhooks.handleBokunWebhook({ payload, headers: {}, requestId: "t-3a" });
  const second = await webhooks.handleBokunWebhook({ payload, headers: {}, requestId: "t-3b" });

  assert.equal(first.summary.updated, 1);
  // second run returns unchanged -> counts as unchanged (not updated or skipped)
  assert.equal(second.summary.unchanged, 1);
  assert.equal(calls >= 2, true);
});

test("invalid webhook signature in production => rejected", async () => {
  process.env.BOKUN_WEBHOOK_IMPORT_MISSING = "true";
  const webhooks = loadWithMocks({ bookingFindOne: async () => null, manualResync: null, nodeEnv: "production" });

  let threw = false;
  try {
    await webhooks.handleBokunWebhook({ payload: { confirmationCode: "CONF-1001" }, headers: {}, requestId: "r-prod" });
  } catch (err) {
    threw = true;
    assert.equal(err.code, "WEBHOOK_SECRET_INVALID");
  }

  assert.equal(threw, true);
});
