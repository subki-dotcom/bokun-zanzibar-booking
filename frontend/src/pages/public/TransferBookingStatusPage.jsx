import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Alert, Badge, Button, Container, Spinner } from "react-bootstrap";
import { FiCheckCircle, FiCopy, FiPrinter } from "react-icons/fi";
import { fetchTransferBooking } from "../../api/transfersApi";
import { BRAND } from "../../config/brand";
import { accessTokenFromHash, formatUsd, passengerSummary, statusInfo } from "../../utils/transferBooking";
import "./transfers.css";

const formatDate = (localDate, localTime) => {
  const date = new Date(`${localDate}T${localTime}:00+03:00`);
  if (Number.isNaN(date.getTime())) return `${localDate} ${localTime}`;
  return `${date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" })} at ${localTime}`;
};

const TransferBookingStatusPage = () => {
  const { reference } = useParams();
  const location = useLocation();
  const accessToken = accessTokenFromHash(location.hash);
  const justBooked = Boolean(location.state?.justBooked);
  const [booking, setBooking] = useState(null);
  const [state, setState] = useState(accessToken ? "loading" : "no-token");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!accessToken) return undefined;
    let active = true;
    fetchTransferBooking(reference, accessToken)
      .then((result) => active && (setBooking(result), setState("ready")))
      .catch((error) => active && setState(error.status === 404 ? "not-found" : "error"));
    return () => {
      active = false;
    };
  }, [reference, accessToken]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch (_error) {
      setCopied(false);
    }
  };

  if (state === "loading") {
    return (
      <Container className="transfer-status py-5 text-center" role="status">
        <Spinner animation="border" /> <span className="ms-2">Loading your booking…</span>
      </Container>
    );
  }

  if (state !== "ready") {
    const message = {
      "no-token": "To protect your details, a booking opens only from the private link you received when you booked.",
      "not-found": "We could not find a booking for this link. Please check that you opened the full link.",
      error: "We could not load your booking right now. Please try again shortly."
    }[state];
    return (
      <Container className="transfer-status py-5">
        <Alert variant="warning" role="alert">
          <h1 className="h5">Booking {reference}</h1>
          <p className="mb-2">{message}</p>
          <p className="mb-0">
            Need help? Contact us on <a href={BRAND.whatsappHref} target="_blank" rel="noopener noreferrer">WhatsApp</a> or{" "}
            <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a> with your booking reference.
          </p>
        </Alert>
        <Link to="/transfers">Book a transfer</Link>
      </Container>
    );
  }

  const info = statusInfo(booking.status);
  return (
    <Container className="transfer-status py-4 py-md-5">
      {justBooked ? (
        <Alert variant="success" className="transfer-received" role="status">
          <FiCheckCircle aria-hidden="true" />
          <div>
            <strong>{booking.status === "QUOTE_REQUESTED" ? "Your quote request has been received." : "Your booking has been received."}</strong>
            <div>Save this page&apos;s link: it is the only way to view this booking online.</div>
          </div>
        </Alert>
      ) : null}

      <header className="transfer-status-header">
        <div>
          <p className="transfer-eyebrow">Transfer booking</p>
          <h1 className="transfer-reference">{booking.reference}</h1>
        </div>
        <Badge bg={info.tone} text={info.tone === "warning" ? "dark" : undefined} className="transfer-status-badge">{info.label}</Badge>
      </header>
      {info.next ? <p className="transfer-status-next">{info.next}</p> : null}

      <section className="transfer-card">
        <h2 className="transfer-card-title">Trip</h2>
        <ol className="transfer-legs">
          {booking.legs.map((leg) => (
            <li key={leg.direction}>
              <span className="transfer-leg-label">{leg.direction === "RETURN" ? "Return" : "Outbound"}</span>
              <strong>{leg.pickupLocationName} → {leg.dropoffLocationName}</strong>
              <span>{formatDate(leg.localDate, leg.localTime)} (Zanzibar time)</span>
              {leg.price ? <span className="transfer-leg-price">{formatUsd(leg.price)}</span> : null}
            </li>
          ))}
        </ol>
        <dl className="transfer-details">
          {booking.pickupAddress ? <div><dt>Pickup address</dt><dd>{booking.pickupAddress}</dd></div> : null}
          {booking.dropoffAddress ? <div><dt>Drop-off address</dt><dd>{booking.dropoffAddress}</dd></div> : null}
          {booking.flightNumber ? <div><dt>Flight</dt><dd>{booking.flightNumber}</dd></div> : null}
          <div><dt>Passengers</dt><dd>{passengerSummary(booking.passengers)}</dd></div>
          <div>
            <dt>Luggage</dt>
            <dd>
              {booking.luggage.largeBags} large, {booking.luggage.smallBags} small{booking.luggage.notes ? ` · ${booking.luggage.notes}` : ""}
            </dd>
          </div>
          {booking.specialRequests ? <div><dt>Special requests</dt><dd>{booking.specialRequests}</dd></div> : null}
        </dl>
      </section>

      <section className="transfer-card">
        <h2 className="transfer-card-title">Price &amp; payment</h2>
        {booking.pricing.status === "PRICED" ? (
          <p className="transfer-status-total">
            {formatUsd(booking.pricing.total)} <span>per vehicle{booking.legs.length > 1 ? ", both ways" : ""}</span>
          </p>
        ) : (
          <p className="transfer-status-total">Price to be quoted</p>
        )}
        <p className="mb-0">Payment: <strong>{booking.paymentStatus === "PAID" ? "Paid" : "Not paid yet"}</strong></p>
      </section>

      <section className="transfer-card">
        <h2 className="transfer-card-title">Contact</h2>
        <dl className="transfer-details">
          <div><dt>Name</dt><dd>{booking.customer.fullName}</dd></div>
          <div><dt>Email</dt><dd>{booking.customer.email}</dd></div>
          <div><dt>Phone</dt><dd>{booking.customer.phone}{booking.customer.whatsapp ? " (WhatsApp)" : ""}</dd></div>
        </dl>
      </section>

      <div className="transfer-status-actions">
        <Button variant="outline-secondary" onClick={copyLink}><FiCopy aria-hidden="true" /> {copied ? "Link copied" : "Copy private link"}</Button>
        <Button variant="outline-secondary" onClick={() => window.print()}><FiPrinter aria-hidden="true" /> Print</Button>
        <Link to="/transfers" className="btn btn-link">Book another transfer</Link>
      </div>
    </Container>
  );
};

export default TransferBookingStatusPage;
