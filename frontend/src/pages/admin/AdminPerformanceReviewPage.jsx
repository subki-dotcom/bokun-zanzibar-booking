import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { BsArrowClockwise, BsDatabaseCheck, BsGraphUpArrow, BsShieldCheck } from "react-icons/bs";
import {
  fetchPerformanceIndexCoverage,
  fetchPerformanceIndexInventory,
  fetchPerformanceReviewSummary
} from "../../api/adminApi";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";

const STATUS_OPTIONS = ["", "covered", "recommended", "review_required"];
const PRIORITY_OPTIONS = ["", "critical", "high", "medium", "low"];

const statusVariant = (status = "") => ({
  covered: "success",
  recommended: "warning",
  review_required: "secondary",
  critical_review_required: "danger"
})[status] || "secondary";

const priorityVariant = (priority = "") => ({
  critical: "danger",
  high: "warning",
  medium: "info",
  low: "secondary"
})[priority] || "secondary";

const formatLabel = (value = "") => String(value || "-").replaceAll("_", " ");

const formatIndex = (spec = {}) =>
  Object.entries(spec || {})
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ") || "-";

const KpiCard = ({ label, value, detail, icon: Icon = BsGraphUpArrow, status = "covered" }) => (
  <Card className="surface-card h-100">
    <Card.Body>
      <div className="d-flex justify-content-between align-items-start gap-3">
        <div>
          <small className="text-muted d-block">{label}</small>
          <strong className="fs-4 d-block">{value}</strong>
          {detail ? <span className="text-muted small">{detail}</span> : null}
        </div>
        <span className="admin-platform-brand-mark d-inline-flex align-items-center justify-content-center">
          <Icon aria-hidden="true" />
        </span>
      </div>
      <Badge bg={statusVariant(status)} className="mt-3 text-capitalize">{formatLabel(status)}</Badge>
    </Card.Body>
  </Card>
);

const AdminPerformanceReviewPage = () => {
  const [summary, setSummary] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [filters, setFilters] = useState({ priority: "", status: "" });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = async ({ silent = false, nextFilters = filters } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const [nextSummary, nextCoverage, nextInventory] = await Promise.all([
        fetchPerformanceReviewSummary(),
        fetchPerformanceIndexCoverage(nextFilters),
        fetchPerformanceIndexInventory()
      ]);
      setSummary(nextSummary);
      setCoverage(nextCoverage);
      setInventory(nextInventory);
    } catch (err) {
      setError(err.message || "Failed to load performance review");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const modelsWithIndexes = useMemo(
    () => (inventory?.models || []).filter((model) => model.indexes?.length).length,
    [inventory]
  );

  const onFilterChange = (key, value) => {
    const nextFilters = { ...filters, [key]: value };
    setFilters(nextFilters);
    load({ silent: true, nextFilters });
  };

  if (loading) return <Loader message="Loading performance review..." />;

  return (
    <div className="admin-performance-review-page">
      <div className="admin-platform-page-header">
        <div>
          <span className="admin-platform-eyebrow">Production Readiness</span>
          <h2>Performance Review</h2>
          <p>Query-pattern coverage, declared Mongo indexes, and migration-safe review guidance for admin reporting.</p>
        </div>
        <Button variant="outline-secondary" onClick={() => load({ silent: true })} disabled={refreshing}>
          <BsArrowClockwise /> {refreshing ? "Refreshing" : "Refresh"}
        </Button>
      </div>

      <ErrorAlert error={error} />

      <Row className="g-3">
        <Col md={6} xl={3}>
          <KpiCard
            label="Index Coverage"
            value={`${summary?.coveragePercent || 0}%`}
            detail={`${summary?.counts?.covered || 0} of ${summary?.counts?.total || 0} patterns covered`}
            status={summary?.status}
          />
        </Col>
        <Col md={6} xl={3}>
          <KpiCard
            label="Review Needed"
            value={summary?.counts?.migrationRequired || 0}
            detail="Requires reviewed migration, not automatic writes"
            icon={BsShieldCheck}
            status={summary?.counts?.migrationRequired ? "recommended" : "covered"}
          />
        </Col>
        <Col md={6} xl={3}>
          <KpiCard
            label="Critical Missing"
            value={summary?.criticalMissing?.length || 0}
            detail="Critical paths should stay covered"
            icon={BsGraphUpArrow}
            status={summary?.criticalMissing?.length ? "critical_review_required" : "covered"}
          />
        </Col>
        <Col md={6} xl={3}>
          <KpiCard
            label="Models Inventoried"
            value={modelsWithIndexes}
            detail={`${inventory?.count || 0} models inspected`}
            icon={BsDatabaseCheck}
            status="covered"
          />
        </Col>
      </Row>

      <Row className="g-4 mt-1">
        <Col xl={8}>
          <Card className="surface-card h-100">
            <Card.Body>
              <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-3">
                <div>
                  <h5 className="mb-1">Query Pattern Coverage</h5>
                  <small className="text-muted">Compared against declared Mongoose schema indexes.</small>
                </div>
                <div className="d-flex flex-wrap gap-2">
                  <Form.Select
                    size="sm"
                    value={filters.priority}
                    onChange={(event) => onFilterChange("priority", event.target.value)}
                    aria-label="Priority filter"
                  >
                    {PRIORITY_OPTIONS.map((option) => (
                      <option key={option || "all"} value={option}>{option ? formatLabel(option) : "All priorities"}</option>
                    ))}
                  </Form.Select>
                  <Form.Select
                    size="sm"
                    value={filters.status}
                    onChange={(event) => onFilterChange("status", event.target.value)}
                    aria-label="Status filter"
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option || "all"} value={option}>{option ? formatLabel(option) : "All statuses"}</option>
                    ))}
                  </Form.Select>
                </div>
              </div>
              <Table responsive hover className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Pattern</th>
                    <th>Model</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Required Index</th>
                  </tr>
                </thead>
                <tbody>
                  {(coverage?.items || []).map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong className="d-block">{formatLabel(item.id)}</strong>
                        <small className="text-muted">{item.evidence}</small>
                      </td>
                      <td>{item.model}</td>
                      <td><Badge bg={priorityVariant(item.priority)}>{formatLabel(item.priority)}</Badge></td>
                      <td><Badge bg={statusVariant(item.status)}>{formatLabel(item.status)}</Badge></td>
                      <td><code className="small">{formatIndex(item.requiredIndex)}</code></td>
                    </tr>
                  ))}
                  {coverage?.items?.length ? null : (
                    <tr>
                      <td colSpan={5} className="text-center text-muted py-4">No patterns match these filters.</td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
        <Col xl={4}>
          <Card className="surface-card h-100">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
                <div>
                  <h5 className="mb-1">Safeguards</h5>
                  <small className="text-muted">This page reviews production readiness without mutating indexes.</small>
                </div>
                <span className="admin-platform-brand-mark d-inline-flex align-items-center justify-content-center">
                  <BsShieldCheck aria-hidden="true" />
                </span>
              </div>
              <div className="d-grid gap-2">
                {(summary?.safeguards || []).map((item) => (
                  <Alert key={item} variant="light" className="border mb-0">{item}</Alert>
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
              <h5 className="mb-3">Next Migration Actions</h5>
              <Table responsive hover className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Area</th>
                    <th>Priority</th>
                    <th>Index</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary?.nextActions || []).map((item) => (
                    <tr key={item.id}>
                      <td>{item.model}</td>
                      <td>{formatLabel(item.area)}</td>
                      <td><Badge bg={priorityVariant(item.priority)}>{formatLabel(item.priority)}</Badge></td>
                      <td><code className="small">{formatIndex(item.requiredIndex)}</code></td>
                    </tr>
                  ))}
                  {summary?.nextActions?.length ? null : (
                    <tr>
                      <td colSpan={4} className="text-center text-muted py-4">No reviewed index migrations are currently recommended.</td>
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

export default AdminPerformanceReviewPage;
