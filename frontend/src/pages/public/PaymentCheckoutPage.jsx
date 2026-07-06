import { useEffect, useState } from "react";
import { Button, Card, Container } from "react-bootstrap";
import { BsCreditCard, BsLock, BsShieldCheck } from "react-icons/bs";
import { Link, useParams } from "react-router-dom";
import { fetchBookingByReference } from "../../api/bookingsApi";
import { createPesapalPayment } from "../../api/paymentsApi";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";
import { formatCurrency, formatDate } from "../../utils/formatters";

const PaymentCheckoutPage = () => {
  const { reference } = useParams();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchBookingByReference(reference);
        setBooking(data);
      } catch (err) {
        setError(err.message || "Could not load payment checkout");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [reference]);

  const startPayment = async () => {
    if (!booking?._id) {
      setError("Booking ID is missing for payment retry.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const amount = Number(booking.amount || booking.pricingSnapshot?.finalPayable || 0);
      const currency = booking.currency || booking.pricingSnapshot?.currency || "USD";
      const result = await createPesapalPayment({
        bookingId: booking._id,
        amount,
        currency,
        paymentMethod: "pesapal"
      });

      if (!result.redirectUrl) {
        throw new Error("Pesapal payment URL was not returned.");
      }

      window.location.assign(result.redirectUrl);
    } catch (err) {
      setError(err.message || "Could not start Pesapal payment");
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Container className="py-4">
        <Loader message="Preparing secure checkout..." />
      </Container>
    );
  }

  const amount = Number(booking?.amount || booking?.pricingSnapshot?.finalPayable || 0);
  const currency = booking?.currency || booking?.pricingSnapshot?.currency || "USD";
  const isPaid = booking?.paymentStatus === "paid";

  return (
    <main className="payment-status-page">
      <Container className="payment-status-shell">
        <ErrorAlert error={error} className="mb-3" />

        {booking ? (
          <Card className="payment-status-card">
            <Card.Body>
              <div className="payment-status-hero">
                <div>
                  <div className="payment-status-eyebrow">Riser Secure Checkout</div>
                  <h1>{booking.productTitle}</h1>
                  <p>{booking.bookingReference}</p>
                </div>
                <div className="payment-status-total">
                  <small>Total Payable</small>
                  <strong>{formatCurrency(amount, currency)}</strong>
                </div>
              </div>

              <div className="payment-status-timeline">
                <div className="payment-status-step is-active">
                  <span><BsShieldCheck /></span>
                  <div>
                    <strong>Trip Summary</strong>
                    <p>{booking.optionTitle} on {formatDate(booking.travelDate)} {booking.startTime ? `at ${booking.startTime}` : ""}</p>
                  </div>
                </div>
                <div className="payment-status-step is-active">
                  <span><BsCreditCard /></span>
                  <div>
                    <strong>Pesapal Secure Payment</strong>
                    <p>You will be redirected to Pesapal to complete payment securely.</p>
                  </div>
                </div>
                <div className="payment-status-step">
                  <span><BsLock /></span>
                  <div>
                    <strong>Bókun Confirmation</strong>
                    <p>Booking is created in Bókun only after payment is confirmed.</p>
                  </div>
                </div>
              </div>

              <div className="payment-status-actions">
                <Button className="premium-btn text-white" onClick={startPayment} disabled={submitting || isPaid}>
                  {isPaid ? "Payment Already Confirmed" : submitting ? "Opening Pesapal..." : "Pay Securely with Pesapal"}
                </Button>
                <Button as={Link} to={`/payment-status/${booking.bookingReference}`} variant="outline-secondary">
                  Track Status
                </Button>
              </div>
            </Card.Body>
          </Card>
        ) : null}
      </Container>
    </main>
  );
};

export default PaymentCheckoutPage;
