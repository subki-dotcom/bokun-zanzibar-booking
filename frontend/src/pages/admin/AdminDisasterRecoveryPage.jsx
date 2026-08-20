import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { BsArrowClockwise, BsArchive, BsClipboard2Check, BsDatabaseCheck, BsShieldCheck } from "react-icons/bs";
import {
  createDisasterRecoveryBackupPlan,
  createDisasterRecoveryRestorePlan,
  fetchDisasterRecoveryHistory,
  fetchDisasterRecoverySummary
} from "../../api/adminApi";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";

const statusVariant = (status = "") => ({
  WITHIN_RPO: "success",
  NO_COMPLETED_BACKUP: "warning",
  RPO_BREACHED: "danger",
  COMPLETED: "success",
  DRY_RUN: "info",
  PLANNED: "primary",
  BLOCKED: "warning",
  FAILED: "danger",
  RUNNING: "primary"
})[status] || "secondary";

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

const OperationCard = ({ title, operation }) => (
  <Card className="surface-card h-100">
    <Card.Body>
      <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
        <div>
          <h5 className="mb-1">{title}</h5>
          <small className="text-muted">{operation?.operationReference || "No record"}</small>
        </div>
        <Badge bg={statusVariant(operation?.status)}>{formatStatus(operation?.status)}</Badge>
      </div>
      <Row className="g-3">
        <Col sm={6}>
          <small className="text-muted d-block">Database</small>
          <strong>{operation?.databaseName || "-"}</strong>
        </Col>
        <Col sm={6}>
          <small className="text-muted d-block">Archive</small>
          <strong className="text-break">{operation?.archivePath || "-"}</strong>
        </Col>
        <Col sm={6}>
          <small className="text-muted d-block">Requested</small>
          <strong>{formatDate(operation?.requestedAt)}</strong>
        </Col>
        <Col sm={6}>
          <small className="text-muted d-block">Completed</small>
          <strong>{formatDate(operation?.completedAt)}</strong>
        </Col>
      </Row>
    </Card.Body>
  </Card>
);

const PolicyCard = ({ summary }) => (
  <Card className="surface-card h-100">
    <Card.Body>
      <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
        <div>
          <h5 className="mb-1">Backup Policy</h5>
          <small className="text-muted">{summary?.databaseName || "-"} · {summary?.environment || "-"}</small>
        </div>
        <span className="admin-platform-brand-mark d-inline-flex align-items-center justify-content-center">
          <BsDatabaseCheck aria-hidden="true" />
        </span>
      </div>
      <Row className="g-3">
        <Col sm={6}>
          <small className="text-muted d-block">Storage</small>
          <strong>{summary?.backupPolicy?.storageProvider || "-"}</strong>
        </Col>
        <Col sm={6}>
          <small className="text-muted d-block">Directory</small>
          <strong className="text-break">{summary?.backupPolicy?.backupDirectory || "-"}</strong>
        </Col>
        <Col sm={4}>
          <small className="text-muted d-block">Retention</small>
          <strong>{summary?.backupPolicy?.retentionDays || 0} days</strong>
        </Col>
        <Col sm={4}>
          <small className="text-muted d-block">RPO</small>
          <strong>{summary?.backupPolicy?.rpoHours || 0}h</strong>
        </Col>
        <Col sm={4}>
          <small className="text-muted d-block">RTO</small>
          <strong>{summary?.backupPolicy?.rtoHours || 0}h</strong>
        </Col>
      </Row>
    </Card.Body>
  </Card>
);

const AdminDisasterRecoveryPage = () => {
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [restoreForm, setRestoreForm] = useState({
    archivePath: "",
    targetUri: "",
    confirmRestore: false,
    dropExisting: false
  });

  const load = async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const [nextSummary, nextHistory] = await Promise.all([
        fetchDisasterRecoverySummary(),
        fetchDisasterRecoveryHistory({ limit: 25 })
      ]);
      setSummary(nextSummary);
      setHistory(nextHistory.items || []);
    } catch (err) {
      setError(err.message || "Failed to load disaster recovery data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const blockedSafeguards = useMemo(() => {
    const safeguards = summary?.safeguards || {};
    return [
      ["HTTP restore execution", safeguards.restoreExecutionInApi === false ? "Blocked" : "Review"],
      ["Production restore override", safeguards.productionRestoreRequiresExplicitOverride ? "Required" : "Review"],
      ["URI redaction", safeguards.uriRedactionEnabled ? "Enabled" : "Review"],
      ["Dry-run first", safeguards.dryRunFirst ? "Enabled" : "Review"]
    ];
  }, [summary]);

  const createBackupPlan = async () => {
    setPlanning(true);
    setError("");
    setNotice("");
    try {
      const result = await createDisasterRecoveryBackupPlan({
        label: "admin-dashboard",
        reason: "Admin disaster recovery readiness review"
      });
      setNotice(`Backup ${formatStatus(result.operation?.status)} plan created: ${result.operation?.operationReference}`);
      await load({ silent: true });
    } catch (err) {
      setError(err.message || "Failed to create backup plan");
    } finally {
      setPlanning(false);
    }
  };

  const createRestorePlan = async (event) => {
    event.preventDefault();
    setPlanning(true);
    setError("");
    setNotice("");
    try {
      const result = await createDisasterRecoveryRestorePlan({
        ...restoreForm,
        reason: "Admin disaster recovery restore readiness review"
      });
      const missing = result.missingRequirements?.map((item) => item.code).join(", ");
      setNotice(missing
        ? `Restore plan blocked: ${missing}`
        : `Restore ${formatStatus(result.operation?.status)} plan created: ${result.operation?.operationReference}`);
      await load({ silent: true });
    } catch (err) {
      setError(err.message || "Failed to create restore plan");
    } finally {
      setPlanning(false);
    }
  };

  if (loading) return <Loader message="Loading disaster recovery..." />;

  return (
    <div className="admin-disaster-recovery-page">
      <div className="admin-platform-page-header">
        <div>
          <span className="admin-platform-eyebrow">Production Readiness</span>
          <h2>Disaster Recovery</h2>
          <p>Backup policy, restore planning, RPO state, and immutable audit history for MongoDB recovery operations.</p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <Button variant="outline-secondary" onClick={() => load({ silent: true })} disabled={refreshing || planning}>
            <BsArrowClockwise /> {refreshing ? "Refreshing" : "Refresh"}
          </Button>
          <Button className="premium-btn text-white" onClick={createBackupPlan} disabled={planning}>
            <BsArchive /> Create backup dry-run
          </Button>
        </div>
      </div>

      <ErrorAlert error={error} />
      {notice ? <Alert variant="info">{notice}</Alert> : null}

      <Row className="g-3">
        <Col md={6} xl={3}>
          <Card className="surface-card h-100">
            <Card.Body>
              <small className="text-muted d-block">RPO Status</small>
              <div className="d-flex justify-content-between align-items-center gap-3 mt-2">
                <strong className="fs-5">{formatStatus(summary?.rpoStatus)}</strong>
                <Badge bg={statusVariant(summary?.rpoStatus)}>{summary?.rpoStatus || "-"}</Badge>
              </div>
            </Card.Body>
          </Card>
        </Col>
        <Col md={6} xl={3}>
          <Card className="surface-card h-100">
            <Card.Body>
              <small className="text-muted d-block">Backup Plans</small>
              <strong className="fs-4">{summary?.counts?.backupOperations || 0}</strong>
            </Card.Body>
          </Card>
        </Col>
        <Col md={6} xl={3}>
          <Card className="surface-card h-100">
            <Card.Body>
              <small className="text-muted d-block">Restore Plans</small>
              <strong className="fs-4">{summary?.counts?.restoreOperations || 0}</strong>
            </Card.Body>
          </Card>
        </Col>
        <Col md={6} xl={3}>
          <Card className="surface-card h-100">
            <Card.Body>
              <small className="text-muted d-block">HTTP Restore Execution</small>
              <strong className="fs-5">Blocked</strong>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-4 mt-1">
        <Col xl={6}>
          <PolicyCard summary={summary} />
        </Col>
        <Col xl={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
                <div>
                  <h5 className="mb-1">Safeguards</h5>
                  <small className="text-muted">Restore execution remains outside the admin HTTP API.</small>
                </div>
                <span className="admin-platform-brand-mark d-inline-flex align-items-center justify-content-center">
                  <BsShieldCheck aria-hidden="true" />
                </span>
              </div>
              <div className="d-grid gap-2">
                {blockedSafeguards.map(([label, value]) => (
                  <div key={label} className="d-flex justify-content-between gap-3 border rounded-3 p-2">
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-4 mt-1">
        <Col xl={6}>
          <OperationCard title="Latest Completed Backup" operation={summary?.latestCompletedBackup} />
        </Col>
        <Col xl={6}>
          <OperationCard title="Latest Restore Plan" operation={summary?.latestRestorePlan} />
        </Col>
      </Row>

      <Row className="g-4 mt-1">
        <Col xl={5}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h5 className="mb-3">Restore Plan</h5>
              <Form onSubmit={createRestorePlan} className="d-grid gap-3">
                <Form.Group controlId="restoreArchivePath">
                  <Form.Label>Archive path</Form.Label>
                  <Form.Control
                    value={restoreForm.archivePath}
                    onChange={(event) => setRestoreForm((current) => ({ ...current, archivePath: event.target.value }))}
                    placeholder="backups/mongodb/database-20260820091011.archive.gz"
                  />
                </Form.Group>
                <Form.Group controlId="restoreTargetUri">
                  <Form.Label>Target MongoDB URI</Form.Label>
                  <Form.Control
                    type="password"
                    autoComplete="off"
                    value={restoreForm.targetUri}
                    onChange={(event) => setRestoreForm((current) => ({ ...current, targetUri: event.target.value }))}
                    placeholder="mongodb://user:password@host:27017/staging"
                  />
                </Form.Group>
                <Form.Check
                  id="confirmRestore"
                  checked={restoreForm.confirmRestore}
                  onChange={(event) => setRestoreForm((current) => ({ ...current, confirmRestore: event.target.checked }))}
                  label="Operator confirmation recorded"
                />
                <Form.Check
                  id="dropExisting"
                  checked={restoreForm.dropExisting}
                  onChange={(event) => setRestoreForm((current) => ({ ...current, dropExisting: event.target.checked }))}
                  label="Plan includes drop existing"
                />
                <Button type="submit" variant="outline-dark" disabled={planning}>
                  <BsClipboard2Check /> Create restore dry-run
                </Button>
              </Form>
            </Card.Body>
          </Card>
        </Col>
        <Col xl={7}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h5 className="mb-3">Backup & Restore History</h5>
              <Table responsive hover className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Requested</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length ? history.map((item) => (
                    <tr key={item.id || item.operationReference}>
                      <td className="text-break">{item.operationReference}</td>
                      <td>{item.type}</td>
                      <td><Badge bg={statusVariant(item.status)}>{formatStatus(item.status)}</Badge></td>
                      <td>{formatDate(item.requestedAt)}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={4} className="text-center text-muted py-4">No backup or restore plans recorded.</td>
                    </tr>
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

export default AdminDisasterRecoveryPage;
