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
  const [pollingTimedOut, setPollingTimedOut] = useState(false);

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
    const maxAttempts = 24;
    setPollingTimedOut(false);

    const requiresConfirmationPolling = (data) => {
      const status = String(data?.status || "").toLowerCase();
      const booking = data?.booking || {};
      const bookingConfirmed =
        String(booking.bookingStatus || "").toLowerCase() === "confirmed" && Boolean(booking.bokunBookingId);

      if (bookingConfirmed || ["paid_manual_review", "failed", "reversed"].includes(status)) {
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
          retryTimer = window.setTimeout(verify, 5000);
        } else if (requiresConfirmationPolling(data)) {
          setPollingTimedOut(true);
        }
      } catch (err) {
        if (!isActive) return;

        setError(err.message || "Payment verification failed.");
        attempts += 1;
        if (attempts < 6) {
          retryTimer = window.setTimeout(verify, 5000);
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
  const paymentStatus = String(result?.paymentStatus || booking?.paymentStatus || "").toLowerCase();
  const customerBookingStatus = String(result?.bookingStatus || booking?.bookingStatus || "").toLowerCase();
  const isReversed = paymentStatus === "reversed" || paymentResultStatus === "reversed" || customerBookingStatus === "reversed";
  const isPaymentFailed = paymentStatus === "failed" || paymentResultStatus === "failed" || customerBookingStatus === "failed";
  const isBookingConfirmed =
    customerBookingStatus === "confirmed" && Boolean(booking?.bokunBookingId) && !isReversed && !isPaymentFailed;
  const requiresManualReview = ["paid_manual_review", "manual_review_required", "supplier_failed"].includes(paymentResultStatus) ||
    customerBookingStatus === "manual_review_required";
  const isPaymentPending = ["initiated", "pending", "processing", "verification_error"].includes(paymentStatus) ||
    ["pending", "processing", "payment_processing"].includes(paymentResultStatus);
  const isPendingFinalization = !isPaymentPending && !isBookingConfirmed &&
    (paymentStatus === "paid" || paymentResultStatus === "paid_pending_finalization" || paymentResultStatus === "paid");
  const isPaid =
    isBookingConfirmed ||
    isPendingFinalization ||
    requiresManualReview ||
    paymentStatus === "paid";
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
  const retryPaymentPath = booking?.bookingReference ? `/payment/checkout/${booking.bookingReference}` : "";

  const badgeVariant = isBookingConfirmed ? "success" : isPaid ? "warning" : isReversed ? "secondary" : isPaymentFailed ? "danger" : "info";
  const title = isBookingConfirmed
    ? "Booking confirmed"
    : requiresManualReview
      ? "Payment received"
      : isPendingFinalization
        ? "Payment received, booking processing"
        : isReversed
          ? "Payment reversed"
          : isPaymentFailed
            ? "Payment unsuccessful"
            : "Verifying your payment";
  const description = isBookingConfirmed
    ? "Your payment is confirmed and your booking has been processed in Bokun."
    : requiresManualReview
      ? "Your payment is confirmed. Our team will review the supplier confirmation shortly."
      : isPendingFinalization
        ? "We have received your payment successfully. Your booking confirmation is being processed."
        : isReversed
          ? "If funds were reversed, they will be handled according to your payment provider's policy."
          : isPaymentFailed
            ? "Your payment could not be authorized. Please try again or use another payment method."
            : "Please wait while we confirm your transaction with Pesapal.";

  return (
    <Container className="py-4">
      <ErrorAlert error={error} className="mb-3" />

      <Card className="surface-card payment-result-card">
        <Card.Body>
          <div className="payment-result-badge-wrap">
            <Badge bg={badgeVariant}>
              {isBookingConfirmed
                ? "Booking confirmed"
                : requiresManualReview
                  ? "Payment received"
                  : isPendingFinalization
                    ? "Paid, supplier confirmation pending"
                    : isReversed
                      ? "Payment reversed"
                      : isPaymentFailed
                        ? "Payment unsuccessful"
                        : "Verifying payment"}
            </Badge>
          </div>

          <h2 className="mb-2">{title}</h2>
          <p className="section-subtitle mb-3">{description}</p>
          {pollingTimedOut && (isPaymentPending || isPendingFinalization) ? (
            <div className="payment-polling-notice" role="status">
              We are still confirming your payment. You may safely close this page. We will update your booking automatically once confirmation is received.
            </div>
          ) : null}

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
                <strong>{customerBookingStatus || "-"}</strong>
              </div>
              <div>
                <span>Payment method</span>
                <strong>{result?.paymentMethod || booking.paymentMethod || "Pesapal"}</strong>
              </div>
              <div>
                <span>Amount paid</span>
                <strong>{booking.currency || result?.currency || "USD"} {Number(result?.amountPaid || booking.amountPaid || 0).toFixed(2)}</strong>
              </div>
              {isBookingConfirmed || isPendingFinalization ? (
                <>
                  <div>
                    <span>Tour</span>
                    <strong>{booking.productTitle || "-"}</strong>
                  </div>
                  <div>
                    <span>Travel date</span>
                    <strong>{booking.travelDate || "-"}{booking.startTime ? ` at ${booking.startTime}` : ""}</strong>
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
            {(isPaymentPending || isPendingFinalization) ? (
              <Button variant="outline-primary" onClick={() => setRefreshKey((current) => current + 1)}>
                Check status now
              </Button>
            ) : null}
            {(isPaymentFailed || isReversed) && retryPaymentPath ? (
              <Button as={Link} to={retryPaymentPath} className="premium-btn text-white">
                Retry payment
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
            {booking?.bookingReference && isPaid ? (
              <Button as={Link} to={`/invoice/${booking.bookingReference}`} variant="outline-secondary">
                Download receipt
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
