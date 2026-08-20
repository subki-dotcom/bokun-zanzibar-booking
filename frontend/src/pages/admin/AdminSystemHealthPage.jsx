import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Col, Row, Table } from "react-bootstrap";
import { BsArrowClockwise, BsCheckCircle, BsExclamationTriangle, BsHeartPulse, BsXCircle } from "react-icons/bs";
import { fetchSystemHealthSummary } from "../../api/adminApi";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";

const statusVariant = (status = "") => ({
  healthy: "success",
  degraded: "warning",
  unhealthy: "danger",
  pass: "success",
  warn: "warning",
  fail: "danger",
  running: "success",
  stopped: "warning",
  disabled: "secondary"
})[status] || "secondary";

const statusIcon = (status = "") => {
  if (status === "pass" || status === "healthy" || status === "running") return BsCheckCircle;
  if (status === "fail" || status === "unhealthy") return BsXCircle;
  return BsExclamationTriangle;
};

const formatStatus = (value = "") => String(value || "-").replaceAll("_", " ");

const formatDate = (value = "") => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
};

const KpiCard = ({ label, value, detail, status }) => {
  const Icon = statusIcon(status);
  return (
    <Card className="surface-card h-100">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-start gap-3">
          <div>
            <small className="text-muted d-block">{label}</small>
            <strong className="fs-4 d-block text-capitalize">{value}</strong>
            {detail ? <span className="text-muted small">{detail}</span> : null}
          </div>
          <span className="admin-platform-brand-mark d-inline-flex align-items-center justify-content-center">
            <Icon aria-hidden="true" />
          </span>
        </div>
      </Card.Body>
    </Card>
  );
};

const AdminSystemHealthPage = () => {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const data = await fetchSystemHealthSummary();
      setSummary(data);
    } catch (err) {
      setError(err.message || "Failed to load system health");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const groupedChecks = useMemo(() => {
    const groups = new Map();
    (summary?.checks || []).forEach((check) => {
      const key = check.category || "system";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(check);
    });
    return Array.from(groups.entries());
  }, [summary]);

  if (loading) return <Loader message="Loading system health..." />;

  return (
    <div className="admin-system-health-page">
      <div className="admin-platform-page-header">
        <div>
          <span className="admin-platform-eyebrow">Monitoring</span>
          <h2>System Health</h2>
          <p>Runtime readiness, integration configuration, worker status, and safe observability checks.</p>
        </div>
        <Button variant="outline-secondary" onClick={() => load({ silent: true })} disabled={refreshing}>
          <BsArrowClockwise /> {refreshing ? "Refreshing" : "Refresh"}
        </Button>
      </div>

      <ErrorAlert error={error} />

      <Row className="g-3">
        <Col md={6} xl={3}>
          <KpiCard
            label="Overall Status"
            value={formatStatus(summary?.status)}
            detail={`${summary?.environment || "-"} · ${summary?.version || ""}`}
            status={summary?.status}
          />
        </Col>
        <Col md={6} xl={3}>
          <KpiCard
            label="Passing Checks"
            value={summary?.counts?.pass || 0}
            detail={`${summary?.counts?.total || 0} total checks`}
            status="pass"
          />
        </Col>
        <Col md={6} xl={3}>
          <KpiCard
            label="Warnings"
            value={summary?.counts?.warn || 0}
            detail="Needs review, not necessarily down"
            status={summary?.counts?.warn ? "warn" : "pass"}
          />
        </Col>
        <Col md={6} xl={3}>
          <KpiCard
            label="Failures"
            value={summary?.counts?.fail || 0}
            detail={`Updated ${formatDate(summary?.generatedAt)}`}
            status={summary?.counts?.fail ? "fail" : "pass"}
          />
        </Col>
      </Row>

      <Row className="g-4 mt-1">
        <Col xl={5}>
          <Card className="surface-card h-100">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
                <div>
                  <h5 className="mb-1">Workers</h5>
                  <small className="text-muted">Pollers and reconciliation loops in this backend process.</small>
                </div>
                <span className="admin-platform-brand-mark d-inline-flex align-items-center justify-content-center">
                  <BsHeartPulse aria-hidden="true" />
                </span>
              </div>
              <Table responsive hover className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Worker</th>
                    <th>Status</th>
                    <th className="text-end">Failures</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary?.workers || []).map((worker) => (
                    <tr key={worker.name}>
                      <td>{formatStatus(worker.name)}</td>
                      <td><Badge bg={statusVariant(worker.status)}>{formatStatus(worker.status)}</Badge></td>
                      <td className="text-end">{worker.consecutiveFailures || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
        <Col xl={7}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h5 className="mb-3">Observability</h5>
              <div className="d-grid gap-2">
                {Object.entries(summary?.observability || {}).map(([key, value]) => (
                  <div key={key} className="d-flex justify-content-between gap-3 border rounded-3 p-2">
                    <span>{formatStatus(key)}</span>
                    <strong>{typeof value === "boolean" ? (value ? "Enabled" : "Disabled") : value}</strong>
                  </div>
                ))}
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-4 mt-1">
        <Col>
          <Card className="surface-card">
            <Card.Body>
              <h5 className="mb-3">Health Checks</h5>
              <div className="d-grid gap-3">
                {groupedChecks.map(([category, checks]) => (
                  <div key={category}>
                    <div className="d-flex align-items-center justify-content-between mb-2">
                      <strong className="text-capitalize">{formatStatus(category)}</strong>
                      <Badge bg="light" text="dark">{checks.length}</Badge>
                    </div>
                    <Table responsive hover className="align-middle">
                      <thead>
                        <tr>
                          <th>Check</th>
                          <th>Status</th>
                          <th>Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {checks.map((check) => (
                          <tr key={check.id}>
                            <td>{check.label}</td>
                            <td><Badge bg={statusVariant(check.status)}>{formatStatus(check.status)}</Badge></td>
                            <td>{check.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                ))}
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default AdminSystemHealthPage;
