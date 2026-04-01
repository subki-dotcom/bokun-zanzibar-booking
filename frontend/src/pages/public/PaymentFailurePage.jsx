import { useEffect, useState } from "react";
import { Button, Card, Container } from "react-bootstrap";
import { Link, useSearchParams } from "react-router-dom";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import { cancelPesapalPayment } from "../../api/paymentsApi";

const PaymentFailurePage = () => {
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
  const bookingId = String(searchParams.get("bookingId") || "").trim();

  useEffect(() => {
    const cancel = async () => {
      try {
        const data = await cancelPesapalPayment({
          orderTrackingId,
          orderMerchantReference,
          bookingId
        });
        setResult(data);
      } catch (err) {
        setError(err.message || "Failed to update cancelled payment status.");
      } finally {
        setLoading(false);
      }
    };

    cancel();
  }, [orderTrackingId, orderMerchantReference, bookingId]);

  if (loading) {
    return (
      <Container className="py-4">
        <Loader message="Updating payment status..." />
      </Container>
    );
  }

  return (
    <Container className="py-4">
      <ErrorAlert error={error} className="mb-3" />

      <Card className="surface-card payment-result-card payment-result-card-failed">
        <Card.Body>
          <h2 className="mb-2">Payment was not completed</h2>
          <p className="section-subtitle mb-3">
            Your booking has not been confirmed in Bokun because payment was cancelled or failed.
          </p>

          {result?.booking?.bookingReference ? (
            <p className="mb-3">
              <strong>Booking reference:</strong> {result.booking.bookingReference}
            </p>
          ) : null}

          <div className="d-flex flex-wrap gap-2">
            <Button as={Link} to="/tours" className="premium-btn text-white">
              Choose a tour again
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
