import Card from "react-bootstrap/Card";
import Button from "react-bootstrap/Button";
import { Link } from "react-router-dom";

const ConfirmationStep = ({ bookingResult }) => {
  if (!bookingResult) {
    return null;
  }

  return (
    <Card className="surface-card">
      <Card.Body>
        <h4 className="mb-2">Booking Confirmed</h4>
        <p className="section-subtitle">Your booking has been created in Bokun and saved in your customer dashboard.</p>

        <div className="d-grid gap-2 my-3">
          <div>
            <strong>Booking Reference:</strong> {bookingResult.bookingReference}
          </div>
          <div>
            <strong>Confirmation Code:</strong> {bookingResult.confirmationCode}
          </div>
          <div>
            <strong>Invoice Number:</strong> {bookingResult.invoice?.invoiceNumber}
          </div>
        </div>

        <div className="d-flex flex-wrap gap-2">
          <Button as={Link} to={`/my-booking/${bookingResult.bookingReference}`} className="premium-btn text-white">
            View My Booking
          </Button>
          <Button as={Link} to={`/booking-confirmation/${bookingResult.bookingReference}`} variant="outline-info">
            Open Confirmation Page
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
};

export default ConfirmationStep;