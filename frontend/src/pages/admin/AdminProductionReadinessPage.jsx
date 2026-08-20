import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Col, Row, Table } from "react-bootstrap";
import { BsArrowClockwise, BsCheckCircle, BsExclamationTriangle, BsShieldCheck, BsXCircle } from "react-icons/bs";
import { fetchProductionReadinessSummary } from "../../api/adminApi";
import {
  AdminMetricCard,
  StatusBadge,
  formatDateTime,
  formatStatusLabel,
  statusVariant
} from "../../components/admin/AdminDataWidgets";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";

const statusIcon = (status = "") => {
  if (status === "fail" || status === "blocked") return BsXCircle;
  if (status === "warn" || status === "review_required") return BsExclamationTriangle;
  return BsCheckCircle;
};

const evidencePreview = (evidence = {}) => {
  const entries = Object.entries(evidence || {}).slice(0, 4);
  if (!entries.length) return ["-"];
  return entries.map(([key, value]) => {
    const text = Array.isArray(value)
      ? value.join(", ")
      : value && typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
    return `${formatStatusLabel(key)}: ${text || "-"}`;
  });
};

const GatePanel = ({ summary }) => {
  const blocked = summary?.releaseGate?.blocked;
  const requiresReview = summary?.releaseGate?.requiresReview;
  const variant = blocked ? "danger" : requiresReview ? "warning" : "success";

  return (
    <Alert variant={variant} className="border">
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-3">
        <div>
          <strong className="d-block text-capitalize">{formatStatusLabel(summary?.status)}</strong>
          <span>{summary?.releaseGate?.rule || "Release gate evidence is unavailable."}</span>
        </div>
        <StatusBadge value={summary?.status} />
      </div>
    </Alert>
  );
};

const AdminProductionReadinessPage = () => {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const data = await fetchProductionReadinessSummary();
      setSummary(data);
    } catch (err) {
      setError(err.message || "Failed to load production readiness");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const checksByCategory = useMemo(() => {
    const groups = new Map();
    (summary?.checks || []).forEach((check) => {
      const category = check.category || "readiness";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(check);
    });
    return Array.from(groups.entries());
  }, [summary]);

  if (loading) return <Loader message="Loading production readiness..." />;

  return (
    <div className="admin-production-readiness-page">
      <div className="admin-platform-page-header">
        <div>
          <span className="admin-platform-eyebrow">Production Readiness</span>
          <h2>Release Verification</h2>
          <p>Read-only release gate for health, backups, reports, data quality, audit, RBAC, workers, and performance evidence.</p>
        </div>
        <Button variant="outline-secondary" onClick={() => load({ silent: true })} disabled={refreshing}>
          <BsArrowClockwise /> {refreshing ? "Refreshing" : "Refresh"}
        </Button>
      </div>

      <ErrorAlert error={error} />
      <GatePanel summary={summary} />

      <Row className="g-3">
        <Col md={6} xl={3}>
          <AdminMetricCard
            label="Release Status"
            value={formatStatusLabel(summary?.status)}
            detail={`Generated ${formatDateTime(summary?.generatedAt)}`}
            icon={statusIcon(summary?.status)}
            status={summary?.status}
          />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard label="Passing Checks" value={summary?.counts?.pass || 0} detail={`${summary?.counts?.total || 0} total`} icon={BsCheckCircle} status="pass" />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard label="Warnings" value={summary?.counts?.warn || 0} detail="Review before release" icon={BsExclamationTriangle} status={(summary?.counts?.warn || 0) ? "warn" : "pass"} />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard label="Failures" value={summary?.counts?.fail || 0} detail="Blocks release" icon={BsXCircle} status={(summary?.counts?.fail || 0) ? "fail" : "pass"} />
        </Col>
      </Row>

      <Row className="g-4 mt-1">
        <Col xl={8}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h5 className="mb-3">Readiness Checklist</h5>
              <div className="d-grid gap-3">
                {checksByCategory.map(([category, checks]) => (
                  <div key={category}>
                    <div className="d-flex align-items-center justify-content-between mb-2">
                      <strong className="text-capitalize">{formatStatusLabel(category)}</strong>
                      <span className="text-muted small">{checks.length} checks</span>
                    </div>
                    <Table responsive hover className="align-middle mb-0">
                      <thead>
                        <tr>
                          <th>Check</th>
                          <th>Status</th>
                          <th>Evidence</th>
                          <th>Next Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {checks.map((check) => (
                          <tr key={check.id}>
                            <td>
                              <strong className="d-block">{check.label}</strong>
                              <small className="text-muted">{check.message}</small>
                            </td>
                            <td><StatusBadge value={check.status} /></td>
                            <td>
                              {evidencePreview(check.evidence).map((line) => (
                                <small key={line} className="d-block text-muted">{line}</small>
                              ))}
                            </td>
                            <td>{check.nextAction || <span className="text-muted">-</span>}</td>
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
        <Col xl={4}>
          <Card className="surface-card h-100">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
                <div>
                  <h5 className="mb-1">Next Actions</h5>
                  <small className="text-muted">Only warnings and failures are listed.</small>
                </div>
                <span className="admin-platform-brand-mark d-inline-flex align-items-center justify-content-center">
                  <BsShieldCheck aria-hidden="true" />
                </span>
              </div>
              <div className="d-grid gap-2">
                {(summary?.nextActions || []).map((item) => (
                  <Alert key={item.checkId} variant={statusVariant(item.status)} className="mb-0 border">
                    <strong className="d-block">{item.label}</strong>
                    <span>{item.nextAction}</span>
                  </Alert>
                ))}
                {summary?.nextActions?.length ? null : <span className="text-muted">No blocking release actions are currently listed.</span>}
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-4 mt-1">
        <Col xl={5}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h5 className="mb-3">Source Evidence</h5>
              <div className="d-grid gap-2">
                {Object.entries(summary?.sourceEvidence || {}).map(([key, value]) => (
                  <div key={key} className="d-flex justify-content-between gap-3 border rounded-3 p-2">
                    <span>{formatStatusLabel(key)}</span>
                    <strong>{String(value || "-")}</strong>
                  </div>
                ))}
              </div>
            </Card.Body>
          </Card>
        </Col>
        <Col xl={7}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h5 className="mb-3">Release Invariants</h5>
              <div className="d-grid gap-2">
                {(summary?.invariants || []).map((item) => (
                  <div key={item} className="d-flex gap-2 align-items-start border rounded-3 p-2">
                    <BsCheckCircle className="text-success mt-1" aria-hidden="true" />
                    <span>{item}</span>
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

export default AdminProductionReadinessPage;
