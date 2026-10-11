import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge, Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { fetchTrips } from "../api/transferAdminApi";
import { Empty, ErrorMessage, Loading, PageHeader, StatusBadge, useResource } from "../components/ui";
import { TripActions, TripStatusBadge } from "../components/trips";
import { TRIP_STATUS, zanzibarToday } from "../lib/format";

const addDays = (date, days) => new Date(new Date(`${date}T12:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);

// Daily and upcoming pickups. Each row is one trip: a round trip shows as two independent rows.
const DispatchPage = () => {
  const [params, setParams] = useSearchParams();
  const from = params.get("from") || zanzibarToday();
  const days = Number(params.get("days") || 1);
  const status = params.get("status") || "";
  const unassigned = params.get("unassigned") === "true";
  const query = useMemo(() => ({ from, to: addDays(from, days - 1), ...(status ? { status } : {}), ...(unassigned ? { unassigned: "true" } : {}) }), [from, days, status, unassigned]);
  const { data, loading, error, reload } = useResource(() => fetchTrips(query), [JSON.stringify(query)]);

  const set = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  const byDate = (data?.items || []).reduce((groups, trip) => {
    (groups[trip.localDate] = groups[trip.localDate] || []).push(trip);
    return groups;
  }, {});

  return (
    <>
      <PageHeader title="Dispatch" subtitle="Pickups and drop-offs by day. Assign a driver and vehicle to each confirmed trip." actions={<Button size="sm" variant="outline-secondary" onClick={reload} disabled={loading}>Refresh</Button>} />
      <Card className="ta-card mb-3">
        <Card.Body>
          <Row className="g-2 align-items-end">
            <Col xs={6} md={3}>
              <Form.Group controlId="dispatch-from"><Form.Label>From</Form.Label><Form.Control type="date" value={from} onChange={(event) => set("from", event.target.value)} /></Form.Group>
            </Col>
            <Col xs={6} md={2}>
              <Form.Group controlId="dispatch-days"><Form.Label>Days</Form.Label>
                <Form.Select value={days} onChange={(event) => set("days", event.target.value === "1" ? "" : event.target.value)}>
                  <option value="1">1 day</option>
                  <option value="3">3 days</option>
                  <option value="7">7 days</option>
                  <option value="14">14 days</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col xs={6} md={3}>
              <Form.Group controlId="dispatch-status"><Form.Label>Trip status</Form.Label>
                <Form.Select value={status} onChange={(event) => set("status", event.target.value)}>
                  <option value="">All</option>
                  {Object.entries(TRIP_STATUS).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col xs={6} md={4} className="d-flex gap-2 align-items-center flex-wrap">
              <Form.Check id="dispatch-unassigned" label="Unassigned only" checked={unassigned} onChange={(event) => set("unassigned", event.target.checked ? "true" : "")} />
              <Button size="sm" variant="link" onClick={() => setParams(new URLSearchParams())}>Today</Button>
            </Col>
          </Row>
        </Card.Body>
      </Card>
      <ErrorMessage error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : null}
      {data && !data.items.length ? <Empty>No trips in this period{unassigned ? " that still need a driver or vehicle" : ""}.</Empty> : null}
      {Object.entries(byDate).map(([date, trips]) => (
        <Card className="ta-card mb-3" key={date}>
          <Card.Header className="d-flex justify-content-between align-items-center">
            <strong>{new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</strong>
            <span className="small text-muted">{trips.length} trip{trips.length === 1 ? "" : "s"} · {trips.filter((trip) => trip.dispatchable && !(trip.driver && trip.vehicle)).length} unassigned</span>
          </Card.Header>
          {/* Phones: one card per trip. */}
          <div className="d-md-none">
            {trips.map((trip) => (
              <div key={trip.id} className={`ta-trip-card ${trip.dispatchable ? "" : "ta-row-muted"}`}>
                <div className="d-flex justify-content-between align-items-start gap-2">
                  <div>
                    <strong>{trip.localTime}</strong> · <Link to={`/bookings/${trip.bookingId}`}>{trip.bookingReference}</Link>
                    <div className="small text-muted">{trip.tripType === "ROUND_TRIP" ? (trip.direction === "RETURN" ? "Return leg" : "Outbound leg") : "One way"} · {trip.seatsNeeded} seat{trip.seatsNeeded === 1 ? "" : "s"}</div>
                  </div>
                  <TripStatusBadge status={trip.status} />
                </div>
                <div>{trip.pickupLocationName} → {trip.dropoffLocationName}</div>
                <div className="small text-muted">{trip.customer?.fullName} · {trip.customer?.phone}{trip.flightNumber ? ` · ${trip.flightNumber}` : ""}</div>
                <div className="small">{trip.driver ? trip.driver.fullName : "No driver"} · {trip.vehicle ? trip.vehicle.registrationNumber : "No vehicle"}</div>
                <TripActions trip={trip} onChanged={reload} />
              </div>
            ))}
          </div>
          <Table responsive className="mb-0 align-top ta-table d-none d-md-table">
            <thead>
              <tr><th>Pickup</th><th>Booking</th><th>Route</th><th>Passengers</th><th>Driver &amp; vehicle</th><th>Trip</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {trips.map((trip) => (
                <tr key={trip.id} className={trip.dispatchable ? "" : "ta-row-muted"}>
                  <td className="text-nowrap"><strong>{trip.localTime}</strong>{trip.flightNumber ? <div className="small text-muted">{trip.flightNumber}</div> : null}</td>
                  <td>
                    <Link to={`/bookings/${trip.bookingId}`}>{trip.bookingReference}</Link>
                    <div className="small text-muted">{trip.tripType === "ROUND_TRIP" ? (trip.direction === "RETURN" ? "Return leg" : "Outbound leg") : "One way"}</div>
                    <StatusBadge status={trip.bookingStatus} />{trip.paymentArrangement === "CASH_ON_ARRIVAL" ? <Badge bg="light" text="dark" className="ms-1">Cash on arrival</Badge> : null}
                  </td>
                  <td>{trip.pickupLocationName} → {trip.dropoffLocationName}{trip.address ? <div className="small text-muted">{trip.address}</div> : null}</td>
                  <td>{trip.seatsNeeded} seat{trip.seatsNeeded === 1 ? "" : "s"}<div className="small text-muted">{trip.customer?.fullName}<br />{trip.customer?.phone}</div></td>
                  <td>
                    {trip.driver ? <div>{trip.driver.fullName}<div className="small text-muted">{trip.driver.phone}</div></div> : <span className="text-muted">No driver</span>}
                    {trip.vehicle ? <div className="small">{trip.vehicle.registrationNumber} · {trip.vehicle.passengerCapacity} seats</div> : <div className="small text-muted">No vehicle</div>}
                  </td>
                  <td><TripStatusBadge status={trip.status} /></td>
                  <td><TripActions trip={trip} onChanged={reload} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ))}
    </>
  );
};

export default DispatchPage;
