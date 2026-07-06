import { useEffect, useState } from "react";
import { Badge, Button, Card } from "react-bootstrap";
import { Link, useParams } from "react-router-dom";
import {
  BsArrowLeft,
  BsCalendar3,
  BsCashCoin,
  BsClock,
  BsDownload,
  BsGeoAlt,
  BsPeople,
  BsPerson,
  BsReceipt,
  BsShieldCheck,
  BsTicketPerforated,
  BsXCircle
} from "react-icons/bs";
import { fetchAgentBookingDetails, requestAgentBookingCancellation } from "../../api/agentApi";
import Loader from "../../components/common/Loader";
import ErrorAlert from "../../components/common/ErrorAlert";
import { formatCurrency, statusBadgeVariant } from "../../utils/formatters";

const InfoRow = ({ label, value }) => (
  <div className="agent-info-row modern">
    <span>{label}</span>
    <strong>{value || value === 0 ? value : "-"}</strong>
  </div>
);

const DetailPanel = ({ title, icon, children, className = "" }) => (
  <Card className={`surface-card agent-detail-panel ${className}`}>
    <Card.Body>
      <div className="agent-detail-panel-title">
        <span>{icon}</span>
        <h5>{title}</h5>
      </div>
      {children}
    </Card.Body>
  </Card>
);

const MiniStat = ({ label, value, icon, tone = "blue" }) => (
  <div className={`agent-booking-mini-stat tone-${tone}`}>
    <span>{icon}</span>
    <div>
      <small>{label}</small>
      <strong>{value || "-"}</strong>
    </div>
  </div>
);

const AgentBookingDetailsPage = () => {
  const { reference } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        setError("");
        setData(await fetchAgentBookingDetails(reference));
      } catch (err) {
        setError(err.message || "Failed to load booking details");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [reference]);

  if (loading) return <Loader message="Loading booking details..." />;

  const booking = data?.booking || {};
  const commission = data?.commission || {};
  const customerName = `${booking.customer?.firstName || ""} ${booking.customer?.lastName || ""}`.trim();
  const totalPrice = booking.pricingSnapshot?.finalPayable || booking.amount || 0;
  const latestRequest = (booking.editRequests || []).slice(-1)[0] || null;
  const paxTotal = booking.paxSummary?.total || booking.paxSummary?.adults || 0;
  const pickup = booking.customer?.hotelName || booking.invoiceSnapshot?.pickupLocation || "";
  const canRequestCancel = !["cancelled", "completed", "failed"].includes(
    String(booking.bookingStatus || "").toLowerCase()
  );

  const handleCancelRequest = async () => {
    const reason = window.prompt("Reason for cancellation request?");
    if (!reason) {
      return;
    }

    try {
      setActionLoading(true);
      setNotice("");
      setError("");
      const updated = await requestAgentBookingCancellation(booking._id, reason);
      setData((prev) => ({ ...prev, booking: updated }));
      setNotice("Cancellation request sent to admin for review.");
    } catch (err) {
      setError(err.message || "Could not send cancellation request");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="agent-booking-detail-page">
      <div className="agent-booking-detail-hero">
        <div>
          <Link to="/agent/bookings" className="agent-back-link">
            <BsArrowLeft /> Back to bookings
          </Link>
          <div className="agent-booking-hero-title">
            <div className="agent-booking-hero-icon"><BsTicketPerforated /></div>
            <div>
              <p>Booking Reference</p>
              <h2>{booking.bookingReference}</h2>
            </div>
          </div>
          <div className="agent-booking-status-row">
            <Badge bg={statusBadgeVariant(booking.bookingStatus)}>Booking: {booking.bookingStatus || "-"}</Badge>
            <Badge bg={statusBadgeVariant(booking.paymentStatus)}>Payment: {booking.paymentStatus || "-"}</Badge>
            {booking.bokunBookingId ? <Badge bg="success">Bokun confirmed</Badge> : <Badge bg="warning">Bokun pending</Badge>}
          </div>
        </div>

        <div className="agent-booking-hero-actions">
          <Button as={Link} to={`/agent/bookings/${booking.bookingReference}/voucher`} className="agent-primary-btn">
            <BsDownload className="me-2" />
            Voucher
          </Button>
          <Button type="button" variant="outline-danger" disabled={!canRequestCancel || actionLoading} onClick={handleCancelRequest}>
            <BsXCircle className="me-2" />
            Cancel Request
          </Button>
        </div>
      </div>

      <ErrorAlert error={error} />
      {notice ? <div className="alert alert-success">{notice}</div> : null}

      <div className="agent-booking-stat-strip">
        <MiniStat label="Travel Date" value={booking.travelDate} icon={<BsCalendar3 />} tone="blue" />
        <MiniStat label="Start Time" value={booking.startTime || "Flexible"} icon={<BsClock />} tone="teal" />
        <MiniStat label="Travelers" value={paxTotal ? `${paxTotal} pax` : "-"} icon={<BsPeople />} tone="purple" />
        <MiniStat label="Total Price" value={formatCurrency(totalPrice, booking.currency || "USD")} icon={<BsReceipt />} tone="green" />
        <MiniStat label="Commission" value={formatCurrency(commission.commissionAmount || 0, booking.currency || "USD")} icon={<BsCashCoin />} tone="orange" />
      </div>

      <div className="agent-booking-detail-grid">
        <DetailPanel title="Tour Details" icon={<BsTicketPerforated />} className="span-2">
          <div className="agent-tour-summary-card">
            <div>
              <small>Product</small>
              <strong>{booking.productTitle || "-"}</strong>
              <span>{booking.optionTitle || "Selected option"}</span>
            </div>
            <Badge bg="light" text="dark">{booking.priceCatalog?.title || "Default rate"}</Badge>
          </div>
          <InfoRow label="Pickup / Meeting Point" value={pickup} />
          <InfoRow label="Adults" value={booking.paxSummary?.adults} />
          <InfoRow label="Children" value={booking.paxSummary?.children} />
          <InfoRow label="Infants" value={booking.paxSummary?.infants} />
          <InfoRow label="Bokun Product ID" value={booking.bokunProductId} />
          <InfoRow label="Bokun Option ID" value={booking.bokunOptionId} />
        </DetailPanel>

        <DetailPanel title="Customer" icon={<BsPerson />}>
          <div className="agent-customer-card">
            <div className="agent-customer-avatar">{String(customerName || "C").slice(0, 1).toUpperCase()}</div>
            <div>
              <strong>{customerName || "-"}</strong>
              <span>{booking.customer?.email || "-"}</span>
            </div>
          </div>
          <InfoRow label="Phone / WhatsApp" value={booking.customer?.phone} />
          <InfoRow label="Country" value={booking.customer?.country} />
          <InfoRow label="Special Request" value={booking.pendingCheckout?.checkoutPayload?.customer?.notes} />
        </DetailPanel>

        <DetailPanel title="Payment & Commission" icon={<BsShieldCheck />}>
          <InfoRow label="Bokun Booking ID" value={booking.bokunBookingId} />
          <InfoRow label="Payment Method" value={booking.paymentMethod} />
          <InfoRow label="Total Price" value={formatCurrency(totalPrice, booking.currency || "USD")} />
          <InfoRow label="Commission" value={formatCurrency(commission.commissionAmount || 0, booking.currency || "USD")} />
          <InfoRow label="Payout Status" value={commission.payoutStatus} />
          <InfoRow label="Last Request" value={latestRequest ? `${latestRequest.reason || "Request"} (${latestRequest.status || "pending"})` : ""} />
        </DetailPanel>

        <DetailPanel title="Price Breakdown" icon={<BsReceipt />} className="span-2">
          {(booking.pricingSnapshot?.lineItems || []).length ? (
            booking.pricingSnapshot.lineItems.map((item) => (
              <InfoRow
                key={`${item.label}-${item.amount}`}
                label={item.label}
                value={formatCurrency(item.amount || 0, booking.currency || "USD")}
              />
            ))
          ) : (
            <InfoRow label="Total" value={formatCurrency(totalPrice, booking.currency || "USD")} />
          )}
          <InfoRow label="Currency" value={booking.currency || booking.pricingSnapshot?.currency} />
        </DetailPanel>

        <DetailPanel title="Pickup Support" icon={<BsGeoAlt />}>
          <p className="agent-detail-note">
            For pickup changes or supplier confirmation, contact Riser support before the travel date.
          </p>
          <InfoRow label="WhatsApp" value="+255 778 775 044" />
          <InfoRow label="Email" value="info@risertoursandsafaris.co.tz" />
        </DetailPanel>
      </div>
    </div>
  );
};

export default AgentBookingDetailsPage;
