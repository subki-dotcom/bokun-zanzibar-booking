import { useEffect, useState } from "react";
import { Alert, Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { BsArrowClockwise, BsBell, BsExclamationTriangle, BsPlayCircle } from "react-icons/bs";
import {
  acknowledgeSystemAlert,
  dismissSystemAlert,
  fetchFailedJobs,
  fetchOpsControlSummary,
  fetchSystemAlerts,
  resolveSystemAlert,
  retryFailedJob
} from "../../api/adminApi";
import { AdminMetricCard, StatusBadge, formatDateTime } from "../../components/admin/AdminDataWidgets";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";

const AdminOpsControlPage = () => {
  const [summary, setSummary] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = async ({ silent = false, nextCategory = category } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const filters = nextCategory ? { category: nextCategory } : {};
      const [nextSummary, nextAlerts, nextJobs] = await Promise.all([
        fetchOpsControlSummary(),
        fetchSystemAlerts({ ...filters, limit: 25 }),
        fetchFailedJobs({ ...filters, limit: 25 })
      ]);
      setSummary(nextSummary);
      setAlerts(nextAlerts.items || []);
      setJobs(nextJobs.items || []);
    } catch (err) {
      setError(err.message || "Failed to load ops control");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runAction = async (key, action, message) => {
    setBusy(key);
    setNotice("");
    setError("");
    try {
      await action();
      setNotice(message);
      await load({ silent: true });
    } catch (err) {
      setError(err.message || "Action failed");
    } finally {
      setBusy("");
    }
  };

  const changeCategory = (value) => {
    setCategory(value);
    load({ silent: true, nextCategory: value });
  };

  if (loading) return <Loader message="Loading operations control..." />;

  return (
    <div className="admin-ops-control-page">
      <div className="admin-platform-page-header">
        <div>
          <span className="admin-platform-eyebrow">Operations Control</span>
          <h2>Ops Control</h2>
          <p>System alerts, failed jobs, safe retry actions, and persisted operational evidence.</p>
        </div>
        <Button variant="outline-secondary" onClick={() => load({ silent: true })} disabled={refreshing || Boolean(busy)}>
          <BsArrowClockwise /> {refreshing ? "Refreshing" : "Refresh"}
        </Button>
      </div>

      <ErrorAlert error={error} />
      {notice ? <Alert variant="info">{notice}</Alert> : null}

      <Row className="g-3">
        <Col md={6} xl={3}>
          <AdminMetricCard label="Open Critical Alerts" value={summary?.openCriticalAlerts || 0} icon={BsBell} status={(summary?.openCriticalAlerts || 0) ? "CRITICAL" : "COMPLETED"} />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard label="Retryable Failed Jobs" value={summary?.retryableFailedJobs || 0} icon={BsPlayCircle} status={(summary?.retryableFailedJobs || 0) ? "WARNING" : "COMPLETED"} />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard label="Alerts" value={summary?.alerts?.total || 0} detail="Filtered alert evidence" icon={BsBell} />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard label="Failed Jobs" value={summary?.failedJobs?.total || 0} detail="Derived from persisted workflows" icon={BsExclamationTriangle} />
        </Col>
      </Row>

      <Card className="surface-card mt-4">
        <Card.Body>
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-3">
            <div>
              <h5 className="mb-1">Control Filters</h5>
              <small className="text-muted">Retries use existing backend handlers only.</small>
            </div>
            <Form.Select value={category} onChange={(event) => changeCategory(event.target.value)} aria-label="Alert category">
              <option value="">All categories</option>
              {(summary?.categories || []).map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
            </Form.Select>
          </div>
        </Card.Body>
      </Card>

      <Row className="g-4 mt-1">
        <Col xl={7}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h5 className="mb-3">System Alerts</h5>
              <Table responsive hover className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Alert</th>
                    <th>Severity</th>
                    <th>State</th>
                    <th>Last Seen</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.length ? alerts.map((alert) => (
                    <tr key={alert.alertKey}>
                      <td>
                        <strong className="d-block">{alert.title}</strong>
                        <small className="text-muted">{alert.reference || alert.message}</small>
                      </td>
                      <td><StatusBadge value={alert.severity} /></td>
                      <td><StatusBadge value={alert.state} /></td>
                      <td>{formatDateTime(alert.lastSeenAt)}</td>
                      <td>
                        <div className="d-flex flex-wrap gap-2">
                          <Button size="sm" variant="outline-secondary" disabled={Boolean(busy)} onClick={() => runAction(alert.alertKey, () => acknowledgeSystemAlert(alert.alertKey), "Alert acknowledged.")}>Ack</Button>
                          <Button
                            size="sm"
                            variant="outline-success"
                            disabled={Boolean(busy)}
                            onClick={() => {
                              const note = alert.requiresExplicitResolution ? window.prompt("Resolution note required") : "";
                              if (alert.requiresExplicitResolution && !note) return;
                              runAction(alert.alertKey, () => resolveSystemAlert(alert.alertKey, note || "Resolved from Ops Control"), "Alert resolved.");
                            }}
                          >
                            Resolve
                          </Button>
                          <Button size="sm" variant="outline-danger" disabled={Boolean(busy) || alert.requiresExplicitResolution} onClick={() => runAction(alert.alertKey, () => dismissSystemAlert(alert.alertKey), "Alert dismissed.")}>Dismiss</Button>
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan={5} className="text-center text-muted py-4">No alerts match this filter.</td></tr>
                  )}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
        <Col xl={5}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h5 className="mb-3">Failed Jobs</h5>
              <Table responsive hover className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Status</th>
                    <th>Retry</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.length ? jobs.map((job) => (
                    <tr key={job.id}>
                      <td>
                        <strong className="d-block">{job.jobType}</strong>
                        <small className="text-muted">{job.reference || job.lastError}</small>
                      </td>
                      <td><StatusBadge value={job.status} /></td>
                      <td>
                        <Button
                          size="sm"
                          variant={job.retry?.canRetry ? "outline-dark" : "outline-secondary"}
                          disabled={Boolean(busy) || !job.retry?.canRetry}
                          onClick={() => runAction(job.id, () => retryFailedJob(job.id, { force: true }), "Failed job retry triggered.")}
                        >
                          {job.retry?.label || "Manual review"}
                        </Button>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan={3} className="text-center text-muted py-4">No failed jobs match this filter.</td></tr>
                  )}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default AdminOpsControlPage;
