// One source of truth for the admin top bar and the Dashboard: the Bókun sync state and the open alert count.

// Bókun sync, from GET /bokun/admin/sync-status. It warns only on a real problem: not live, failed runs, an error,
// or no successful import for a long time.
export const bokunSyncState = (syncStatus, now = Date.now()) => {
  if (!syncStatus) return { status: "unknown", label: "Bókun status unknown", detail: "The sync status could not be loaded." };
  const integration = syncStatus.integration || {};
  const importer = syncStatus.confirmedBookingImport || {};
  const worker = importer.worker || {};
  const failures = Number(worker.consecutiveFailures || 0);
  const intervalMs = Math.max(60, Number(worker.intervalSeconds || 900)) * 1000;
  const lastSuccess = worker.lastSuccessAt ? new Date(worker.lastSuccessAt).getTime() : 0;
  const stale = worker.enabled && lastSuccess && now - lastSuccess > Math.max(3 * intervalMs, 30 * 60 * 1000);

  if (integration.dataMode !== "mock" && integration.liveApiReady === false) {
    return { status: "critical", label: "Bókun not connected", detail: "The Bókun API keys are missing or rejected." };
  }
  if (failures >= 3) return { status: "critical", label: "Bókun sync failing", detail: `${failures} failed imports in a row. ${worker.lastError || ""}`.trim() };
  if (integration.dataMode === "mock") return { status: "warning", label: "Bókun test mode", detail: "Bookings come from test data, not the live API." };
  if (failures > 0 || worker.lastError) return { status: "warning", label: "Bókun sync warning", detail: worker.lastError || "The last import failed." };
  if (stale) return { status: "warning", label: "Bókun sync delayed", detail: "No successful import recently." };
  return { status: "healthy", label: "Bókun live", detail: worker.lastSuccessAt ? `Last import ${worker.lastSuccessAt}` : "Connected" };
};

// Open alerts: paid bookings waiting for the supplier, failed payments, failed emails, finalizations to retry and
// open booking requests. From GET /reports/operational-alerts and GET /reports/operations-overview.
export const adminAlertCount = ({ operationalAlerts = null, operationsOverview = null } = {}) => {
  const counts = operationalAlerts?.counts || {};
  const queue = operationsOverview?.queue || {};
  return Number(counts.paidPendingSupplier || 0) +
    Number(counts.failedPayments || 0) +
    Number(counts.failedEmailDeliveries || 0) +
    Number(queue.retriableFinalizations || 0) +
    Number(queue.openBookingRequests || 0);
};
