import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { BsArrowClockwise, BsDownload, BsFileEarmarkBarGraph } from "react-icons/bs";
import {
  exportReportCenterReport,
  fetchReportCenterCatalog,
  fetchReportExportHistory,
  runReportCenterReport
} from "../../api/adminApi";
import { AdminMetricCard, StatusBadge, formatDateTime } from "../../components/admin/AdminDataWidgets";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";
import { formatCurrency } from "../../utils/formatters";

const sourceFromRow = (source = "") => {
  const prefixes = ["rows.", "items.", "products.", "channels.", "trends.combined."];
  const matched = prefixes.find((prefix) => source.startsWith(prefix));
  return matched ? source.slice(matched.length) : source;
};

const getPath = (source = {}, path = "") =>
  String(path || "").split(".").filter(Boolean).reduce((current, key) => {
    if (current === null || current === undefined) return undefined;
    return current[key];
  }, source);

const inferRows = (data = {}) => {
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.products)) return data.products;
  if (Array.isArray(data.channels)) return data.channels;
  if (Array.isArray(data.trends?.combined)) return data.trends.combined;
  const summary = {
    ...(data.totals || {}),
    ...(data.managementSummary || {}),
    ...(data.breakdown || {}),
    ...(data.answers || {})
  };
  return Object.keys(summary).length ? [summary] : [];
};

const displayValue = ({ value, type }) => {
  const actual = value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value")
    ? value.value
    : value;
  if (actual === null || actual === undefined || actual === "") return "-";
  if (type === "money") return formatCurrency(actual, "USD");
  if (type === "percent") return `${Number(actual || 0).toFixed(1)}%`;
  if (type === "date") return formatDateTime(actual);
  if (typeof actual === "object") return JSON.stringify(actual);
  return String(actual);
};

const resolveCell = ({ column, row, data }) => {
  const source = column.source || column.key;
  const rowValue = getPath(row, sourceFromRow(source));
  if (rowValue !== undefined) return rowValue;
  const dataValue = getPath(data, source);
  if (dataValue !== undefined) return dataValue;
  return row?.[column.key];
};

const AdminReportCenterPage = () => {
  const [catalog, setCatalog] = useState(null);
  const [selectedType, setSelectedType] = useState("");
  const [group, setGroup] = useState("");
  const [period, setPeriod] = useState("THIS_MONTH");
  const [format, setFormat] = useState("CSV");
  const [reportResult, setReportResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const reports = useMemo(() => (catalog?.reports || []).filter((report) => report.availability === "AVAILABLE"), [catalog]);
  const filteredReports = useMemo(
    () => reports.filter((report) => !group || report.group === group),
    [reports, group]
  );
  const selectedReport = reports.find((report) => report.type === selectedType) || null;
  const rows = inferRows(reportResult?.data || {});
  const columns = selectedReport?.columns?.length
    ? selectedReport.columns
    : Object.keys(rows[0] || {}).map((key) => ({ key, label: key, source: key }));

  const runSelected = async ({ nextType = selectedType } = {}) => {
    if (!nextType) return;
    setRunning(true);
    setError("");
    try {
      const result = await runReportCenterReport(nextType, { period });
      const exportHistory = await fetchReportExportHistory({ limit: 10 });
      setReportResult(result);
      setHistory(exportHistory.items || []);
    } catch (err) {
      setError(err.message || "Failed to run report");
    } finally {
      setRunning(false);
    }
  };

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const nextCatalog = await fetchReportCenterCatalog();
      const nextReports = (nextCatalog.reports || []).filter((report) => report.availability === "AVAILABLE");
      const firstType = nextReports[0]?.type || "";
      setCatalog(nextCatalog);
      setSelectedType(firstType);
      const [result, exportHistory] = await Promise.all([
        firstType ? runReportCenterReport(firstType, { period }) : Promise.resolve(null),
        fetchReportExportHistory({ limit: 10 })
      ]);
      setReportResult(result);
      setHistory(exportHistory.items || []);
    } catch (err) {
      setError(err.message || "Failed to load report center");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectReport = (value) => {
    setSelectedType(value);
    runSelected({ nextType: value });
  };

  const download = async () => {
    if (!selectedType) return;
    setRunning(true);
    setError("");
    try {
      const { blob, filename } = await exportReportCenterReport(selectedType, { period, format });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      const exportHistory = await fetchReportExportHistory({ limit: 10 });
      setHistory(exportHistory.items || []);
    } catch (err) {
      setError(err.message || "Failed to export report");
    } finally {
      setRunning(false);
    }
  };

  if (loading) return <Loader message="Loading report center..." />;

  return (
    <div className="admin-report-center-page">
      <div className="admin-platform-page-header">
        <div>
          <span className="admin-platform-eyebrow">Report Center</span>
          <h2>Report Center</h2>
          <p>Canonical management reports, shared filters, export history, and source-of-truth disclosures.</p>
        </div>
        <Button variant="outline-secondary" onClick={load} disabled={running}>
          <BsArrowClockwise /> Refresh
        </Button>
      </div>

      <ErrorAlert error={error} />

      <Row className="g-3">
        <Col md={4}>
          <AdminMetricCard label="Available Reports" value={reports.length} detail={`${catalog?.groups?.length || 0} report groups`} icon={BsFileEarmarkBarGraph} />
        </Col>
        <Col md={4}>
          <AdminMetricCard label="Current Rows" value={rows.length} detail={selectedReport?.title || "No report selected"} icon={BsFileEarmarkBarGraph} />
        </Col>
        <Col md={4}>
          <AdminMetricCard label="Export History" value={history.length} detail="Response-only export records" icon={BsDownload} />
        </Col>
      </Row>

      <Row className="g-4 mt-1">
        <Col xl={3}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h5 className="mb-3">Reports</h5>
              <Form.Group className="mb-3">
                <Form.Label>Group</Form.Label>
                <Form.Select value={group} onChange={(event) => setGroup(event.target.value)}>
                  <option value="">All groups</option>
                  {(catalog?.groups || []).map((item) => (
                    <option key={item.key} value={item.key}>{item.label}</option>
                  ))}
                </Form.Select>
              </Form.Group>
              <div className="d-grid gap-2">
                {filteredReports.map((report) => (
                  <Button
                    key={report.type}
                    variant={report.type === selectedType ? "dark" : "outline-secondary"}
                    className="text-start"
                    onClick={() => selectReport(report.type)}
                    disabled={running}
                  >
                    {report.title}
                  </Button>
                ))}
              </div>
            </Card.Body>
          </Card>
        </Col>
        <Col xl={9}>
          <Card className="surface-card">
            <Card.Body>
              <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
                <div>
                  <h5 className="mb-1">{selectedReport?.title || "Report"}</h5>
                  <small className="text-muted">{selectedReport?.description}</small>
                </div>
                <div className="d-flex flex-wrap gap-2">
                  <Form.Select value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Report period">
                    {(catalog?.filterOptions?.periods || []).map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
                  </Form.Select>
                  <Button variant="outline-dark" onClick={() => runSelected()} disabled={running || !selectedType}>
                    Run
                  </Button>
                  <Form.Select value={format} onChange={(event) => setFormat(event.target.value)} aria-label="Export format">
                    {(selectedReport?.supportedExports || catalog?.filterOptions?.exportFormats || ["CSV"]).map((item) => <option key={item} value={item}>{item}</option>)}
                  </Form.Select>
                  <Button className="premium-btn text-white" onClick={download} disabled={running || !selectedType}>
                    <BsDownload /> Export
                  </Button>
                </div>
              </div>

              {reportResult?.dataQuality?.warnings?.length ? (
                <Alert variant="warning">
                  {reportResult.dataQuality.warnings.length} data quality warning(s) affect this report.
                </Alert>
              ) : null}

              <Table responsive hover className="align-middle mb-0">
                <thead>
                  <tr>
                    {columns.slice(0, 8).map((column) => <th key={column.key}>{column.label || column.key}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.length ? rows.slice(0, 25).map((row, index) => (
                    <tr key={row.id || row.reference || row.productId || row.channel || index}>
                      {columns.slice(0, 8).map((column) => (
                        <td key={column.key}>{displayValue({ value: resolveCell({ column, row, data: reportResult?.data || {} }), type: column.type })}</td>
                      ))}
                    </tr>
                  )) : (
                    <tr><td colSpan={Math.max(columns.length, 1)} className="text-center text-muted py-4">No rows returned for this report and period.</td></tr>
                  )}
                </tbody>
              </Table>
            </Card.Body>
          </Card>

          <Card className="surface-card mt-4">
            <Card.Body>
              <h5 className="mb-3">Export History</h5>
              <Table responsive hover className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Report</th>
                    <th>Format</th>
                    <th>Status</th>
                    <th>Generated</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length ? history.map((item) => (
                    <tr key={item.id || `${item.reportType}-${item.generatedAt}`}>
                      <td>{item.reportType}</td>
                      <td>{item.format}</td>
                      <td><StatusBadge value={item.status} /></td>
                      <td>{formatDateTime(item.generatedAt)}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={4} className="text-center text-muted py-4">No exports recorded yet.</td></tr>
                  )}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-4 mt-1">
        <Col>
          <Card className="surface-card">
            <Card.Body>
              <h5 className="mb-3">Source Integrity</h5>
              <div className="d-flex flex-wrap gap-2">
                <Badge bg="success">Canonical services</Badge>
                <Badge bg="success">Exports use same query</Badge>
                <Badge bg="success">No raw database query builder</Badge>
                <Badge bg="secondary">No statutory reports claimed</Badge>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default AdminReportCenterPage;
