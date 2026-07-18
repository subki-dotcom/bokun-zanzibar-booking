import { useEffect, useState } from "react";
import { Button, Card, Container } from "react-bootstrap";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import { cancelDpoPayment, cancelPaypalPayment, cancelPesapalPayment } from "../../api/paymentsApi";

const PaymentFailurePage = () => {
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const navigate = useNavigate();

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
  const bookingId = String(searchParams.get("bookingId") || "").trim();

  useEffect(() => {
    const cancel = async () => {
      try {
        const data = paypalOrderId
          ? await cancelPaypalPayment({ orderId: paypalOrderId, bookingId })
          : transactionToken
            ? await cancelDpoPayment({ transactionToken, bookingId })
            : await cancelPesapalPayment({
                orderTrackingId,
                orderMerchantReference,
                bookingId
              });
        setResult(data);
        const status = String(data?.status || "").toLowerCase();
        if (["paid", "processing", "pending", "paid_pending_finalization", "paid_manual_review"].includes(status)) {
          const trackingId = orderTrackingId || data?.orderTrackingId || "";
          const query = trackingId ? `?OrderTrackingId=${encodeURIComponent(trackingId)}` : "";
          navigate(`/payment-success${query}`, { replace: true });
          return;
        }
      } catch (err) {
        setError(err.message || "Failed to update cancelled payment status.");
      } finally {
        setLoading(false);
      }
    };

    cancel();
  }, [orderTrackingId, orderMerchantReference, transactionToken, paypalOrderId, bookingId]);

  if (loading) {
    return (
      <Container className="py-4">
        <Loader message="Updating payment status..." />
      </Container>
    );
  }

  const status = String(result?.status || "").toLowerCase();
  const isReversed = status === "reversed" || String(result?.booking?.paymentStatus || "").toLowerCase() === "reversed";
  const isFailed = status === "failed" || String(result?.booking?.paymentStatus || "").toLowerCase() === "failed";
  const bookingReference = result?.booking?.bookingReference || "";
  const retryPath = bookingReference ? `/payment/checkout/${bookingReference}` : "";

  return (
    <Container className="py-4">
      <ErrorAlert error={error} className="mb-3" />

      <Card className={`surface-card payment-result-card ${isFailed ? "payment-result-card-failed" : ""}`}>
        <Card.Body>
          <h2 className="mb-2">{isReversed ? "Payment reversed" : "Payment unsuccessful"}</h2>
          <p className="section-subtitle mb-3">
            {isReversed
              ? "If funds were reversed, they will be handled according to your payment provider's policy."
              : "Your payment could not be authorized. Please try again or use another payment method."}
          </p>

          {bookingReference ? (
            <p className="mb-3">
              <strong>Booking reference:</strong> {bookingReference}
            </p>
          ) : null}

          <div className="d-flex flex-wrap gap-2">
            {retryPath ? (
              <Button as={Link} to={retryPath} className="premium-btn text-white">
                Retry payment
              </Button>
            ) : (
              <Button as={Link} to="/tours" className="premium-btn text-white">
                Choose a tour again
              </Button>
            )}
            <Button as={Link} to={retryPath || "/tours"} variant="outline-primary">
              Choose another payment method
            </Button>
            <Button as={Link} to="/my-booking" variant="outline-secondary">
              Check my booking
            </Button>
          </div>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default PaymentFailurePage;
