import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Container } from "react-bootstrap";
import { BsCheckCircle, BsClockHistory, BsCreditCard, BsExclamationTriangle, BsFileEarmarkText, BsShieldCheck } from "react-icons/bs";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { fetchPesapalPaymentStatus } from "../../api/paymentsApi";
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
  const [searchParams] = useSearchParams();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [pollingTimedOut, setPollingTimedOut] = useState(false);
  const orderTrackingId = String(
    searchParams.get("OrderTrackingId") || searchParams.get("orderTrackingId") || ""
  ).trim();
  const orderMerchantReference = String(
    searchParams.get("OrderMerchantReference") || searchParams.get("orderMerchantReference") || ""
  ).trim();

  useEffect(() => {
    let isActive = true;
    let refreshTimer = null;
    let attempts = 0;
    const maxAttempts = 24;
    setPollingTimedOut(false);

    const load = async () => {
      if (!orderTrackingId && !orderMerchantReference) {
        if (isActive) {
          setError("This payment status link is incomplete. Return to the payment confirmation page.");
          setLoading(false);
        }
        return;
      }

      try {
        const data = await fetchPesapalPaymentStatus({ orderTrackingId, orderMerchantReference });
        if (!isActive) return;

        setBooking(data.booking || null);
        setError("");

        const isConfirmed = String(data?.bookingStatus || "").toLowerCase() === "confirmed";
        const isFailed = data?.isTerminal && !isConfirmed;

        attempts += 1;
        if (!isConfirmed && !isFailed && attempts < maxAttempts) {
          refreshTimer = window.setTimeout(load, 5000);
        } else if (!isConfirmed && !isFailed) {
          setPollingTimedOut(true);
        }
      } catch (err) {
        if (isActive) {
          setError(err.message || "Could not load payment status");
        }
        attempts += 1;
        if (isActive && attempts < 6) {
          refreshTimer = window.setTimeout(load, 5000);
        }
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      isActive = false;
      if (refreshTimer) {
        window.clearTimeout(refreshTimer);
      }
    };
  }, [orderTrackingId, orderMerchantReference, refreshKey]);

  const state = useMemo(() => {
    const paymentStatus = String(booking?.paymentStatus || "").toLowerCase();
    const bookingStatus = String(booking?.bookingStatus || "").toLowerCase();
    const hasBokun = Boolean(booking?.bokunBookingId);

    return {
      isPaid: paymentStatus === "paid",
      isManualReview: bookingStatus === "manual_review_required",
      isReversed: paymentStatus === "reversed" || bookingStatus === "reversed",
      isFailed: paymentStatus === "failed" || bookingStatus === "failed" || bookingStatus === "cancelled",
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
  const amountPaid = Number(booking?.amountPaid || total || 0);
  const canRetryPayment = state.isFailed || state.isReversed;

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
                  <strong>{formatCurrency(amountPaid, currency)}</strong>
                  <Badge bg={state.isConfirmed ? "success" : state.isFailed ? "danger" : state.isReversed ? "secondary" : "warning"}>
                    {state.isConfirmed ? "Confirmed" : state.isManualReview ? "Review pending" : state.isReversed ? "Reversed" : state.isFailed ? "Attention needed" : "Processing"}
                  </Badge>
                </div>
              </div>

              <div className="payment-status-timeline">
                <StatusStep
                  icon={<BsCreditCard />}
                  title="Payment"
                  copy={state.isPaid ? "Payment has been verified by the gateway." : state.isReversed ? "The payment provider reported a reversed payment." : "Waiting for payment confirmation from Pesapal."}
                  state={getStepState({ done: state.isPaid, active: !state.isPaid && !state.isFailed && !state.isReversed, failed: state.isFailed || state.isReversed })}
                />
                <StatusStep
                  icon={<BsShieldCheck />}
                  title="Bokun Confirmation"
                  copy={state.isConfirmed ? "Booking has been created and confirmed in Bokun." : state.isManualReview ? "Our team is reviewing the supplier confirmation." : "Booking will be sent to Bokun only after payment is confirmed."}
                  state={getStepState({ done: state.isConfirmed, active: state.isPaid && !state.isConfirmed && !state.isManualReview, failed: state.isFailed || state.isReversed })}
                />
                <StatusStep
                  icon={state.isFailed ? <BsExclamationTriangle /> : <BsCheckCircle />}
                  title="Ready for Travel"
                  copy={state.isConfirmed ? "Your booking is ready. Keep your reference for support." : state.isManualReview ? "Your payment is safe. Support will contact you after supplier review." : "We will show confirmation details here once processing is complete."}
                  state={getStepState({ done: state.isConfirmed, active: state.isPaid && !state.isConfirmed && !state.isManualReview, failed: state.isFailed || state.isReversed })}
                />
              </div>

              {pollingTimedOut && !state.isConfirmed && !state.isFailed && !state.isReversed ? (
                <div className="payment-polling-notice" role="status">
                  We are still confirming your payment. You may safely close this page. We will update your booking automatically once confirmation is received.
                </div>
              ) : null}

              <div className="payment-status-actions">
                <Button as={Link} to={`/my-booking/${booking.bookingReference}`} className="premium-btn text-white">
                  View Booking
                </Button>
                <Button as={Link} to={`/invoice/${booking.bookingReference}`} variant="outline-secondary">
                  <BsFileEarmarkText /> Invoice
                </Button>
                {!state.isConfirmed ? (
                  <Button variant="outline-primary" onClick={() => setRefreshKey((current) => current + 1)}>
                    <BsClockHistory /> Check Status
                  </Button>
                ) : null}
                {canRetryPayment ? (
                  <Button as={Link} to={`/payment/checkout/${booking.bookingReference}`} className="premium-btn text-white">
                    Retry Payment
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
