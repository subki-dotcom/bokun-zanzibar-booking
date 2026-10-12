import { useState } from "react";
import { Alert, Button, Card, Form } from "react-bootstrap";
import { BsShieldLock } from "react-icons/bs";
import { requestBookingAccessLink } from "../../api/bookingsApi";
import { takeVerificationFailure } from "../../../../shared/src/api/bookingAccess.js";
import ErrorAlert from "../common/ErrorAlert";

// The API answers "not found" for unknown references and for missing access alike, so this form is
// shown in either case. It never opens the booking itself: a single-use link is emailed to the
// address stored on the booking, and following that link opens it.
export const isBookingAccessError = (error) =>
  Number(error?.status) === 404 && ["BOOKING_NOT_FOUND", "INVOICE_NOT_FOUND"].includes(error?.code);

const BookingAccessForm = ({ reference, title = "Verify your booking" }) => {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sentMessage, setSentMessage] = useState("");
  const [error, setError] = useState("");
  const [linkFailed] = useState(() => takeVerificationFailure(reference));

  const submit = async (event) => {
    event.preventDefault();
    if (!reference || !email.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      setSentMessage(await requestBookingAccessLink({ bookingReference: reference, email: email.trim() }));
    } catch (err) {
      setError(err?.message || "We could not send a verification link. Please try again later.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="my-booking-card booking-access-card">
      <Card.Body>
        <div className="my-booking-section-head">
          <span><BsShieldLock /></span>
          <div>
            <h2>{title}</h2>
            <p>
              For your privacy, open the link in your booking email, or enter the email address used for booking{" "}
              <strong>{reference}</strong> and we will email you a secure link.
            </p>
          </div>
        </div>
        {linkFailed ? (
          <Alert variant="warning" className="mb-3">
            That verification link has expired or was already used. Request a new link below.
          </Alert>
        ) : null}
        <ErrorAlert error={error} />
        {sentMessage ? (
          <Alert variant="success" className="mb-0">{sentMessage}</Alert>
        ) : (
          <Form onSubmit={submit} className="d-flex flex-wrap gap-2 mt-2">
            <Form.Control
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email used for this booking"
              aria-label="Email used for this booking"
              required
              style={{ flex: "1 1 240px" }}
            />
            <Button type="submit" className="premium-btn text-white" disabled={submitting}>
              {submitting ? "Sending..." : "Email me a secure link"}
            </Button>
          </Form>
        )}
      </Card.Body>
    </Card>
  );
};

export default BookingAccessForm;
