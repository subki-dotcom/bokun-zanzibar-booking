import { Link } from "react-router-dom";
import { Button, Card, Col, Row, Table } from "react-bootstrap";
import { fetchDashboard } from "../api/transferAdminApi";
import { Empty, ErrorMessage, Loading, PageHeader, StatusBadge, useResource } from "../components/ui";
import { dateTime, legWhen, passengers, usd } from "../lib/format";
import { TripStatusBadge } from "../components/trips";

const Metric = ({ label, value, note, to }) => (
  <Card className="ta-metric h-100">
    <Card.Body>
      <span className="ta-metric-label">{label}</span>
      <strong className="ta-metric-value">{to ? <Link to={to}>{value}</Link> : value}</strong>
      {note ? <span className="ta-metric-note">{note}</span> : null}
    </Card.Body>
  </Card>
);

const DashboardPage = () => {
  const { data, loading, error, reload } = useResource(fetchDashboard, []);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={data ? `Live figures from the transfer database · ${dateTime(data.generatedAt)}` : "Live figures from the transfer database"}
        actions={<Button variant="outline-secondary" size="sm" onClick={reload} disabled={loading}>Refresh</Button>}
      />
      <ErrorMessage error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : null}
      {data ? (
        <>
          <Row xs={1} sm={2} xl={4} className="g-3 mb-3">
            <Col><Metric label="Quote requests" value={data.counts.QUOTE_REQUESTED} note="Need a price from the team" to="/bookings?status=QUOTE_REQUESTED" /></Col>
            <Col><Metric label="Awaiting payment" value={data.counts.AWAITING_PAYMENT} note={`${usd(data.awaitingPayment.amount)} priced — not revenue until paid`} to="/bookings?status=AWAITING_PAYMENT" /></Col>
            <Col><Metric label="Confirmed" value={data.counts.CONFIRMED} note="Confirmed for travel; payment status is shown on each booking" to="/bookings?status=CONFIRMED" /></Col>
            <Col><Metric label="Paid revenue" value={usd(data.paidRevenue.amount)} note={`${data.paidRevenue.count} verified payment${data.paidRevenue.count === 1 ? "" : "s"}`} /></Col>
          </Row>
          <Row xs={1} sm={3} className="g-3 mb-4">
            <Col><Metric label="New today" value={data.createdToday} note="Bookings created today (Zanzibar time)" /></Col>
            <Col><Metric label="Last 7 days" value={data.createdLast7Days} note="Bookings created" /></Col>
            <Col><Metric label="All bookings" value={data.total} note={`${data.counts.REJECTED} rejected · ${data.counts.CANCELLED} cancelled`} to="/bookings" /></Col>
          </Row>

          {data.dispatch ? (
            <>
              <h2 className="h6 mt-2 mb-2">Operations</h2>
              <Row xs={2} md={3} xl={5} className="g-3 mb-3">
                <Col><Metric label="Today's pickups" value={data.dispatch.today.length} note="Trips today, all statuses" to="/dispatch" /></Col>
                <Col><Metric label="Upcoming" value={data.dispatch.upcomingCount} note="Trips in the next 7 days" to="/dispatch?days=7" /></Col>
                <Col><Metric label="Unassigned" value={data.dispatch.unassignedCount} note="Confirmed trips needing a driver or vehicle" to="/dispatch?days=14&unassigned=true" /></Col>
                <Col><Metric label="Completed" value={data.dispatch.completedToday} note={`${data.dispatch.completedLast7Days} in the last 7 days`} /></Col>
                <Col><Metric label="No-shows" value={data.dispatch.noShowsLast7Days} note="In the last 7 days" /></Col>
              </Row>
              <Row className="g-3 mb-4">
                <Col lg={8}>
                  <Card className="ta-card h-100">
                    <Card.Body>
                      <h3 className="h6 mb-3">Today's schedule</h3>
                      {data.dispatch.today.length ? (
                        <Table responsive size="sm" className="mb-0 align-middle">
                          <thead><tr><th>Time</th><th>Booking</th><th>Route</th><th>Driver · vehicle</th><th>Trip</th></tr></thead>
                          <tbody>
                            {data.dispatch.today.map((trip) => (
                              <tr key={trip.id}>
                                <td>{trip.localTime}</td>
                                <td><Link to={`/bookings/${trip.bookingId}`}>{trip.bookingReference}</Link></td>
                                <td>{trip.pickupLocationName} → {trip.dropoffLocationName}</td>
                                <td>{trip.driver ? trip.driver.fullName : <span className="text-muted">—</span>} · {trip.vehicle ? trip.vehicle.registrationNumber : <span className="text-muted">—</span>}</td>
                                <td><TripStatusBadge status={trip.status} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </Table>
                      ) : (
                        <Empty>No pickups today.</Empty>
                      )}
                    </Card.Body>
                  </Card>
                </Col>
                <Col lg={4}>
                  <Card className="ta-card h-100">
                    <Card.Body>
                      <h3 className="h6 mb-3">Driver assignments today</h3>
                      {data.dispatch.driverAssignmentsToday.length ? (
                        <Table size="sm" className="mb-0">
                          <tbody>
                            {data.dispatch.driverAssignmentsToday.map((row) => (
                              <tr key={row.driver}><td>{row.driver}<div className="small text-muted">{row.vehicles.join(", ")}</div></td><td className="text-end">{row.trips} trip{row.trips === 1 ? "" : "s"}</td></tr>
                            ))}
                          </tbody>
                        </Table>
                      ) : (
                        <Empty>No drivers assigned today.</Empty>
                      )}
                    </Card.Body>
                  </Card>
                </Col>
              </Row>
            </>
          ) : null}

          <Card className="ta-card">
            <Card.Body>
              <h2 className="h6 mb-3">Pickups in the next 7 days</h2>
              {data.upcoming.length ? (
                <Table responsive hover className="mb-0 align-middle">
                  <thead>
                    <tr><th>Pickup (EAT)</th><th>Reference</th><th>Route</th><th>Passengers</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {data.upcoming.map((booking) => (
                      <tr key={booking.id}>
                        <td>{legWhen(booking.firstLeg)}</td>
                        <td><Link to={`/bookings/${booking.id}`}>{booking.reference}</Link></td>
                        <td>{booking.firstLeg.pickupLocationName} → {booking.firstLeg.dropoffLocationName}</td>
                        <td>{passengers(booking.passengers)}</td>
                        <td><StatusBadge status={booking.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <Empty>No confirmed or awaiting-payment pickups in the next 7 days.</Empty>
              )}
            </Card.Body>
          </Card>
          <p className="ta-footnote">
            Paid revenue counts only payments verified by the server. Bookings awaiting payment are shown separately and are not revenue.
          </p>
        </>
      ) : null}
    </>
  );
};

export default DashboardPage;
