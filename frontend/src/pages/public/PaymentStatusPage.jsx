import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Container } from "react-bootstrap";
import { BsCheckCircle, BsClockHistory, BsCreditCard, BsExclamationTriangle, BsFileEarmarkText, BsShieldCheck } from "react-icons/bs";
import { Link, useParams } from "react-router-dom";
import { fetchBookingByReference } from "../../api/bookingsApi";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";
import { formatCurrency } from "../../utils/formatters";

const getStepState = ({ active = false, done = false, failed = false }) => {
  if (failed) return "failed";
  if (done) return "done";
  if (active) return "active";
  return "idle";
};

const StatusStep = ({ icon, title, copy, state }) => (
  <div className={`payment-status-step is-${state}`}>
    <span>{icon}</span>
    <div>
      <strong>{title}</strong>
      <p>{copy}</p>
    </div>
  </div>
);

const PaymentStatusPage = () => {
  const { reference } = useParams();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchBookingByReference(reference);
        setBooking(data);
      } catch (err) {
        setError(err.message || "Could not load payment status");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [reference]);

  const state = useMemo(() => {
    const paymentStatus = String(booking?.paymentStatus || "").toLowerCase();
    const bookingStatus = String(booking?.bookingStatus || "").toLowerCase();
    const hasBokun = Boolean(booking?.bokunBookingId);

    return {
      isPaid: paymentStatus === "paid",
      isFailed: paymentStatus === "failed" || bookingStatus === "failed",
      isConfirmed: bookingStatus === "confirmed" && hasBokun,
      paymentStatus,
      bookingStatus
    };
  }, [booking]);

  if (loading) {
    return (
      <Container className="py-4">
        <Loader message="Loading payment status..." />
      </Container>
    );
  }

  const currency = booking?.currency || booking?.pricingSnapshot?.currency || "USD";
  const total = Number(booking?.amount || booking?.pricingSnapshot?.finalPayable || 0);

  return (
    <main className="payment-status-page">
      <Container className="payment-status-shell">
        <ErrorAlert error={error} className="mb-3" />

        {booking ? (
          <Card className="payment-status-card">
            <Card.Body>
              <div className="payment-status-hero">
                <div>
                  <div className="payment-status-eyebrow">Secure Booking Status</div>
                  <h1>{booking.productTitle}</h1>
                  <p>{booking.bookingReference}</p>
                </div>
                <div className="payment-status-total">
                  <small>Total</small>
                  <strong>{formatCurrency(total, currency)}</strong>
                  <Badge bg={state.isConfirmed ? "success" : state.isFailed ? "danger" : "warning"}>
                    {state.isConfirmed ? "Confirmed" : state.isFailed ? "Attention needed" : "Processing"}
                  </Badge>
                </div>
              </div>

              <div className="payment-status-timeline">
                <StatusStep
                  icon={<BsCreditCard />}
                  title="Payment"
                  copy={state.isPaid ? "Payment has been verified by the gateway." : "Waiting for payment confirmation from Pesapal."}
                  state={getStepState({ done: state.isPaid, active: !state.isPaid && !state.isFailed, failed: state.isFailed })}
                />
                <StatusStep
                  icon={<BsShieldCheck />}
                  title="Bokun Confirmation"
                  copy={state.isConfirmed ? "Booking has been created and confirmed in Bokun." : "Booking will be sent to Bokun only after payment is confirmed."}
                  state={getStepState({ done: state.isConfirmed, active: state.isPaid && !state.isConfirmed, failed: state.isFailed })}
                />
                <StatusStep
                  icon={state.isFailed ? <BsExclamationTriangle /> : <BsCheckCircle />}
                  title="Ready for Travel"
                  copy={state.isConfirmed ? "Your booking is ready. Keep your reference for support." : "We will show confirmation details here once processing is complete."}
                  state={getStepState({ done: state.isConfirmed, active: state.isPaid && !state.isConfirmed, failed: state.isFailed })}
                />
              </div>

              <div className="payment-status-actions">
                <Button as={Link} to={`/my-booking/${booking.bookingReference}`} className="premium-btn text-white">
                  View Booking
                </Button>
                <Button as={Link} to={`/invoice/${booking.bookingReference}`} variant="outline-secondary">
                  <BsFileEarmarkText /> Invoice
                </Button>
                {!state.isConfirmed ? (
                  <Button variant="outline-primary" onClick={() => window.location.reload()}>
                    <BsClockHistory /> Refresh Status
                  </Button>
                ) : null}
              </div>
            </Card.Body>
          </Card>
        ) : null}
      </Container>
    </main>
  );
};

export default PaymentStatusPage;
