import { useEffect, useState } from "react";
import { Badge, Button, Card, Container } from "react-bootstrap";
import { Link, useSearchParams } from "react-router-dom";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import { verifyDpoPayment, verifyPaypalPayment, verifyPesapalPayment } from "../../api/paymentsApi";

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
  const transactionToken = String(
    searchParams.get("TransactionToken") ||
      searchParams.get("transactionToken") ||
      searchParams.get("ID") ||
      ""
  ).trim();
  const paypalOrderId = String(
    searchParams.get("token") ||
      searchParams.get("paypalOrderId") ||
      ""
  ).trim();

  useEffect(() => {
    const verify = async () => {
      if (!orderTrackingId && !orderMerchantReference && !transactionToken && !paypalOrderId) {
        setError("Missing payment reference in payment callback.");
        setLoading(false);
        return;
      }

      try {
        const data = paypalOrderId
          ? await verifyPaypalPayment({ orderId: paypalOrderId })
          : transactionToken
            ? await verifyDpoPayment({ transactionToken })
            : await verifyPesapalPayment({
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
  }, [orderTrackingId, orderMerchantReference, transactionToken, paypalOrderId]);

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
  const isAgentBooking =
    Boolean(booking?.isAgentBooking) ||
    String(booking?.sourceChannel || "").toLowerCase() === "agent_portal";
  const bookingPath = booking?.bookingReference
    ? isAgentBooking
      ? `/agent/bookings/${booking.bookingReference}`
      : `/my-booking/${booking.bookingReference}`
    : "";
  const paymentStatusPath = booking?.bookingReference
    ? `/payment-status/${booking.bookingReference}`
    : "";

  return (
    <Container className="py-4">
      <ErrorAlert error={error} className="mb-3" />

      <Card className="surface-card payment-result-card">
        <Card.Body>
          <div className="payment-result-badge-wrap">
            <Badge bg={isPaid ? (isPendingFinalization ? "warning" : "success") : "danger"}>
              {isPendingFinalization
                ? "Paid, supplier confirmation pending"
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
              ? "Your payment is confirmed. Supplier confirmation is still processing, but your invoice is marked paid."
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
                Recheck supplier confirmation
              </Button>
            ) : null}
            {booking?.bookingReference ? (
              <Button as={Link} to={bookingPath} className="premium-btn text-white">
                {isAgentBooking ? "Open agent booking" : "View my booking"}
              </Button>
            ) : null}
            {booking?.bookingReference ? (
              <Button as={Link} to={paymentStatusPath} variant="outline-primary">
                Track payment status
              </Button>
            ) : null}
            <Button as={Link} to={isAgentBooking ? "/agent/products" : "/tours"} variant="outline-secondary">
              {isAgentBooking ? "Back to products" : "Browse tours"}
            </Button>
          </div>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default PaymentSuccessPage;
