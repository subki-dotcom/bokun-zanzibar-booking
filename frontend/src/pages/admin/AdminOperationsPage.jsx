import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Col, Row } from "react-bootstrap";
import { Link } from "react-router-dom";
import {
  BsActivity,
  BsArrowClockwise,
  BsCheckCircleFill,
  BsDatabase,
  BsEnvelope,
  BsExclamationTriangleFill,
  BsGearWideConnected,
  BsXCircleFill
} from "react-icons/bs";
import { fetchOperationsOverview } from "../../api/adminApi";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";

const statusMeta = {
  healthy: { label: "Healthy", bg: "success", icon: BsCheckCircleFill },
  warning: { label: "Needs attention", bg: "warning", icon: BsExclamationTriangleFill },
  critical: { label: "Critical", bg: "danger", icon: BsXCircleFill }
};

const integrationMeta = (mode) => {
  if (mode === "live") return { label: "Live", bg: "success" };
  if (mode === "test") return { label: "Test mode", bg: "warning" };
  return { label: "Not configured", bg: "secondary" };
};

const formatTimestamp = (value) => {
  if (!value) return "No sync recorded";

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No sync recorded" : date.toLocaleString();
};

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

  if (loading) return <Loader />;

  const currentStatus = statusMeta[overview?.status] || statusMeta.warning;
  const StatusIcon = currentStatus.icon;
  const queue = overview?.queue || {};
  const metrics = [
    { label: "Paid, supplier pending", value: queue.paidPendingSupplier || 0, icon: BsGearWideConnected, to: "/admin/recovery" },
    { label: "Retriable finalizations", value: queue.retriableFinalizations || 0, icon: BsArrowClockwise, to: "/admin/recovery" },
    { label: "Failed emails", value: queue.failedEmails || 0, icon: BsEnvelope, to: "/admin/sync-logs" },
    { label: "Open booking requests", value: queue.openBookingRequests || 0, icon: BsActivity, to: "/admin/booking-requests" }
  ];

  return (
    <section className="admin-operations-page">
      <div className="admin-operations-header">
        <div>
          <span className="admin-operations-eyebrow">System control</span>
          <h1>Operations Center</h1>
          <p>Monitor booking reliability, supplier connectivity, payment readiness, and operational queues.</p>
        </div>
        <div className="admin-operations-header-actions">
          <Badge bg={currentStatus.bg} className="admin-operations-status">
            <StatusIcon aria-hidden="true" /> {currentStatus.label}
          </Badge>
          <Button variant="outline-primary" onClick={() => loadOverview({ silent: true })} disabled={refreshing}>
            <BsArrowClockwise aria-hidden="true" className={refreshing ? "is-spinning" : ""} />
            {refreshing ? "Refreshing" : "Refresh"}
          </Button>
        </div>
      </div>

      <ErrorAlert error={error} />

      {overview && (
        <>
          <Row className="g-3 mb-4">
            {metrics.map(({ label, value, icon: Icon, to }) => (
              <Col key={label} sm={6} xl={3}>
                <Card as={Link} to={to} className="surface-card admin-operation-metric text-decoration-none h-100">
                  <Card.Body>
                    <span className="admin-operation-metric-icon"><Icon aria-hidden="true" /></span>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </Card.Body>
                </Card>
              </Col>
            ))}
          </Row>

          <Row className="g-4">
            <Col lg={7}>
              <Card className="surface-card admin-operations-card h-100">
                <Card.Body>
                  <div className="admin-operations-card-heading">
                    <div>
                      <h2>Service readiness</h2>
                      <p>Configuration status only. Credentials are never shown here.</p>
                    </div>
                    <small>Updated {formatTimestamp(overview.generatedAt)}</small>
                  </div>

                  <div className="admin-service-list">
                    <div className="admin-service-row">
                      <span className="admin-service-icon"><BsDatabase aria-hidden="true" /></span>
                      <div><strong>MongoDB</strong><small>{overview.runtime?.database?.status || "unknown"}</small></div>
                      <Badge bg={overview.runtime?.database?.healthy ? "success" : "danger"}>
                        {overview.runtime?.database?.healthy ? "Connected" : "Unavailable"}
                      </Badge>
                    </div>
                    {(overview.integrations || []).map((integration) => {
                      const mode = integrationMeta(integration.mode);
                      return (
                        <div className="admin-service-row" key={integration.id}>
                          <span className="admin-service-icon"><BsGearWideConnected aria-hidden="true" /></span>
                          <div><strong>{integration.label}</strong><small>{integration.note || (integration.mode === "live" ? "Ready for production traffic" : "Check configuration before enabling live sales")}</small></div>
                          <Badge bg={mode.bg}>{mode.label}</Badge>
                        </div>
                      );
                    })}
                  </div>
                </Card.Body>
              </Card>
            </Col>

            <Col lg={5}>
              <Card className="surface-card admin-operations-card h-100">
                <Card.Body>
                  <div className="admin-operations-card-heading">
                    <div><h2>Background jobs</h2><p>Retries keep paid bookings moving safely.</p></div>
                  </div>
                  <div className="admin-job-list">
                    {(overview.jobs || []).map((job) => (
                      <div className="admin-job-row" key={job.id}>
                        <div>
                          <strong>{job.label}</strong>
                          <small>Every {job.intervalSeconds || "-"} seconds</small>
                        </div>
                        <Badge bg={job.enabled ? "success" : "secondary"}>{job.enabled ? "Enabled" : "Disabled"}</Badge>
                      </div>
                    ))}
                  </div>
                  <div className="admin-operations-runtime">
                    <span>Environment <strong>{overview.runtime?.environment || "unknown"}</strong></span>
                    <span>Uptime <strong>{formatUptime(overview.runtime?.uptimeSeconds)}</strong></span>
                  </div>
                </Card.Body>
              </Card>
            </Col>

            <Col xs={12}>
              <Card className="surface-card admin-operations-card">
                <Card.Body>
                  <div className="admin-operations-card-heading">
                    <div><h2>Supplier sync</h2><p>Most recent Bókun sync or webhook processing event.</p></div>
                    <Link className="btn btn-outline-primary btn-sm" to="/admin/sync-logs">Open sync logs</Link>
                  </div>
                  <div className="admin-sync-summary">
                    <span>Status <Badge bg={queue.latestBokunSync?.status === "success" ? "success" : "secondary"}>{queue.latestBokunSync?.status || "No activity"}</Badge></span>
                    <span>Source <strong>{queue.latestBokunSync?.operation || "-"}</strong></span>
                    <span>Completed <strong>{formatTimestamp(queue.latestBokunSync?.completedAt)}</strong></span>
                  </div>
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </>
      )}
    </section>
  );
};

export default AdminOperationsPage;
