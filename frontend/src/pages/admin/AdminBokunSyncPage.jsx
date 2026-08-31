import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { Link, useLocation } from "react-router-dom";
import {
  BsArrowClockwise,
  BsArchive,
  BsCheckCircle,
  BsCloudCheck,
  BsExclamationTriangle,
  BsJournalCheck
} from "react-icons/bs";
import {
  fetchBokunSyncStatus,
  importConfirmedBokunBookings,
  resyncBokunBooking
} from "../../api/adminApi";
import { AdminMetricCard, formatDateTime, StatusBadge } from "../../components/admin/AdminDataWidgets";
import ErrorAlert from "../../components/common/ErrorAlert";
import {
  BOKUN_SYNC_VIEW_CONFIG,
  bokunSyncModeFromPath
} from "./bokunSyncView";

const DATE_RANGE_FIELDS = [
  "lastModifiedDateRange",
  "creationDateRange",
  "startDateRange",
  "cancellationDateRange"
];

const DEFAULT_STATUSES = "CONFIRMED,CANCELLED";

const asArray = (value) => (Array.isArray(value) ? value : []);
const label = (value = "") => String(value || "-").replaceAll("_", " ");

const dataModeLabel = (value = "") => ({
  live: "Live Bokun API",
  mock: "Mock data",
  not_configured: "Not configured"
})[value] || label(value);

const syncStatusMessage = (status = null) => {
  const integration = status?.integration || {};
  const importState = status?.confirmedBookingImport || {};
  const worker = importState.worker || {};

  if (!status) return "Loading Bokun connection status.";
  if (integration.dataMode === "mock") {
    return "Bokun mock mode is enabled. Manual runs will not read supplier data until mock mode is disabled.";
  }
  if (integration.dataMode === "not_configured") {
    return "Bokun live API credentials are missing. Add BOKUN_ACCESS_KEY and BOKUN_SECRET_KEY before importing real bookings.";
  }
  if (!importState.enabled) {
    return "Bokun live API is configured, but scheduled confirmed-booking import is disabled.";
  }
  if (worker.status === "running") {
    return "Bokun live API is configured and scheduled confirmed-booking import is active.";
  }
  return "Bokun live API is configured. Manual dry-run and apply actions will read real Bokun bookings.";
};

const parseStatuses = (value = DEFAULT_STATUSES) =>
  String(value || "")
    .split(",")
    .map((status) => status.trim())
    .filter(Boolean);

const summarizeResult = (result = null) => {
  if (!result) {
    return { processed: 0, imported: 0, amended: 0, updated: 0, cancelled: 0, unchanged: 0, skipped: 0, failed: 0 };
  }
  if (result.summary) return result.summary;
  const action = result.result?.action || "";
  return {
    processed: action ? 1 : 0,
    imported: action === "imported" ? 1 : 0,
    amended: action === "amended" ? 1 : 0,
    updated: action === "updated" ? 1 : 0,
    cancelled: action === "cancelled" ? 1 : 0,
    unchanged: action === "unchanged" ? 1 : 0,
    skipped: action === "skipped" ? 1 : 0,
    failed: action === "failed" ? 1 : 0
  };
};

const resultRows = (result = null) => {
  if (!result) return [];
  if (Array.isArray(result.results)) return result.results;
  return result.result ? [result.result] : [];
};

const ResultTable = ({ result }) => {
  const rows = resultRows(result);

  return (
    <Table responsive hover className="align-middle mb-0">
      <thead>
        <tr>
          <th>Reference</th>
          <th>Bokun ID</th>
          <th>Action</th>
          <th>Status</th>
          <th>Channel</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>
        {rows.length ? rows.map((row, index) => (
          <tr key={`${row.bookingReference || row.lookupReference || row.bokunBookingId || index}`}>
            <td>
              <strong className="d-block">{row.bookingReference || row.lookupReference || "-"}</strong>
              {row.bokunExternalBookingReference ? <small className="text-muted">{row.bokunExternalBookingReference}</small> : null}
            </td>
            <td>{row.bokunBookingId || "-"}</td>
            <td><StatusBadge value={row.action || "unknown"} /></td>
            <td>{label(row.bookingStatus || row.normalizedStatus || row.rawStatus)}</td>
            <td>{label(row.salesChannel)}</td>
            <td>{row.reason || row.message || "-"}</td>
          </tr>
        )) : (
          <tr>
            <td colSpan={6} className="text-center text-muted py-4">No sync result rows yet.</td>
          </tr>
        )}
      </tbody>
    </Table>
  );
};

const AdminBokunSyncPage = () => {
  const location = useLocation();
  const mode = bokunSyncModeFromPath(location.pathname);
  const config = BOKUN_SYNC_VIEW_CONFIG[mode] || BOKUN_SYNC_VIEW_CONFIG["confirmed-import"];
  const [form, setForm] = useState({
    page: 1,
    pageSize: 50,
    maxPages: 1,
    bookingStatuses: DEFAULT_STATUSES,
    dateRangeField: "lastModifiedDateRange",
    fromDate: "",
    toDate: "",
    reference: ""
  });
  const [result, setResult] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const summary = useMemo(() => summarizeResult(result), [result]);
  const isSingle = mode === "single-booking";
  const disabled = Boolean(busy);
  const integration = syncStatus?.integration || {};
  const importState = syncStatus?.confirmedBookingImport || {};
  const worker = importState.worker || {};
  const dataMode = integration.dataMode || "";
  const statusVariant = dataMode === "live" && importState.enabled ? "success" : dataMode === "not_configured" ? "danger" : "warning";

  const loadSyncStatus = async ({ silent = false } = {}) => {
    if (!silent) setStatusLoading(true);
    try {
      const data = await fetchBokunSyncStatus();
      setSyncStatus(data);
    } catch (err) {
      setError(err.message || "Failed to load Bokun sync status");
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    loadSyncStatus();
  }, []);

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const buildBulkPayload = (dryRun) => ({
    dryRun,
    page: Number(form.page || 1),
    pageSize: Number(form.pageSize || 50),
    maxPages: Number(form.maxPages || 1),
    bookingStatuses: parseStatuses(form.bookingStatuses),
    dateRangeField: form.dateRangeField,
    ...(form.fromDate ? { fromDate: form.fromDate } : {}),
    ...(form.toDate ? { toDate: form.toDate } : {})
  });

  const run = async (dryRun = true) => {
    setBusy(dryRun ? "dry-run" : "apply");
    setError("");
    setNotice("");

    try {
      const nextResult = isSingle
        ? await resyncBokunBooking(form.reference.trim(), { dryRun })
        : await importConfirmedBokunBookings(buildBulkPayload(dryRun));
      setResult(nextResult);
      setNotice(dryRun ? "Dry-run completed. No database records were written." : "Bokun sync completed.");
      loadSyncStatus({ silent: true });
    } catch (err) {
      setError(err.message || "Bokun sync failed");
    } finally {
      setBusy("");
    }
  };

  const canRun = !isSingle || form.reference.trim().length > 0;

  return (
    <div className="admin-bokun-sync-page">
      <div className="admin-platform-page-header">
        <div>
          <span className="admin-platform-eyebrow">{config.eyebrow}</span>
          <h2>{config.title}</h2>
          <p>{config.subtitle}</p>
        </div>
        <Button as={Link} to="/admin/operations/bokun-sync/sync-logs" variant="outline-secondary">
          <BsArchive /> Sync Logs
        </Button>
      </div>

      <ErrorAlert error={error} />
      {notice ? <Alert variant="success">{notice}</Alert> : null}
      <Alert variant={statusVariant} className="d-flex flex-wrap justify-content-between align-items-start gap-3">
        <div>
          <strong className="d-block">{statusLoading ? "Checking Bokun status" : dataModeLabel(dataMode)}</strong>
          <span>{syncStatusMessage(syncStatus)}</span>
        </div>
        <Button variant="outline-secondary" size="sm" onClick={() => loadSyncStatus({ silent: true })} disabled={statusLoading}>
          <BsArrowClockwise /> {statusLoading ? "Checking" : "Refresh"}
        </Button>
      </Alert>

      <Row className="g-3 mb-4">
        <Col md={6} xl={3}>
          <AdminMetricCard label="Bokun Data Mode" value={dataModeLabel(dataMode)} detail={integration.baseUrl || "-"} icon={BsCloudCheck} status={dataMode || "loading"} />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard label="Import Worker" value={label(worker.status)} detail={importState.enabled ? "Scheduled import enabled" : "Scheduled import disabled"} icon={BsArrowClockwise} status={worker.status || "disabled"} />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard label="Sync Window" value={`${importState.defaults?.lookbackDays || 0} days`} detail={`${importState.defaults?.pageSize || 0} per page, ${importState.defaults?.maxPages || 0} pages`} icon={BsJournalCheck} />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard label="Last Sync" value={formatDateTime(worker.lastSuccessAt)} detail={worker.lastError || "No worker error reported"} icon={BsCheckCircle} status={worker.consecutiveFailures ? "WARNING" : ""} />
        </Col>
      </Row>

      <Row className="g-3 mb-4">
        <Col md={6} xl={3}>
          <AdminMetricCard label="Processed" value={summary.processed || 0} detail="Rows inspected" icon={BsCloudCheck} />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard label="Imported / Updated" value={(summary.imported || 0) + (summary.updated || 0)} detail={`${summary.amended || 0} amended`} icon={BsCheckCircle} status={(summary.failed || 0) ? "WARNING" : ""} />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard label="Cancelled" value={summary.cancelled || 0} detail={`${summary.unchanged || 0} unchanged`} icon={BsJournalCheck} />
        </Col>
        <Col md={6} xl={3}>
          <AdminMetricCard label="Skipped / Failed" value={(summary.skipped || 0) + (summary.failed || 0)} detail={`${summary.failed || 0} failed`} icon={BsExclamationTriangle} status={(summary.failed || 0) ? "ERROR" : ""} />
        </Col>
      </Row>

      <Row className="g-4">
        <Col xl={4}>
          <Card className="surface-card h-100">
            <Card.Body>
              <h5 className="mb-3">{config.actionLabel}</h5>

              {isSingle ? (
                <Form.Group className="mb-3" controlId="bokun-single-reference">
                  <Form.Label>Booking reference</Form.Label>
                  <Form.Control
                    value={form.reference}
                    onChange={(event) => updateForm("reference", event.target.value)}
                    placeholder="Confirmation code, Bokun ID, or local reference"
                  />
                </Form.Group>
              ) : (
                <>
                  <Row className="g-2">
                    <Col sm={4}>
                      <Form.Group className="mb-3" controlId="bokun-page">
                        <Form.Label>Page</Form.Label>
                        <Form.Control type="number" min="1" value={form.page} onChange={(event) => updateForm("page", event.target.value)} />
                      </Form.Group>
                    </Col>
                    <Col sm={4}>
                      <Form.Group className="mb-3" controlId="bokun-page-size">
                        <Form.Label>Page size</Form.Label>
                        <Form.Control type="number" min="1" max="100" value={form.pageSize} onChange={(event) => updateForm("pageSize", event.target.value)} />
                      </Form.Group>
                    </Col>
                    <Col sm={4}>
                      <Form.Group className="mb-3" controlId="bokun-max-pages">
                        <Form.Label>Max pages</Form.Label>
                        <Form.Control type="number" min="1" max="100" value={form.maxPages} onChange={(event) => updateForm("maxPages", event.target.value)} />
                      </Form.Group>
                    </Col>
                  </Row>
                  <Form.Group className="mb-3" controlId="bokun-statuses">
                    <Form.Label>Statuses</Form.Label>
                    <Form.Control value={form.bookingStatuses} onChange={(event) => updateForm("bookingStatuses", event.target.value)} />
                  </Form.Group>
                  <Form.Group className="mb-3" controlId="bokun-date-field">
                    <Form.Label>Date range field</Form.Label>
                    <Form.Select value={form.dateRangeField} onChange={(event) => updateForm("dateRangeField", event.target.value)}>
                      {DATE_RANGE_FIELDS.map((field) => <option key={field} value={field}>{label(field)}</option>)}
                    </Form.Select>
                  </Form.Group>
                  <Row className="g-2">
                    <Col sm={6}>
                      <Form.Group className="mb-3" controlId="bokun-from-date">
                        <Form.Label>From</Form.Label>
                        <Form.Control type="date" value={form.fromDate} onChange={(event) => updateForm("fromDate", event.target.value)} />
                      </Form.Group>
                    </Col>
                    <Col sm={6}>
                      <Form.Group className="mb-3" controlId="bokun-to-date">
                        <Form.Label>To</Form.Label>
                        <Form.Control type="date" value={form.toDate} onChange={(event) => updateForm("toDate", event.target.value)} />
                      </Form.Group>
                    </Col>
                  </Row>
                </>
              )}

              <div className="d-grid gap-2">
                <Button variant="outline-primary" disabled={disabled || !canRun} onClick={() => run(true)}>
                  <BsArrowClockwise /> {busy === "dry-run" ? "Running dry-run" : "Dry Run"}
                </Button>
                <Button variant="primary" disabled={disabled || !canRun} onClick={() => run(false)}>
                  <BsCloudCheck /> {busy === "apply" ? "Applying" : "Apply Sync"}
                </Button>
              </div>

              <Alert variant="info" className="mt-3 mb-0">
                Dry-run previews import/resync results without writing database records. Apply writes only through the existing Bokun confirmed-booking sync service.
              </Alert>
            </Card.Body>
          </Card>
        </Col>

        <Col xl={8}>
          <Card className="surface-card h-100">
            <Card.Body>
              <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
                <div>
                  <h5 className="mb-1">Sync Result</h5>
                  <small className="text-muted">Confirmed, cancelled, amended, skipped and failed records from the existing import service.</small>
                </div>
                {result?.syncLogId ? <Badge bg="secondary">Sync log {result.syncLogId}</Badge> : null}
              </div>
              <ResultTable result={result} />
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default AdminBokunSyncPage;
