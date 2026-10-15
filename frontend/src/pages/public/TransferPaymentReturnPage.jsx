import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Alert, Button, Container, Spinner } from "react-bootstrap";
import { FaCheck, FaCircleCheck, FaWhatsapp } from "react-icons/fa6";
import { fetchTransferBooking, verifyTransferPayment } from "../../api/transfersApi";
import { BRAND } from "../../config/brand";
import { bookingLink, formatUsd, passengerSummary, recallBookingAccess } from "../../utils/transferBooking";
import { StepProgress } from "./transfers/fields";
import { formatTripDate } from "./transfers/TransferSummary";
import "./transfers.css";

// Step 5, Confirmed. Pesapal sends the customer here after paying. The page never decides the outcome itself: it
// asks the server, which asks Pesapal for the transaction. A payment Pesapal has not finished yet is checked again a
// few times. "Booking Confirmed!" appears only when the server reports the booking paid by this payment.
const RETRY_DELAYS_MS = [3000, 5000, 8000];
const PAYMENT_STEP = 3;
const CONFIRMED_STEP = 4;

const outcomeOf = (result) => {
  if (!result) return "checking";
  if (result.booking?.paymentStatus === "PAID" && result.payment.outcome === "APPLIED") return "paid";
  if (result.payment.outcome === "NEEDS_REFUND") return "needs-help";
  if (result.payment.status === "PENDING") return "pending";
  return "not-paid";
};

const supportLink = (reference) =>
  BRAND.whatsappHref ? `${BRAND.whatsappHref}?text=${encodeURIComponent(`Hello, I have a question about my transfer booking ${reference}.`)}` : `mailto:${BRAND.email}?subject=${encodeURIComponent(`Transfer booking ${reference}`)}`;

const Shell = ({ step, complete = false, children }) => (
  <div className="tw-page">
    <Container className="tw-body">
      <section className="tw-widget" aria-label="Transfer booking">
        <p className="tw-widget-tab" aria-hidden="true">{complete ? "Booking confirmed" : "Secure online payment"}</p>
        <StepProgress current={step} complete={complete} />
        {children}
      </section>
    </Container>
  </div>
);

// The confirmed booking, read again with the private link's token kept for this tab while the customer paid.
const ConfirmedDetails = ({ booking }) => {
  const outbound = booking.legs[0];
  const back = booking.legs[1];
  return (
    <div className="tw-confirm-grid">
      <section className="tw-confirm-section">
        <h2>Transfer details</h2>
        <dl className="tw-review-rows">
          <div><dt>Route</dt><dd>{outbound.pickupLocationName} → {outbound.dropoffLocationName}</dd></div>
          <div><dt>Pick-up</dt><dd>{formatTripDate(outbound.localDate, outbound.localTime)} (Zanzibar time)</dd></div>
          {back ? <div><dt>Return</dt><dd>{back.pickupLocationName} → {back.dropoffLocationName}, {formatTripDate(back.localDate, back.localTime)}</dd></div> : null}
          {booking.flightNumber ? <div><dt>Flight</dt><dd>{booking.flightNumber}</dd></div> : null}
          <div><dt>Passengers</dt><dd>{passengerSummary(booking.passengers)}</dd></div>
          <div><dt>Vehicle</dt><dd>Private vehicle</dd></div>
        </dl>
      </section>
      <section className="tw-confirm-section">
        <h2>Payment</h2>
        <dl className="tw-review-rows">
          <div><dt>Total paid</dt><dd>{formatUsd(booking.pricing.total)}</dd></div>
          <div><dt>Payment status</dt><dd><span className="tw-paid-badge"><FaCheck aria-hidden="true" /> Paid</span></dd></div>
          <div><dt>Lead passenger</dt><dd>{booking.customer.fullName}</dd></div>
          <div><dt>Email</dt><dd>{booking.customer.email}</dd></div>
        </dl>
      </section>
    </div>
  );
};

const NextSteps = ({ airport }) => (
  <section className="tw-confirm-section mt-3">
    <h2>What happens next</h2>
    <ol className="tw-next-steps">
      <li>Your driver&apos;s details will be shared with you before pick-up, once a driver is assigned.</li>
      <li>Your driver will meet you at the agreed pick-up point at the booked time.</li>
      {airport ? <li>At the airport, look for your driver in the arrivals area after you collect your luggage.</li> : null}
      <li>Need to change something? Contact us with your booking reference.</li>
    </ol>
  </section>
);

const TransferPaymentReturnPage = () => {
  const [params] = useSearchParams();
  const orderTrackingId = params.get("OrderTrackingId") || "";
  const merchantReference = params.get("OrderMerchantReference") || "";
  const [result, setResult] = useState(null);
  const [booking, setBooking] = useState(null);
  const [failed, setFailed] = useState("");
  const [attempt, setAttempt] = useState(0);
  const timer = useRef(null);

  const check = useCallback(async () => {
    try {
      setFailed("");
      setResult(await verifyTransferPayment({ orderTrackingId, merchantReference }));
    } catch (error) {
      setFailed(error.status === 404 ? "not-found" : error.status === 409 ? "mismatch" : "error");
    }
  }, [orderTrackingId, merchantReference]);

  useEffect(() => {
    if (orderTrackingId) check();
    return () => clearTimeout(timer.current);
  }, [orderTrackingId, check]);

  const outcome = failed === "mismatch" ? "needs-help" : outcomeOf(result);
  useEffect(() => {
    if (outcome !== "pending" || attempt >= RETRY_DELAYS_MS.length) return undefined;
    timer.current = setTimeout(() => {
      setAttempt((count) => count + 1);
      check();
    }, RETRY_DELAYS_MS[attempt]);
    return () => clearTimeout(timer.current);
  }, [outcome, attempt, check]);

  const reference = result?.reference || "";
  const accessToken = reference ? recallBookingAccess(reference) : "";

  // Once paid, load the booking itself (its details stay private: they need the booking's access token).
  useEffect(() => {
    if (outcome !== "paid" || !reference || !accessToken) return undefined;
    let active = true;
    fetchTransferBooking(reference, accessToken)
      .then((loaded) => active && setBooking(loaded))
      .catch(() => active && setBooking(null));
    return () => {
      active = false;
    };
  }, [outcome, reference, accessToken]);

  const help = (
    <p className="mb-0 mt-2">
      Need help? Contact us on <a href={BRAND.whatsappHref} target="_blank" rel="noopener noreferrer">WhatsApp</a> or{" "}
      <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a>{reference ? ` with your booking reference ${reference}` : ""}.
    </p>
  );
  const bookingButton = reference && accessToken ? <Link className="tw-btn tw-btn-outline" to={bookingLink(reference, accessToken)}>View your booking</Link> : null;

  if (!orderTrackingId || failed === "not-found") {
    return (
      <Shell step={PAYMENT_STEP}>
        <Alert variant="warning" role="alert" className="mt-3 mb-0">
          <h1 className="h5">Payment not found</h1>
          <p className="mb-0">We could not find this payment. If you were charged, please contact us so we can match it to your booking.</p>
          {help}
          <Link to="/transfers" className="d-inline-block mt-2">Book a transfer</Link>
        </Alert>
      </Shell>
    );
  }

  if (failed === "error") {
    // Pesapal or our server could not be reached; nothing was decided.
    return (
      <Shell step={PAYMENT_STEP}>
        <Alert variant="warning" role="alert" className="mt-3 mb-0">
          <h1 className="h5">We could not check your payment yet</h1>
          <p className="mb-2">Pesapal could not be reached just now. Nothing is lost: please check again in a moment.</p>
          <Button variant="outline-dark" onClick={check}>Check again</Button>
          {help}
        </Alert>
      </Shell>
    );
  }

  if (outcome === "checking" || (outcome === "pending" && attempt < RETRY_DELAYS_MS.length)) {
    return (
      <Shell step={PAYMENT_STEP}>
        <div className="tw-confirm-card text-center" role="status">
          <Spinner animation="border" size="sm" /> <span className="ms-2">Checking your payment with Pesapal…</span>
        </div>
      </Shell>
    );
  }

  if (outcome !== "paid") {
    return (
      <Shell step={PAYMENT_STEP}>
        <div className="tw-confirm-card">
          {outcome === "pending" ? (
            <>
              <h1 className="h5">Your payment is still being processed</h1>
              <p className="mb-2">Pesapal has not confirmed it yet. This can take a few minutes for mobile money. Your transfer is confirmed as soon as it does.</p>
              <Button variant="outline-dark" onClick={() => { setAttempt(0); check(); }}>Check again</Button>
            </>
          ) : outcome === "needs-help" ? (
            <>
              <h1 className="h5">We received a payment we could not apply to this booking</h1>
              <p className="mb-0">Our team has been alerted and will contact you about a refund.</p>
              {help}
            </>
          ) : (
            <>
              <h1 className="h5">The payment was not completed</h1>
              <p className="mb-0">Nothing was confirmed and nothing more is charged. You can try again from your booking page.</p>
              {help}
            </>
          )}
          <div className="tw-confirm-actions">
            {bookingButton}
            <Link to="/transfers" className="tw-btn tw-btn-ghost">Book another transfer</Link>
          </div>
        </div>
      </Shell>
    );
  }

  const airport = Boolean(booking?.flightNumber);
  return (
    <Shell step={CONFIRMED_STEP} complete>
      <div className="tw-confirm-card">
        <header className="tw-confirm-head" role="status">
          <span className="tw-confirm-icon" aria-hidden="true"><FaCircleCheck /></span>
          <h1>Booking Confirmed!</h1>
          <p className="mb-1">Pesapal has confirmed your payment. Your booking reference is</p>
          <span className="tw-confirm-ref">{reference}</span>
          {booking ? <p className="tw-summary-muted mb-0 mt-1">Booked for {booking.customer.email}. Keep your private booking link to view this booking at any time.</p> : null}
        </header>
        {booking ? (
          <>
            <ConfirmedDetails booking={booking} />
            <NextSteps airport={airport} />
          </>
        ) : (
          <>
            <p className="text-center">Open your booking with the private link you received when you booked to see all the details.</p>
            <NextSteps airport={false} />
          </>
        )}
        <div className="tw-confirm-actions">
          {bookingButton}
          <a className="tw-btn tw-btn-ghost" href={supportLink(reference)} target="_blank" rel="noopener noreferrer">
            <FaWhatsapp aria-hidden="true" /> Contact us to change this booking
          </a>
        </div>
      </div>
    </Shell>
  );
};

export default TransferPaymentReturnPage;
