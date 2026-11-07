import { useCallback, useEffect, useState } from "react";
import { Button } from "react-bootstrap";
import { Link } from "react-router-dom";
import { BsActivity, BsArrowClockwise, BsDatabase, BsEnvelope, BsGearWideConnected } from "react-icons/bs";
import { fetchOperationsOverview } from "../../api/adminApi";
import { AdminPage, ErrorState, LoadingSkeleton, PageHeader, SectionCard, StatCard, StatGrid, StatusBadge } from "../../components/admin/ui";
import { formatAdminDateTime } from "../../utils/adminFormat";
import { formatLabel } from "../../utils/formatLabel";

const statusMeta = {
  healthy: { label: "Healthy", tone: "success" },
  warning: { label: "Needs attention", tone: "warning" },
  critical: { label: "Critical", tone: "danger" }
};

const integrationMeta = (mode) => {
  if (mode === "live") return { label: "Live", tone: "success" };
  if (mode === "test") return { label: "Test mode", tone: "warning" };
  return { label: "Not set up", tone: "neutral" };
};

const formatTimestamp = (value) => (value ? formatAdminDateTime(value) : "No sync recorded");

const formatUptime = (seconds = 0) => {
  const total = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};

const AdminOperationsPage = () => {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const loadOverview = useCallback(async ({ silent = false } = {}) => {
    try {
      silent ? setRefreshing(true) : setLoading(true);
      setError(null);
      setOverview(await fetchOperationsOverview());
    } catch (loadError) {
      setError(loadError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const currentStatus = statusMeta[overview?.status] || statusMeta.warning;
  const queue = overview?.queue || {};
  const metrics = [
    { label: "Paid, waiting for supplier", value: queue.paidPendingSupplier || 0, icon: BsGearWideConnected, to: "/admin/operations/recovery" },
    { label: "Confirmations to retry", value: queue.retriableFinalizations || 0, icon: BsArrowClockwise, to: "/admin/operations/recovery" },
    { label: "Failed emails", value: queue.failedEmails || 0, icon: BsEnvelope, to: "/admin/operations/bokun-sync/sync-logs" },
    { label: "Open booking requests", value: queue.openBookingRequests || 0, icon: BsActivity, to: "/admin/operations/booking-requests" }
  ];

  return (
    <AdminPage className="admin-operations-page">
      <PageHeader
        eyebrow="Operations"
        title="Tour Operations"
        description="Is everything running? Supplier connection, payments, background jobs and the queues that need a person."
        actions={
          <>
            {overview ? <StatusBadge value={overview.status} label={currentStatus.label} tone={currentStatus.tone} /> : null}
            <Button variant="outline-secondary" onClick={() => loadOverview({ silent: true })} disabled={refreshing || loading}>
              <BsArrowClockwise aria-hidden="true" className={refreshing ? "is-spinning" : ""} />
              {refreshing ? "Refreshing" : "Refresh"}
            </Button>
          </>
        }
      />

      {error && !overview ? <ErrorState message={error.message || "The operations overview could not be loaded."} onRetry={() => loadOverview()} /> : null}

      <StatGrid columns={4}>
        {metrics.map(({ label, value, icon, to }) => (
          <Link key={label} to={to} className="text-decoration-none">
            <StatCard label={label} value={value} icon={icon} loading={loading} status={value ? "warning" : ""} />
          </Link>
        ))}
      </StatGrid>

      {loading ? <SectionCard><LoadingSkeleton rows={6} /></SectionCard> : null}

      {overview ? (
        <>
          <div className="row g-3">
            <div className="col-lg-7">
              <SectionCard title="Service readiness" description="Configuration status only; credentials are never shown." actions={<small className="text-muted">Updated {formatTimestamp(overview.generatedAt)}</small>}>
                <div className="admin-service-list">
                  <div className="admin-service-row">
                    <span className="admin-service-icon"><BsDatabase aria-hidden="true" /></span>
                    <div><strong>Database</strong><small>{formatLabel(overview.runtime?.database?.status || "unknown")}</small></div>
                    <StatusBadge value={overview.runtime?.database?.healthy ? "connected" : "failed"} label={overview.runtime?.database?.healthy ? "Connected" : "Unavailable"} />
                  </div>
                  {(overview.integrations || []).map((integration) => {
                    const mode = integrationMeta(integration.mode);
                    return (
                      <div className="admin-service-row" key={integration.id}>
                        <span className="admin-service-icon"><BsGearWideConnected aria-hidden="true" /></span>
                        <div><strong>{integration.label}</strong><small>{integration.note || (integration.mode === "live" ? "Ready for real bookings" : "Check the setup before taking live sales")}</small></div>
                        <StatusBadge value={integration.mode} label={mode.label} tone={mode.tone} />
                      </div>
                    );
                  })}
                </div>
              </SectionCard>
            </div>

            <div className="col-lg-5">
              <SectionCard title="Background jobs" description="Automatic retries keep paid bookings moving.">
                <div className="admin-job-list">
                  {(overview.jobs || []).map((job) => (
                    <div className="admin-job-row" key={job.id}>
                      <div>
                        <strong>{job.label}</strong>
                        <small>Every {job.intervalSeconds || "—"} seconds</small>
                      </div>
                      <StatusBadge value={job.enabled ? "on" : "off"} label={job.enabled ? "On" : "Off"} />
                    </div>
                  ))}
                </div>
                <div className="admin-operations-runtime">
                  <span>Environment <strong>{formatLabel(overview.runtime?.environment || "unknown")}</strong></span>
                  <span>Uptime <strong>{formatUptime(overview.runtime?.uptimeSeconds)}</strong></span>
                </div>
              </SectionCard>
            </div>
          </div>

          <SectionCard
            title="Supplier sync"
            description="The latest Bókun import or webhook."
            actions={<Link className="btn btn-outline-primary btn-sm" to="/admin/operations/bokun-sync/sync-logs">Open sync logs</Link>}
          >
            <div className="admin-sync-summary">
              <span>Status <StatusBadge value={queue.latestBokunSync?.status || "none"} label={queue.latestBokunSync?.status ? formatLabel(queue.latestBokunSync.status) : "No activity"} /></span>
              <span>Source <strong title={queue.latestBokunSync?.operation || ""}>{formatLabel(queue.latestBokunSync?.operation || "—")}</strong></span>
              <span>Completed <strong>{formatTimestamp(queue.latestBokunSync?.completedAt)}</strong></span>
            </div>
          </SectionCard>
        </>
      ) : null}
    </AdminPage>
  );
};

export default AdminOperationsPage;
