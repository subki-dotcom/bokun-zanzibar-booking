import { useEffect, useState } from "react";
import { Container, Row, Col, Card, Form, Button, Badge } from "react-bootstrap";
import { useNavigate, useParams, Link } from "react-router-dom";
import { fetchBookingByReference } from "../../api/bookingsApi";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";
import { formatCurrency, statusBadgeVariant } from "../../utils/formatters";

const BookingDetails = ({ booking }) => {
  return (
    <Card className="surface-card">
      <Card.Body>
        <div className="d-flex flex-wrap gap-2 mb-3">
          <Badge bg={statusBadgeVariant(booking.bookingStatus)}>{booking.bookingStatus}</Badge>
          <Badge bg={statusBadgeVariant(booking.paymentStatus)}>{booking.paymentStatus}</Badge>
        </div>

        <h4 className="mb-2">{booking.productTitle}</h4>
        <p className="section-subtitle">Option: {booking.optionTitle}</p>
        <p className="section-subtitle mb-3">Catalog: {booking.priceCatalog?.title || "Default"}</p>

        <div className="row g-3 mb-3">
          <div className="col-md-6">
            <small className="text-muted d-block">Reference</small>
            <div>{booking.bookingReference}</div>
          </div>
          <div className="col-md-6">
            <small className="text-muted d-block">Travel Date</small>
            <div>
              {booking.travelDate} {booking.startTime ? `at ${booking.startTime}` : ""}
            </div>
          </div>
          <div className="col-md-6">
            <small className="text-muted d-block">Client</small>
            <div>
              {booking.customer?.firstName} {booking.customer?.lastName}
            </div>
            <div>{booking.customer?.email}</div>
            <div>{booking.customer?.phone}</div>
          </div>
          <div className="col-md-6">
            <small className="text-muted d-block">Pax</small>
            <div>
              Adults {booking.paxSummary?.adults} | Children {booking.paxSummary?.children} | Infants {booking.paxSummary?.infants}
            </div>
          </div>
        </div>

        <h6>Extras</h6>
        {(booking.extras || []).length ? (
          <ul>
            {booking.extras.map((extra) => (
              <li key={extra.code}>
                {extra.label} x{extra.quantity}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">No extras selected.</p>
        )}

        <h6>Booking Answers</h6>
        {(booking.bookingQuestionsSnapshot || []).length ? (
          <ul>
            {booking.bookingQuestionsSnapshot.map((answer, index) => (
              <li key={`${answer.questionId}-${index}`}>
                {answer.label}: {String(answer.answer)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">No booking answers captured.</p>
        )}

        <h6>Payment Summary</h6>
        <p className="mb-1">Total: {formatCurrency(booking.pricingSnapshot?.finalPayable || 0, "USD")}</p>
        <p className="mb-1">Amount Paid: {formatCurrency(booking.invoiceSnapshot?.amountPaid || 0, "USD")}</p>
        <p className="mb-3">Balance Due: {formatCurrency(booking.invoiceSnapshot?.balanceDue || 0, "USD")}</p>

        <div className="d-flex flex-wrap gap-2">
          <Button as={Link} to={`/invoice/${booking.bookingReference}`} variant="outline-info">
            View Invoice
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
};

const MyBookingPage = () => {
  const { reference: referenceParam } = useParams();
  const navigate = useNavigate();

  const [reference, setReference] = useState(referenceParam || "");
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(Boolean(referenceParam));
  const [error, setError] = useState("");

  const loadBooking = async (bookingReference) => {
    setError("");
    setLoading(true);

    try {
      const data = await fetchBookingByReference(bookingReference);
      setBooking(data);
      navigate(`/my-booking/${bookingReference}`, { replace: true });
    } catch (err) {
      setBooking(null);
      setError(err.message || "Booking not found");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (referenceParam) {
      loadBooking(referenceParam);
    }
    // We only auto-load when URL param changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceParam]);

  return (
    <Container className="py-4">
      <Row className="justify-content-center mb-4">
        <Col md={8} lg={6}>
          <Card className="surface-card">
            <Card.Body>
              <h4 className="mb-3">Find My Booking</h4>
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!reference.trim()) return;
                  loadBooking(reference.trim());
                }}
              >
                <Form.Control
                  className="mb-3"
                  value={reference}
                  onChange={(event) => setReference(event.target.value.toUpperCase())}
                  placeholder="Enter booking reference"
                />
                <Button type="submit" className="premium-btn text-white w-100">
                  Search Booking
                </Button>
              </Form>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {loading ? <Loader message="Loading booking..." /> : null}
      <ErrorAlert error={error} />
      {booking && !loading ? <BookingDetails booking={booking} /> : null}
    </Container>
  );
};

export default MyBookingPage;
