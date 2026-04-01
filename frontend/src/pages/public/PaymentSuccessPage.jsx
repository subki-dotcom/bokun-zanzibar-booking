import { useEffect, useState } from "react";
import { Badge, Button, Card, Container } from "react-bootstrap";
import { Link, useSearchParams } from "react-router-dom";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import { verifyPesapalPayment } from "../../api/paymentsApi";

const PaymentSuccessPage = () => {
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const orderTrackingId = String(
    searchParams.get("OrderTrackingId") ||
      searchParams.get("orderTrackingId") ||
      ""
  ).trim();
  const orderMerchantReference = String(
    searchParams.get("OrderMerchantReference") ||
      searchParams.get("orderMerchantReference") ||
      ""
  ).trim();

  useEffect(() => {
    const verify = async () => {
      if (!orderTrackingId && !orderMerchantReference) {
        setError("Missing OrderTrackingId or OrderMerchantReference in payment callback.");
        setLoading(false);
        return;
      }

      try {
        const data = await verifyPesapalPayment({
          orderTrackingId,
          orderMerchantReference
        });
        setResult(data);
      } catch (err) {
        setError(err.message || "Payment verification failed.");
      } finally {
        setLoading(false);
      }
    };

    verify();
  }, [orderTrackingId, orderMerchantReference]);

  if (loading) {
    return (
      <Container className="py-4">
        <Loader message="Verifying your Pesapal payment..." />
      </Container>
    );
  }

  const paymentResultStatus = String(result?.status || "").toLowerCase();
  const isPendingFinalization = paymentResultStatus === "paid_pending_finalization";
  const isPaid = paymentResultStatus === "paid" || isPendingFinalization;
  const booking = result?.booking || null;

  return (
    <Container className="py-4">
      <ErrorAlert error={error} className="mb-3" />

      <Card className="surface-card payment-result-card">
        <Card.Body>
          <div className="payment-result-badge-wrap">
            <Badge bg={isPaid ? (isPendingFinalization ? "warning" : "success") : "danger"}>
              {isPendingFinalization
                ? "Payment verified, Bokun sync pending"
                : isPaid
                  ? "Payment verified"
                  : "Payment not completed"}
            </Badge>
          </div>

          <h2 className="mb-2">
            {isPendingFinalization
              ? "Payment received"
              : isPaid
                ? "Payment successful"
                : "Payment verification failed"}
          </h2>
          <p className="section-subtitle mb-3">
            {isPendingFinalization
              ? "Your payment is confirmed. Bokun confirmation is still processing, please retry shortly."
              : isPaid
                ? "Your payment is confirmed and your booking has been processed in Bokun."
                : "We could not confirm this payment. Please try again or contact support."}
          </p>

          {booking ? (
            <div className="payment-result-grid">
              <div>
                <span>Booking reference</span>
                <strong>{booking.bookingReference || "-"}</strong>
              </div>
              <div>
                <span>Payment status</span>
                <strong>{booking.paymentStatus || (isPaid ? "paid" : "failed")}</strong>
              </div>
              <div>
                <span>Booking status</span>
                <strong>{booking.bookingStatus || "-"}</strong>
              </div>
            </div>
          ) : null}

          <div className="d-flex flex-wrap gap-2 mt-4">
            {isPendingFinalization ? (
              <Button variant="outline-primary" onClick={() => window.location.reload()}>
                Retry Bokun confirmation
              </Button>
            ) : null}
            {booking?.bookingReference ? (
              <Button as={Link} to={`/my-booking/${booking.bookingReference}`} className="premium-btn text-white">
                View my booking
              </Button>
            ) : null}
            <Button as={Link} to="/tours" variant="outline-secondary">
              Browse tours
            </Button>
          </div>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default PaymentSuccessPage;
