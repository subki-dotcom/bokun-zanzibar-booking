import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Col, Container, Form, Row } from "react-bootstrap";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  BsCalendar2Check,
  BsCashCoin,
  BsCheckCircle,
  BsClock,
  BsEnvelope,
  BsFileEarmarkText,
  BsGeoAlt,
  BsPeople,
  BsPerson,
  BsSearch,
  BsShieldCheck,
  BsXCircle,
  BsTelephone
} from "react-icons/bs";
import { fetchBookingByReference } from "../../api/bookingsApi";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";
import ManageBookingCard from "../../components/bookingRequests/ManageBookingCard";
import CancellationPolicyPanel from "../../components/cancellation/CancellationPolicyPanel";
import { formatCurrency, statusBadgeVariant } from "../../utils/formatters";
import { buildCancellationTimeline } from "../../utils/cancellationPolicy";

const formatDate = (value = "") => {
  if (!value) return "-";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "2-digit",
    year: "numeric"
  });
};

const InfoRow = ({ icon, label, value, strong = false }) => (
  <div className="my-booking-info-row">
    <span>{icon}</span>
    <div>
      <small>{label}</small>
      <strong className={strong ? "is-strong" : ""}>{value || "-"}</strong>
    </div>
  </div>
);

const formatDateTime = (value = "") => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
};

const friendlyStatus = (value = "") => String(value || "not_required").replaceAll("_", " ");

const CancellationStatusCard = ({ booking, currency }) => {
  const fallbackRequest = booking.bookingStatus === "cancelled"
    ? {
        type: "cancel_booking",
        status: "completed",
        createdAt: booking.cancellation?.cancelledAt || booking.updatedAt,
        completedAt: booking.cancellation?.cancelledAt || booking.updatedAt,
        bokunSync: { status: "synced", syncedAt: booking.cancellation?.cancelledAt || booking.updatedAt },
        refund: {
          status: Number(booking.invoiceSnapshot?.amountRefunded || 0) > 0 ? "refunded" : "not_required",
          confirmedRefundedAmount: Number(booking.invoiceSnapshot?.amountRefunded || 0)
        }
      }
    : null;
  const request = booking.cancellationRequest || fallbackRequest;
  if (!request) return null;

  const refund = request.refund || {};
  const refundAmount = Number(refund.approvedAmount ?? refund.eligibleAmount ?? 0);
  const refundedAmount = Number(refund.confirmedRefundedAmount || booking.invoiceSnapshot?.amountRefunded || 0);
  const supplierConfirmed = request.bokunSync?.status === "synced" || booking.bookingStatus === "cancelled";

  return (
    <Card className="my-booking-card">
      <Card.Body>
        <div className="my-booking-section-head">
          <span><BsXCircle /></span>
          <div>
            <h2>Cancellation Status</h2>
            <p>{supplierConfirmed ? "Your booking cancellation is confirmed with the supplier." : "Your cancellation request is being reviewed with the supplier."}</p>
          </div>
        </div>

        <div className="my-booking-info-grid">
          <InfoRow icon={<BsFileEarmarkText />} label="Request reference" value={request.requestReference || booking.bookingReference} strong />
          <InfoRow icon={<BsCalendar2Check />} label="Cancellation requested" value={formatDateTime(request.createdAt)} />
          <InfoRow icon={<BsShieldCheck />} label="Supplier status" value={supplierConfirmed ? "Cancelled in Bokun" : friendlyStatus(request.bokunSync?.status)} strong />
          <InfoRow icon={<BsCashCoin />} label="Refund status" value={friendlyStatus(refund.status)} />
          <InfoRow icon={<BsCashCoin />} label="Approved refund" value={refundAmount > 0 ? formatCurrency(refundAmount, currency) : "Awaiting review"} />
          <InfoRow icon={<BsCashCoin />} label="Amount refunded" value={formatCurrency(refundedAmount, currency)} strong />
        </div>

        {request.adminDecision?.customerFacingReason ? <p className="text-muted mt-3 mb-0">{request.adminDecision.customerFacingReason}</p> : null}
        <div className="cancellation-status-timeline mt-3">
          {buildCancellationTimeline(request, currency).map((step) => (
            <div className={`cancellation-status-step ${step.done ? "is-done" : ""} ${step.active ? "is-active" : ""}`} key={step.label}>
              <span />
              <div>
                <strong>{step.label}</strong>
                <small>{step.text}</small>
              </div>
            </div>
          ))}
        </div>
      </Card.Body>
    </Card>
  );
};

const BookingDetails = ({ booking }) => {
  const currency = booking.pricingSnapshot?.currency || booking.currency || "USD";
  const total = Number(booking.pricingSnapshot?.finalPayable || booking.amount || 0);
  const amountPaid = Number(booking.invoiceSnapshot?.amountPaid || 0);
  const amountRefunded = Number(booking.invoiceSnapshot?.amountRefunded || booking.cancellationRequest?.refund?.confirmedRefundedAmount || 0);
  const netPaid = Number(booking.invoiceSnapshot?.netAmountPaid ?? Math.max(0, amountPaid - amountRefunded));
  const balanceDue = Number(booking.invoiceSnapshot?.balanceDue ?? Math.max(0, total - amountPaid));
  const hasPendingSupplier =
    booking.paymentStatus === "paid" &&
    (Boolean(booking.pendingCheckout?.finalizationPending) || !booking.bokunBookingId);
  const isCancelled = booking.bookingStatus === "cancelled" || Boolean(booking.cancellation?.cancelledAt);
  const hasCancellationRequest = Boolean(booking.cancellationRequest);
  const travelerName = `${booking.customer?.firstName || ""} ${booking.customer?.lastName || ""}`.trim();

  const statusCopy = isCancelled
    ? "Your booking has been cancelled. Cancellation and refund status are shown below."
    : hasCancellationRequest
      ? "Your cancellation request is being tracked. Supplier and refund status are shown below."
    : hasPendingSupplier
      ? "Paid, supplier confirmation pending. We have received your payment and are waiting for supplier confirmation."
      : "Your booking details are saved and ready to review.";

  return (
    <div className="my-booking-result">
      <section className="my-booking-hero">
        <div>
          <div className="my-booking-eyebrow">Booking Reference</div>
          <h1>{booking.bookingReference}</h1>
          <p>{statusCopy}</p>
          <div className="my-booking-status-row">
            <Badge bg={statusBadgeVariant(booking.paymentStatus)}>{booking.paymentStatus || "payment"}</Badge>
            <Badge bg={statusBadgeVariant(booking.bookingStatus)}>{booking.bookingStatus || "booking"}</Badge>
            {booking.cancellationRequest ? <Badge bg="warning" text="dark">Cancellation request</Badge> : null}
            {hasPendingSupplier ? <Badge bg="warning" text="dark">Paid, supplier confirmation pending</Badge> : null}
          </div>
        </div>
        <div className="my-booking-total-panel">
          <small>Total Payable</small>
          <strong>{formatCurrency(total, currency)}</strong>
          <span>{booking.paymentMethod || "Payment method pending"}</span>
        </div>
      </section>

      <Row className="g-3 align-items-start">
        <Col lg={8}>
          <Card className="my-booking-card">
            <Card.Body>
              <div className="my-booking-section-head">
                <span><BsCalendar2Check /></span>
                <div>
                  <h2>Trip Details</h2>
                  <p>{booking.productTitle}</p>
                </div>
              </div>

              <div className="my-booking-info-grid">
                <InfoRow icon={<BsFileEarmarkText />} label="Selected option" value={booking.optionTitle} strong />
                <InfoRow icon={<BsCalendar2Check />} label="Travel date" value={formatDate(booking.travelDate)} />
                <InfoRow icon={<BsClock />} label="Start time" value={booking.startTime || "-"} />
                <InfoRow
                  icon={<BsPeople />}
                  label="Passengers"
                  value={`Adults ${booking.paxSummary?.adults || 0} | Children ${booking.paxSummary?.children || 0} | Infants ${booking.paxSummary?.infants || 0}`}
                />
                <InfoRow icon={<BsGeoAlt />} label="Pickup location" value={booking.customer?.hotelName || booking.invoiceSnapshot?.pickupLocation} strong />
                <InfoRow icon={<BsShieldCheck />} label="Catalog" value={booking.priceCatalog?.title || "Default"} />
              </div>
            </Card.Body>
          </Card>

          <Card className="my-booking-card">
            <Card.Body>
              <div className="my-booking-section-head">
                <span><BsCashCoin /></span>
                <div>
                  <h2>Payment Summary</h2>
                  <p>Payment and invoice information for this booking</p>
                </div>
              </div>

              <div className="my-booking-payment-lines">
                <div>
                  <span>Subtotal</span>
                  <strong>{formatCurrency(booking.invoiceSnapshot?.subtotal || total, currency)}</strong>
                </div>
                <div>
                  <span>Amount Paid</span>
                  <strong>{formatCurrency(amountPaid, currency)}</strong>
                </div>
                {amountRefunded > 0 || booking.cancellationRequest ? (
                  <div>
                    <span>Amount Refunded</span>
                    <strong>{formatCurrency(amountRefunded, currency)}</strong>
                  </div>
                ) : null}
                {amountRefunded > 0 || booking.cancellationRequest ? (
                  <div>
                    <span>Net Paid</span>
                    <strong>{formatCurrency(netPaid, currency)}</strong>
                  </div>
                ) : null}
                <div className="is-total">
                  <span>Balance Due</span>
                  <strong>{formatCurrency(balanceDue, currency)}</strong>
                </div>
              </div>

              <div className="my-booking-action-row">
                {booking.paymentStatus !== "paid" ? (
                  <Button as={Link} to={`/payment/checkout/${booking.bookingReference}`} variant="success">
                    Pay Now
                  </Button>
                ) : null}
                <Button as={Link} to={`/payment-status/${booking.bookingReference}`} variant="outline-primary">
                  Track Status
                </Button>
                <Button as={Link} to={`/invoice/${booking.bookingReference}`} className="premium-btn text-white">
                  <BsFileEarmarkText /> View Invoice
                </Button>
              </div>
            </Card.Body>
          </Card>

          <CancellationStatusCard booking={booking} currency={currency} />

          <Card className="my-booking-card">
            <Card.Body>
              <CancellationPolicyPanel
                policy={booking.cancellationPolicy}
                currency={currency}
                amountPaid={amountPaid}
                showAmounts
              />
            </Card.Body>
          </Card>

          <ManageBookingCard booking={booking} />
        </Col>

        <Col lg={4}>
          <div className="my-booking-side-stack">
            <Card className="my-booking-card">
              <Card.Body>
                <div className="my-booking-section-head is-compact">
                  <span><BsPerson /></span>
                  <div>
                    <h2>Customer</h2>
                    <p>Primary contact</p>
                  </div>
                </div>

                <div className="my-booking-contact-list">
                  <InfoRow icon={<BsPerson />} label="Name" value={travelerName} strong />
                  <InfoRow icon={<BsEnvelope />} label="Email" value={booking.customer?.email} />
                  <InfoRow icon={<BsTelephone />} label="Phone" value={booking.customer?.phone} />
                  <InfoRow icon={<BsGeoAlt />} label="Country" value={booking.customer?.country} />
                </div>
              </Card.Body>
            </Card>

            <Card className="my-booking-help-card">
              <Card.Body>
                <h2>Need Help?</h2>
                <p>Our support team can help with pickup, payment, and supplier confirmation.</p>
                <div className="my-booking-help-contact">
                  <span><BsTelephone /></span>
                  <div>
                    <small>WhatsApp</small>
                    <strong>+255 778 775 044</strong>
                  </div>
                </div>
                <div className="my-booking-help-contact">
                  <span><BsEnvelope /></span>
                  <div>
                    <small>Email</small>
                    <strong>info@risertoursandsafaris.co.tz</strong>
                  </div>
                </div>
              </Card.Body>
            </Card>
          </div>
        </Col>
      </Row>
    </div>
  );
};

const MyBookingPage = () => {
  const { reference: referenceParam } = useParams();
  const navigate = useNavigate();

  const [reference, setReference] = useState(referenceParam || "");
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(Boolean(referenceParam));
  const [error, setError] = useState("");

  const normalizedReference = useMemo(() => reference.trim().toUpperCase(), [reference]);

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
    <main className="my-booking-page">
      <Container className="my-booking-shell">
        <section className="my-booking-search-band">
          <div>
            <div className="my-booking-eyebrow">Riser Tours & Safaris</div>
            <h1>My Booking</h1>
            <p>Review your trip details, payment status, pickup information, and invoice.</p>
          </div>

          <Form
            className="my-booking-search"
            onSubmit={(event) => {
              event.preventDefault();
              if (!normalizedReference) return;
              loadBooking(normalizedReference);
            }}
          >
            <Form.Control
              value={reference}
              onChange={(event) => setReference(event.target.value.toUpperCase())}
              placeholder="Enter booking reference"
            />
            <Button type="submit" className="premium-btn text-white">
              <BsSearch /> Search
            </Button>
          </Form>
        </section>

        {loading ? <Loader message="Loading booking..." /> : null}
        <ErrorAlert error={error} />
        {booking && !loading ? <BookingDetails booking={booking} /> : null}
      </Container>
    </main>
  );
};

export default MyBookingPage;
