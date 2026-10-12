import { useCallback, useEffect, useState } from "react";
import { Button, Card, Col, Row } from "react-bootstrap";
import { BsArrowClockwise } from "react-icons/bs";
import { Link } from "react-router-dom";
import PageHeader from "../../../components/admin/PageHeader";
import useAuth from "../../../../../shared/src/hooks/useAuth";
import { fetchTourBookings, fetchTourRequests } from "../../../api/tourOperationsApi";
import { OPEN_REQUEST_STATES, TOUR_PERMISSIONS, hasPermission } from "../../../config/tourOperations";
import { tourAdminErrorMessage } from "../../../components/admin/tourAdmin/TourAdminUi";

// Every number is the server's total for one filtered Tour Operations query (website and Agent Portal
// bookings only). A query that fails shows "Unavailable"; nothing is estimated. No money is shown.
const BOOKING_METRICS = [
  { key: "website", label: "Website bookings", params: { origin: "WEBSITE" }, to: "/admin/tour-admin/bookings?origin=WEBSITE" },
  { key: "agent", label: "Agent Portal bookings", params: { origin: "AGENT_PORTAL" }, to: "/admin/tour-admin/bookings?origin=AGENT_PORTAL" },
  { key: "supplierPending", label: "Awaiting supplier confirmation", detail: "Supplier status: awaiting supplier", params: { supplierStatus: "supplier_pending" }, to: "/admin/tour-admin/bookings?supplierStatus=supplier_pending" },
  { key: "confirmed", label: "Confirmed bookings", params: { bookingStatus: "confirmed" }, to: "/admin/tour-admin/bookings?bookingStatus=confirmed" },
  { key: "failed", label: "Failed bookings", params: { bookingStatus: "failed" }, to: "/admin/tour-admin/bookings?bookingStatus=failed" },
  { key: "cancelled", label: "Cancelled bookings", params: { bookingStatus: "cancelled" }, to: "/admin/tour-admin/bookings?bookingStatus=cancelled" }
];

const REQUEST_STATE_METRICS = OPEN_REQUEST_STATES.map((state) => ({ key: `requests:${state}`, state }));

const MetricCard = ({ label, value, detail, to, unavailable }) => (
  <Card className="surface-card h-100 tour-admin-metric">
    <Card.Body>
      <small className="text-muted d-block">{label}</small>
      <strong className="fs-3 d-block" aria-live="polite">{unavailable ? "Unavailable" : value ?? "…"}</strong>
      {detail ? <small className="text-muted d-block">{detail}</small> : null}
      {to && !unavailable ? <Link to={to} className="small">View list</Link> : null}
    </Card.Body>
  </Card>
);

const TourAdminDashboardPage = () => {
  const { user } = useAuth();
  const canReadRequests = hasPermission(user, TOUR_PERMISSIONS.REQUESTS_READ);
  const [values, setValues] = useState({});
  const [failed, setFailed] = useState({});
  const [loading, setLoading] = useState(true);
  const [firstError, setFirstError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setFirstError("");
    const jobs = [
      ...BOOKING_METRICS.map((metric) => ({ key: metric.key, run: () => fetchTourBookings({ ...metric.params, limit: 1 }) })),
      ...(canReadRequests ? REQUEST_STATE_METRICS.map((metric) => ({ key: metric.key, run: () => fetchTourRequests({ state: metric.state, limit: 1 }) })) : [])
    ];
    const results = await Promise.allSettled(jobs.map((job) => job.run()));
    const nextValues = {};
    const nextFailed = {};
    results.forEach((result, index) => {
      const { key } = jobs[index];
      if (result.status === "fulfilled" && Number.isFinite(Number(result.value?.total))) nextValues[key] = Number(result.value.total);
      else nextFailed[key] = result.reason || true;
    });
    setValues(nextValues);
    setFailed(nextFailed);
    const error = Object.values(nextFailed).find((reason) => reason && reason !== true);
    setFirstError(error ? tourAdminErrorMessage(error, "Some figures could not be loaded.") : Object.keys(nextFailed).length ? "Some figures could not be loaded." : "");
    setLoading(false);
  }, [canReadRequests]);

  useEffect(() => { load(); }, [load]);

  const requestValue = (state) => values[`requests:${state}`];
  const requestUnavailable = (state) => Boolean(failed[`requests:${state}`]);
  const openUnavailable = OPEN_REQUEST_STATES.some(requestUnavailable);
  const openRequests = openUnavailable || OPEN_REQUEST_STATES.some((state) => requestValue(state) === undefined)
    ? undefined
    : OPEN_REQUEST_STATES.reduce((sum, state) => sum + requestValue(state), 0);

  return (
    <div className="tour-admin-dashboard">
      <PageHeader
        eyebrow="Tour Admin"
        title="Tour Dashboard"
        description="Website and Agent Portal tour bookings and customer requests. Payment and supplier confirmation are tracked separately."
        actions={(
          <Button className="premium-btn text-white" onClick={load} disabled={loading}>
            <BsArrowClockwise aria-hidden="true" /> {loading ? "Refreshing…" : "Refresh"}
          </Button>
        )}
      />
      {firstError ? <div className="alert alert-warning" role="alert">{firstError}</div> : null}

      <h3 className="h6 text-uppercase text-muted mt-4">Bookings</h3>
      <Row className="g-3">
        {BOOKING_METRICS.map((metric) => (
          <Col key={metric.key} sm={6} xl={4}>
            <MetricCard label={metric.label} detail={metric.detail} value={values[metric.key]} to={metric.to} unavailable={Boolean(failed[metric.key])} />
          </Col>
        ))}
      </Row>

      {canReadRequests ? (
        <>
          <h3 className="h6 text-uppercase text-muted mt-4">Customer requests</h3>
          <Row className="g-3">
            <Col sm={6} xl={4}>
              <MetricCard label="Open requests" detail="Not yet resolved or rejected in Tour Operations" value={openRequests} to="/admin/tour-admin/requests" unavailable={openUnavailable} />
            </Col>
            <Col sm={6} xl={4}>
              <MetricCard label="Awaiting supplier action" value={requestValue("AWAITING_SUPPLIER")} to="/admin/tour-admin/requests?state=AWAITING_SUPPLIER" unavailable={requestUnavailable("AWAITING_SUPPLIER")} />
            </Col>
            <Col sm={6} xl={4}>
              <MetricCard label="Escalated to Finance" value={requestValue("AWAITING_FINANCE")} to="/admin/tour-admin/requests?state=AWAITING_FINANCE" unavailable={requestUnavailable("AWAITING_FINANCE")} />
            </Col>
          </Row>
        </>
      ) : null}
    </div>
  );
};

export default TourAdminDashboardPage;
