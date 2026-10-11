import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, Badge, Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { approveCashOnArrival, fetchBooking, issueCustomerLink, quoteBooking, rejectBooking } from "../api/transferAdminApi";
import { useAuth } from "../auth/AuthContext";
import { ErrorMessage, FormModal, Loading, PageHeader, ReasonModal, StatusBadge, useResource } from "../components/ui";
import { ARRANGEMENT, PAYMENT, dateTime, passengers, usd, websiteBase } from "../lib/format";
import { TripActions, TripStatusBadge } from "../components/trips";
import { P, can } from "../lib/permissions";

const Row2 = ({ label, children }) => (
  <div className="ta-kv">
    <dt>{label}</dt>
    <dd>{children || "—"}</dd>
  </div>
);

const QuoteModal = ({ booking, show, onHide, onDone }) => {
  const [prices, setPrices] = useState({});
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (show) {
      setPrices({});
      setReason("");
    }
  }, [show]);
  const submit = async () => onDone(await quoteBooking(booking.id, { legs: booking.legs.map((leg) => ({ direction: leg.direction, price: prices[leg.direction] || "" })), reason }));
  return (
    <FormModal show={show} title="Set quote" onHide={onHide} onSubmit={submit} submitLabel="Save quote">
      <p className="small text-muted">Price per vehicle in USD. The booking moves to awaiting payment; the original request stays in the pricing history.</p>
      {booking.legs.map((leg) => (
        <Form.Group key={leg.direction} className="mb-3" controlId={`ta-quote-${leg.direction}`}>
          <Form.Label>{leg.direction === "RETURN" ? "Return" : "Outbound"}: {leg.pickupLocationName} → {leg.dropoffLocationName}</Form.Label>
          <Form.Control inputMode="decimal" pattern="\d+(\.\d{1,2})?" placeholder="e.g. 60.00" value={prices[leg.direction] || ""} onChange={(event) => setPrices({ ...prices, [leg.direction]: event.target.value.trim() })} required />
        </Form.Group>
      ))}
      <Form.Group controlId="ta-quote-reason">
        <Form.Label>Reason (saved in the audit log)</Form.Label>
        <Form.Control as="textarea" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} required />
      </Form.Group>
    </FormModal>
  );
};

const BookingDetailPage = () => {
  const { bookingId } = useParams();
  const { user } = useAuth();
  const { data: booking, loading, error, reload } = useResource(() => fetchBooking(bookingId), [bookingId]);
  const [modal, setModal] = useState("");
  const [notice, setNotice] = useState("");
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState(null);
  const manage = can(user, P.BOOKINGS_MANAGE);

  if (loading && !booking) return <Loading />;
  if (error && !booking) return <ErrorMessage error={error} onRetry={reload} />;
  if (!booking) return null;

  const done = (message) => async () => {
    setNotice(message);
    await reload();
  };
  const unpaid = booking.paymentStatus === "UNPAID";
  const open = ["QUOTE_REQUESTED", "AWAITING_PAYMENT"].includes(booking.status) && unpaid;

  const getLink = async () => {
    setLinkError(null);
    try {
      const result = await issueCustomerLink(booking.id);
      setLink(`${websiteBase()}${result.path}`);
    } catch (failure) {
      setLinkError(failure);
    }
  };

  return (
    <>
      <PageHeader
        title={booking.reference}
        subtitle={`${booking.source === "MANUAL" ? `Entered by ${booking.createdBy?.email} via ${booking.manualChannel}` : "Website booking"} · created ${dateTime(booking.createdAt)}`}
        actions={
          <div className="d-flex flex-wrap gap-2 align-items-center">
            <StatusBadge status={booking.status} />
            <Badge bg="light" text="dark">{PAYMENT[booking.paymentStatus]}</Badge>
            {booking.paymentArrangement === "CASH_ON_ARRIVAL" ? <Badge bg="light" text="dark">{ARRANGEMENT.CASH_ON_ARRIVAL}</Badge> : null}
          </div>
        }
      />
      <p><Link to="/bookings">← All bookings</Link></p>
      {notice ? <Alert variant="success" dismissible onClose={() => setNotice("")}>{notice}</Alert> : null}
      <ErrorMessage error={error} onRetry={reload} />

      {manage ? (
        <Card className="ta-card mb-3">
          <Card.Body className="d-flex flex-wrap gap-2 align-items-center">
            {booking.status === "QUOTE_REQUESTED" && unpaid ? <Button onClick={() => setModal("quote")}>Set quote</Button> : null}
            {booking.status === "AWAITING_PAYMENT" && unpaid ? <Button variant="success" onClick={() => setModal("cash")}>Approve cash on arrival</Button> : null}
            {open ? <Button variant="outline-danger" onClick={() => setModal("reject")}>Reject</Button> : null}
            <Button variant="outline-secondary" onClick={getLink}>Customer link</Button>
            {!open && booking.status !== "CONFIRMED" ? <span className="small text-muted">No actions available for this status.</span> : null}
          </Card.Body>
          {link ? (
            <Card.Footer>
              <Form.Label htmlFor="ta-customer-link" className="small">Private link for the customer (do not post publicly)</Form.Label>
              <div className="d-flex gap-2">
                <Form.Control id="ta-customer-link" readOnly value={link} onFocus={(event) => event.target.select()} />
                <Button variant="outline-secondary" onClick={() => navigator.clipboard?.writeText(link)}>Copy</Button>
              </div>
            </Card.Footer>
          ) : null}
          {linkError ? <Card.Footer><ErrorMessage error={linkError} /></Card.Footer> : null}
        </Card>
      ) : null}

      <Row className="g-3">
        <Col lg={7}>
          <Card className="ta-card mb-3">
            <Card.Body>
              <h2 className="h6">Trip</h2>
              {booking.legs.map((leg) => (
                <div key={leg.direction} className="ta-leg">
                  <span className="ta-leg-label">{leg.direction === "RETURN" ? "Return" : "Outbound"}</span>
                  <strong>{leg.pickupLocationName} ({leg.pickupZoneCode}) → {leg.dropoffLocationName} ({leg.dropoffZoneCode})</strong>
                  <span>{leg.localDate} {leg.localTime} EAT</span>
                  <span>{leg.price ? usd(leg.price) : "No price yet"}{leg.tier ? ` · tier ${leg.tier.minPassengers}–${leg.tier.maxPassengers}` : ""}{leg.priceReason === "ADMIN_QUOTE" ? " · admin quote" : ""}</span>
                </div>
              ))}
              <dl className="ta-kvs mt-3">
                <Row2 label="Pickup address">{booking.pickupAddress}</Row2>
                <Row2 label="Drop-off address">{booking.dropoffAddress}</Row2>
                <Row2 label="Flight">{booking.flightNumber}</Row2>
                <Row2 label="Passengers">{`${passengers(booking.passengers)} · ${booking.passengers.capacity} seats`}</Row2>
                <Row2 label="Luggage">{`${booking.luggage.largeBags || 0} large, ${booking.luggage.smallBags || 0} small${booking.luggage.notes ? ` · ${booking.luggage.notes}` : ""}`}</Row2>
                <Row2 label="Special requests">{booking.specialRequests}</Row2>
              </dl>
            </Card.Body>
          </Card>
          {booking.trips ? (
            <Card className="ta-card mb-3">
              <Card.Body>
                <h2 className="h6">Trips</h2>
                <p className="small text-muted">Each leg is a separate trip with its own driver, vehicle and status. Trip status does not change payment.</p>
                {booking.trips.map((trip) => (
                  <div key={trip.id} className="ta-leg">
                    <span className="ta-leg-label">{trip.direction === "RETURN" ? "Return" : "Outbound"} · {trip.localDate} {trip.localTime} EAT</span>
                    <div className="d-flex flex-wrap gap-2 align-items-center">
                      <TripStatusBadge status={trip.status} />
                      <span>{trip.driver ? `${trip.driver.fullName} · ${trip.driver.phone}` : "No driver"} · {trip.vehicle ? `${trip.vehicle.registrationNumber} (${trip.vehicle.passengerCapacity} seats)` : "No vehicle"}</span>
                    </div>
                    <TripActions trip={trip} onChanged={reload} />
                    {trip.assignmentHistory.length ? (
                      <details className="small">
                        <summary>Assignment history</summary>
                        {trip.assignmentHistory.map((entry, index) => <div key={index}>{entry.action.toLowerCase()} · {entry.driverName || ""} {entry.registrationNumber || ""} · {dateTime(entry.at)} · {entry.by}{entry.reason ? ` · ${entry.reason}` : ""}</div>)}
                      </details>
                    ) : null}
                  </div>
                ))}
              </Card.Body>
            </Card>
          ) : null}
          <Card className="ta-card mb-3">
            <Card.Body>
              <h2 className="h6">Customer</h2>
              <dl className="ta-kvs">
                <Row2 label="Name">{booking.customer.fullName}</Row2>
                <Row2 label="Email"><a href={`mailto:${booking.customer.email}`}>{booking.customer.email}</a></Row2>
                <Row2 label="Phone"><a href={`tel:${booking.customer.phone.replace(/\s/g, "")}`}>{booking.customer.phone}</a>{booking.customer.whatsapp ? " · WhatsApp" : ""}</Row2>
              </dl>
            </Card.Body>
          </Card>
        </Col>
        <Col lg={5}>
          <Card className="ta-card mb-3">
            <Card.Body>
              <h2 className="h6">Price</h2>
              <p className="ta-price">{booking.pricing.status === "PRICED" ? usd(booking.pricing.total) : "Quote required"}</p>
              <p className="small text-muted mb-2">Per vehicle · infants {booking.pricing.infantPricing === "COUNTED" ? "counted" : "not counted"} in the price tier</p>
              <h3 className="h6 mt-3">Pricing history</h3>
              <Table size="sm" className="mb-0">
                <tbody>
                  {booking.pricingHistory.map((entry, index) => (
                    <tr key={index}>
                      <td>{entry.source === "ENGINE" ? "Price engine" : "Admin quote"}<div className="small text-muted">{dateTime(entry.at)} · {entry.by}</div>{entry.reason ? <div className="small">{entry.reason}</div> : null}</td>
                      <td className="text-end">{entry.total ? usd(entry.total) : "No rate"}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
          <Card className="ta-card mb-3">
            <Card.Body>
              <h2 className="h6">Status history</h2>
              <ol className="ta-timeline">
                {booking.statusHistory.map((entry, index) => (
                  <li key={index}>
                    <StatusBadge status={entry.status} /> <span className="small text-muted">{dateTime(entry.at)} · {entry.by}</span>
                    {entry.note ? <div className="small">{entry.note}</div> : null}
                  </li>
                ))}
              </ol>
            </Card.Body>
          </Card>
          {booking.audit ? (
            <Card className="ta-card mb-3">
              <Card.Body>
                <h2 className="h6">Audit trail</h2>
                <ol className="ta-timeline">
                  {booking.audit.map((entry) => (
                    <li key={entry.id}>
                      <code>{entry.action}</code> <span className="small text-muted">{dateTime(entry.createdAt)} · {entry.actorEmail || entry.actorRole}</span>
                      {entry.reason ? <div className="small">{entry.reason}</div> : null}
                    </li>
                  ))}
                </ol>
              </Card.Body>
            </Card>
          ) : null}
        </Col>
      </Row>

      <QuoteModal booking={booking} show={modal === "quote"} onHide={() => setModal("")} onDone={done("Quote saved. The booking is now awaiting payment.")} />
      <ReasonModal
        show={modal === "cash"}
        title="Approve cash on arrival"
        description="The booking becomes confirmed. It stays unpaid until the cash is collected and recorded."
        submitLabel="Approve"
        variant="success"
        onHide={() => setModal("")}
        onSubmit={async (reason) => {
          await approveCashOnArrival(booking.id, reason);
          await done("Approved for cash on arrival.")();
        }}
      />
      <ReasonModal
        show={modal === "reject"}
        title="Reject booking"
        description="The customer will see that the booking was not accepted."
        submitLabel="Reject"
        variant="danger"
        onHide={() => setModal("")}
        onSubmit={async (reason) => {
          await rejectBooking(booking.id, reason);
          await done("Booking rejected.")();
        }}
      />
    </>
  );
};

export default BookingDetailPage;
