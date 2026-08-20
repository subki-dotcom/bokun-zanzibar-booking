import { useEffect, useState } from "react";
import { Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { BsArrowClockwise, BsJournalCheck, BsShieldCheck } from "react-icons/bs";
import {
  fetchAuditControlSummary,
  fetchAuditLogs,
  fetchFinancialChanges
} from "../../api/adminApi";
import { AdminMetricCard, formatDateTime } from "../../components/admin/AdminDataWidgets";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";

const actorLabel = (actor = {}) => [actor.role, actor.id].filter(Boolean).join(" / ") || "system";

const changedFields = (item = {}) =>
  (item.changeSummary?.changedFields || []).map((field) => field.field).join(", ") || "-";

const AdminAuditControlPage = () => {
  const [summary, setSummary] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [financialChanges, setFinancialChanges] = useState([]);
  const [reference, setReference] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const filters = reference.trim() ? { reference: reference.trim() } : {};
      const [nextSummary, nextLogs, nextFinancial] = await Promise.all([
        fetchAuditControlSummary(),
        fetchAuditLogs({ ...filters, limit: 25 }),
        fetchFinancialChanges({ ...filters, limit: 25 })
      ]);
      setSummary(nextSummary);
      setAuditLogs(nextLogs.items || []);
      setFinancialChanges(nextFinancial.items || []);
    } catch (err) {
      setError(err.message || "Failed to load audit control");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <Loader message="Loading audit control..." />;

  return (
    <div className="admin-audit-control-page">
      <div className="admin-platform-page-header">
        <div>
          <span className="admin-platform-eyebrow">Audit & Control</span>
          <h2>Audit & Control</h2>
          <p>Immutable audit logs, financial change evidence, and sanitized traceability for admin actions.</p>
        </div>
        <Button variant="outline-secondary" onClick={() => load({ silent: true })} disabled={refreshing}>
          <BsArrowClockwise /> {refreshing ? "Refreshing" : "Refresh"}
        </Button>
      </div>

      <ErrorAlert error={error} />

      <Row className="g-3">
        <Col md={4}>
          <AdminMetricCard label="Audit Events" value={summary?.totalAuditEvents || 0} detail="Immutable records" icon={BsJournalCheck} />
        </Col>
        <Col md={4}>
          <AdminMetricCard label="Financial Changes" value={summary?.totalFinancialChanges || 0} detail="Money-affecting audit evidence" icon={BsShieldCheck} />
        </Col>
        <Col md={4}>
          <AdminMetricCard label="Latest Financial Change" value={summary?.latestFinancialChangeAt ? formatDateTime(summary.latestFinancialChangeAt) : "-"} detail="Sanitized payloads" icon={BsShieldCheck} />
        </Col>
      </Row>

      <Card className="surface-card mt-4">
        <Card.Body>
          <div className="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-3">
            <div>
              <h5 className="mb-1">Search Evidence</h5>
              <small className="text-muted">Filter by booking, invoice, payment, refund, request, or correlation reference.</small>
            </div>
            <div className="d-flex flex-wrap gap-2">
              <Form.Control
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Reference"
                aria-label="Audit reference"
              />
              <Button variant="outline-dark" onClick={() => load({ silent: true })} disabled={refreshing}>Apply</Button>
            </div>
          </div>
        </Card.Body>
      </Card>

      <Row className="g-4 mt-1">
        <Col xl={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h5 className="mb-3">Financial Changes</h5>
              <Table responsive hover className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Reference</th>
                    <th>Changed</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {financialChanges.length ? financialChanges.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong className="d-block">{item.action}</strong>
                        <small className="text-muted">{actorLabel(item.actor)}</small>
                      </td>
                      <td>{item.reference || item.entity?.id || "-"}</td>
                      <td>{changedFields(item)}</td>
                      <td>{formatDateTime(item.timestamp)}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={4} className="text-center text-muted py-4">No financial change records found.</td></tr>
                  )}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
        <Col xl={6}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h5 className="mb-3">Audit Logs</h5>
              <Table responsive hover className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Actor</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.length ? auditLogs.map((item) => (
                    <tr key={item.id}>
                      <td>{item.action}</td>
                      <td>
                        <strong className="d-block">{item.entity?.type}</strong>
                        <small className="text-muted">{item.reference || item.entity?.id}</small>
                      </td>
                      <td>{actorLabel(item.actor)}</td>
                      <td>{formatDateTime(item.timestamp)}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={4} className="text-center text-muted py-4">No audit logs found.</td></tr>
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

export default AdminAuditControlPage;
