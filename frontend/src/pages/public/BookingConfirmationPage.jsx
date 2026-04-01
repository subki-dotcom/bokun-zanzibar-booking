import { useEffect, useState } from "react";
import { Container, Card, Badge } from "react-bootstrap";
import { useParams, Link } from "react-router-dom";
import { fetchBookingByReference } from "../../api/bookingsApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import { formatCurrency, statusBadgeVariant } from "../../utils/formatters";

const BookingConfirmationPage = () => {
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
        setError(err.message || "Failed to load confirmation");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [reference]);

  if (loading) {
    return (
      <Container className="py-4">
        <Loader message="Loading confirmation..." />
      </Container>
    );
  }

  return (
    <Container className="py-4">
      <ErrorAlert error={error} />

      {booking ? (
        <Card className="surface-card">
          <Card.Body>
            <h2 className="mb-2">Booking Confirmation</h2>
            <p className="section-subtitle">Reference: {booking.bookingReference}</p>

            <div className="d-flex flex-wrap gap-2 mb-3">
              <Badge bg={statusBadgeVariant(booking.bookingStatus)}>{booking.bookingStatus}</Badge>
              <Badge bg={statusBadgeVariant(booking.paymentStatus)}>{booking.paymentStatus}</Badge>
            </div>

            <p className="mb-1">
              <strong>Tour:</strong> {booking.productTitle}
            </p>
            <p className="mb-1">
              <strong>Option:</strong> {booking.optionTitle}
            </p>
            <p className="mb-1">
              <strong>Catalog:</strong> {booking.priceCatalog?.title || "Default"}
            </p>
            <p className="mb-1">
              <strong>Date:</strong> {booking.travelDate} at {booking.startTime}
            </p>
            <p className="mb-3">
              <strong>Total:</strong> {formatCurrency(booking.pricingSnapshot?.finalPayable || 0, "USD")}
            </p>

            <Link to={`/my-booking/${booking.bookingReference}`} className="btn premium-btn text-white">
              Open My Booking
            </Link>
          </Card.Body>
        </Card>
      ) : null}
    </Container>
  );
};

export default BookingConfirmationPage;
