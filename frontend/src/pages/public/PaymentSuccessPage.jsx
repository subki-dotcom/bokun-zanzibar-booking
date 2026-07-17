import { useEffect, useState } from "react";
import { Badge, Button, Card, Container } from "react-bootstrap";
import { Link, useSearchParams } from "react-router-dom";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import {
  fetchPesapalPaymentStatus,
  verifyDpoPayment,
  verifyPaypalPayment
} from "../../api/paymentsApi";

const PaymentSuccessPage = () => {
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

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
    let isActive = true;
    let retryTimer = null;
    let attempts = 0;
    const maxAttempts = 40;

    const requiresConfirmationPolling = (data) => {
      const status = String(data?.status || "").toLowerCase();
      const booking = data?.booking || {};
      const bookingConfirmed =
        String(booking.bookingStatus || "").toLowerCase() === "confirmed" && Boolean(booking.bokunBookingId);

      if (bookingConfirmed || status === "paid_manual_review" || status === "failed") {
        return false;
      }

      return ["pending", "processing", "payment_processing", "paid_pending_finalization"].includes(status) ||
        (status === "paid" && !bookingConfirmed);
    };

    const verify = async () => {
      if (!orderTrackingId && !orderMerchantReference && !transactionToken && !paypalOrderId) {
        if (isActive) {
          setError("Missing payment reference in payment callback.");
          setLoading(false);
        }
        return;
      }

      try {
        const data = paypalOrderId
          ? await verifyPaypalPayment({ orderId: paypalOrderId })
          : transactionToken
            ? await verifyDpoPayment({ transactionToken })
            : await fetchPesapalPaymentStatus({
                orderTrackingId,
                orderMerchantReference
              });
        if (!isActive) return;

        setResult(data);
        setError("");

        attempts += 1;
        if (requiresConfirmationPolling(data) && attempts < maxAttempts) {
          retryTimer = window.setTimeout(verify, 3000);
        }
      } catch (err) {
        if (!isActive) return;

        setError(err.message || "Payment verification failed.");
        attempts += 1;
        if (attempts < 6) {
          retryTimer = window.setTimeout(verify, 3000);
        }
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    verify();

    return () => {
      isActive = false;
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [orderTrackingId, orderMerchantReference, transactionToken, paypalOrderId, refreshKey]);

  if (loading) {
    return (
      <Container className="py-4">
        <Loader message="Verifying your Pesapal payment..." />
      </Container>
    );
  }

  const paymentResultStatus = String(result?.status || "").toLowerCase();
  const booking = result?.booking || null;
  const isBookingConfirmed =
    String(booking?.bookingStatus || "").toLowerCase() === "confirmed" && Boolean(booking?.bokunBookingId);
  const isPendingFinalization = ["pending", "processing", "payment_processing", "paid_pending_finalization"].includes(
    paymentResultStatus
  ) || (paymentResultStatus === "paid" && !isBookingConfirmed);
  const requiresManualReview = paymentResultStatus === "paid_manual_review";
  const isPaid =
    isBookingConfirmed ||
    isPendingFinalization ||
    requiresManualReview ||
    String(booking?.paymentStatus || "").toLowerCase() === "paid";
  const isAgentBooking =
    Boolean(booking?.isAgentBooking) ||
    String(booking?.sourceChannel || "").toLowerCase() === "agent_portal";
  const bookingPath = booking?.bookingReference
    ? isAgentBooking
      ? `/agent/bookings/${booking.bookingReference}`
      : `/my-booking/${booking.bookingReference}`
    : "";
  const paymentStatusPath = booking?.bookingReference
    ? orderTrackingId
      ? `/payment-status/${booking.bookingReference}?OrderTrackingId=${encodeURIComponent(orderTrackingId)}`
      : ""
    : "";

  return (
    <Container className="py-4">
      <ErrorAlert error={error} className="mb-3" />

      <Card className="surface-card payment-result-card">
        <Card.Body>
          <div className="payment-result-badge-wrap">
            <Badge bg={isBookingConfirmed ? "success" : isPaid ? "warning" : "danger"}>
              {isBookingConfirmed
                ? "Booking confirmed"
                : requiresManualReview
                  ? "Payment received"
                  : isPendingFinalization
                    ? "Paid, supplier confirmation pending"
                    : "Payment not completed"}
            </Badge>
          </div>

          <h2 className="mb-2">
            {isBookingConfirmed
              ? "Booking confirmed"
              : requiresManualReview
                ? "Payment confirmed"
                : isPendingFinalization
                  ? "Confirming your booking"
                  : isPaid
                    ? "Payment successful"
                    : "Payment verification failed"}
          </h2>
          <p className="section-subtitle mb-3">
            {isBookingConfirmed
              ? "Your payment is confirmed and your booking has been processed in Bokun."
              : requiresManualReview
                ? "Your payment is confirmed. Our team will review the supplier confirmation shortly."
                : isPendingFinalization
                  ? "Your payment is confirmed. We are checking Bokun automatically and this page will update when your booking is confirmed."
                  : isPaid
                    ? "Your payment is confirmed and your booking is being processed."
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
              {isBookingConfirmed ? (
                <>
                  <div>
                    <span>Tour</span>
                    <strong>{booking.productTitle || "-"}</strong>
                  </div>
                  <div>
                    <span>Travel date</span>
                    <strong>{booking.travelDate || "-"}{booking.startTime ? ` at ${booking.startTime}` : ""}</strong>
                  </div>
                  <div>
                    <span>Amount paid</span>
                    <strong>{booking.currency || "USD"} {Number(booking.amountPaid || 0).toFixed(2)}</strong>
                  </div>
                  {booking.confirmationCode ? (
                    <div>
                      <span>Confirmation code</span>
                      <strong>{booking.confirmationCode}</strong>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          <div className="d-flex flex-wrap gap-2 mt-4">
            {isPendingFinalization ? (
              <Button variant="outline-primary" onClick={() => setRefreshKey((current) => current + 1)}>
                Check status now
              </Button>
            ) : null}
            {booking?.bookingReference ? (
              <Button as={Link} to={bookingPath} className="premium-btn text-white">
                {isAgentBooking ? "Open agent booking" : "View my booking"}
              </Button>
            ) : null}
            {paymentStatusPath ? (
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
