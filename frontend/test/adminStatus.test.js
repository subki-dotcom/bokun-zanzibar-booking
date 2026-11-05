import test from "node:test";
import assert from "node:assert/strict";
import { adminAlertCount, bokunSyncState } from "../src/utils/adminStatus.js";

const now = Date.parse("2026-11-05T06:00:00Z");
const live = (worker = {}) => ({
  integration: { dataMode: "live", liveApiReady: true },
  confirmedBookingImport: { ready: true, worker: { enabled: true, intervalSeconds: 60, consecutiveFailures: 0, lastError: "", lastSuccessAt: "2026-11-05T05:59:00Z", ...worker } }
});

test("Bókun: healthy when live and importing, warnings only for a real problem", () => {
  assert.equal(bokunSyncState(live(), now).status, "healthy");
  assert.equal(bokunSyncState(null, now).status, "unknown");
  assert.equal(bokunSyncState(live({ consecutiveFailures: 1, lastError: "timeout" }), now).status, "warning");
  assert.equal(bokunSyncState(live({ consecutiveFailures: 3 }), now).status, "critical");
  assert.equal(bokunSyncState(live({ lastSuccessAt: "2026-11-05T04:00:00Z" }), now).status, "warning", "no import for 2 hours");
  assert.equal(bokunSyncState({ ...live(), integration: { dataMode: "live", liveApiReady: false } }, now).status, "critical");
  assert.equal(bokunSyncState({ ...live(), integration: { dataMode: "mock" } }, now).status, "warning");
});

test("alerts: one count for the top bar and the dashboard", () => {
  const count = adminAlertCount({
    operationalAlerts: { counts: { paidPendingSupplier: 2, failedPayments: 8, failedEmailDeliveries: 0 } },
    operationsOverview: { queue: { paidPendingSupplier: 2, retriableFinalizations: 3, openBookingRequests: 0 } }
  });
  assert.equal(count, 13);
  assert.equal(adminAlertCount({}), 0);
});
