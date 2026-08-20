import { useEffect, useState } from "react";
import { Badge, Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { BsArrowClockwise, BsClipboard2Check, BsExclamationTriangle } from "react-icons/bs";
import { fetchDataQualityIssues, fetchDataQualitySummary } from "../../api/adminApi";
import { AdminMetricCard, StatusBadge } from "../../components/admin/AdminDataWidgets";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";

const AdminDataQualityPage = () => {
  const [summary, setSummary] = useState(null);
  const [issues, setIssues] = useState([]);
  const [severity, setSeverity] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = async ({ silent = false, nextSeverity = severity } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const filters = nextSeverity ? { severity: nextSeverity } : {};
      const [nextSummary, nextIssues] = await Promise.all([
        fetchDataQualitySummary({ limit: 1000 }),
        fetchDataQualityIssues({ ...filters, limit: 1000, issueLimit: 100 })
      ]);
      setSummary(nextSummary);
      setIssues(nextIssues.items || []);
    } catch (err) {
      setError(err.message || "Failed to load data quality");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeSeverity = (value) => {
    setSeverity(value);
    load({ silent: true, nextSeverity: value });
  };

  if (loading) return <Loader message="Loading data quality..." />;

  const totals = summary?.summary || {};

  return (
    <div className="admin-data-quality-page">
      <div className="admin-platform-page-header">
        <div>
          <span className="admin-platform-eyebrow">Control</span>
          <h2>Data Quality</h2>
          <p>Completeness checks for bookings, payments, refunds, invoices, expenses, FX, and reconciliation evidence.</p>
        </div>
        <Button variant="outline-secondary" onClick={() => load({ silent: true })} disabled={refreshing}>
          <BsArrowClockwise /> {refreshing ? "Refreshing" : "Refresh"}
        </Button>
      </div>

      <ErrorAlert error={error} />

      <Row className="g-3">
        <Col md={6} xl={3}>
          <AdminMetricCard label="Completeness" value={`${totals.completenessPercent || 100}%`} detail={`${totals.completeRecords || 0} complete records`} icon={BsClipboard2Check} />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard label="Issue Count" value={totals.issueCount || 0} detail={`${totals.incompleteRecords || 0} incomplete records`} icon={BsExclamationTriangle} status={totals.issueCount ? "WARNING" : "COMPLETED"} />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard label="Critical" value={totals.severityCounts?.CRITICAL || 0} detail="Highest priority records" status={(totals.severityCounts?.CRITICAL || 0) ? "CRITICAL" : "COMPLETED"} />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard label="Scanned Records" value={summary?.scan?.sampledRecords || 0} detail={`Limit ${summary?.scan?.scanLimit || 0}`} />
        </Col>
      </Row>

      <Row className="g-4 mt-1">
        <Col xl={4}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h5 className="mb-3">Top Issues</h5>
              <div className="d-grid gap-2">
                {(summary?.topIssues || []).map((item) => (
                  <div key={item.code} className="d-flex justify-content-between gap-3 border rounded-3 p-2">
                    <span>{item.code.replaceAll("_", " ")}</span>
                    <Badge bg={item.severity === "CRITICAL" ? "danger" : item.severity === "ERROR" ? "warning" : "secondary"}>
                      {item.count}
                    </Badge>
                  </div>
                ))}
                {summary?.topIssues?.length ? null : <span className="text-muted">No data-quality issues detected in this scan.</span>}
              </div>
            </Card.Body>
          </Card>
        </Col>
        <Col xl={8}>
          <Card className="surface-card h-100">
            <Card.Body>
              <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-3">
                <div>
                  <h5 className="mb-1">Issues</h5>
                  <small className="text-muted">Bounded scan results; no historical records are rewritten.</small>
                </div>
                <Form.Select value={severity} onChange={(event) => changeSeverity(event.target.value)} aria-label="Severity filter">
                  <option value="">All severities</option>
                  {(summary?.severityLevels || []).map((item) => <option key={item} value={item}>{item}</option>)}
                </Form.Select>
              </div>
              <Table responsive hover className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Issue</th>
                    <th>Record</th>
                    <th>Severity</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.length ? issues.map((item, index) => (
                    <tr key={`${item.code}-${item.entityType}-${item.entityId}-${index}`}>
                      <td>
                        <strong className="d-block">{item.code.replaceAll("_", " ")}</strong>
                        <small className="text-muted">{item.message}</small>
                      </td>
                      <td>
                        <span className="d-block">{item.entityType}</span>
                        <small className="text-muted">{item.reference || item.entityId}</small>
                      </td>
                      <td><StatusBadge value={item.severity} /></td>
                      <td>{item.recommendedAction || "-"}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={4} className="text-center text-muted py-4">No issues match this filter.</td></tr>
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

export default AdminDataQualityPage;
