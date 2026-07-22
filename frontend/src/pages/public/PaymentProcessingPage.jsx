import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Container } from "react-bootstrap";
import {
  BsArrowRepeat,
  BsBoxArrowUpRight,
  BsCheckCircle,
  BsClockHistory,
  BsCreditCard,
  BsExclamationTriangle,
  BsShieldCheck
} from "react-icons/bs";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { fetchPesapalPaymentStatus } from "../../api/paymentsApi";
import ErrorAlert from "../../components/common/ErrorAlert";
import { readPesapalProcessingState } from "../../utils/pesapalProcessing";

const SUCCESS_STATUSES = new Set(["paid", "paid_pending_finalization", "paid_manual_review"]);
const FAILURE_STATUSES = new Set(["failed", "reversed"]);

const buildPesapalResultQuery = ({ orderTrackingId = "", orderMerchantReference = "" } = {}) => {
  const params = new URLSearchParams();
  if (orderTrackingId) {
    params.set("OrderTrackingId", orderTrackingId);
  }
  if (orderMerchantReference) {
    params.set("OrderMerchantReference", orderMerchantReference);
  }
  return params.toString();
};

const resolveStatusMeta = ({ statusResult = null, timedOut = false, error = "" } = {}) => {
  const status = String(statusResult?.status || "").toLowerCase();
  const paymentStatus = String(statusResult?.paymentStatus || statusResult?.booking?.paymentStatus || "").toLowerCase();
  const bookingStatus = String(statusResult?.bookingStatus || statusResult?.booking?.bookingStatus || "").toLowerCase();

  if (SUCCESS_STATUSES.has(status) || paymentStatus === "paid") {
    return {
      badge: "Payment received",
      badgeVariant: "success",
      icon: <BsCheckCircle />,
      title: "Payment received",
      copy: "We have received the payment update and are finalizing your booking."
    };
  }

  if (
    FAILURE_STATUSES.has(status) ||
    ["failed", "reversed", "cancelled"].includes(paymentStatus) ||
    ["failed", "reversed", "cancelled"].includes(bookingStatus)
  ) {
    return {
      badge: "Payment unsuccessful",
      badgeVariant: "danger",
      icon: <BsExclamationTriangle />,
      title: "Payment unsuccessful",
      copy: "The gateway reported that this payment did not complete."
    };
  }

  if (error) {
    return {
      badge: "Checking again",
      badgeVariant: "warning",
      icon: <BsArrowRepeat />,
      title: "Still checking payment",
      copy: "We could not confirm the latest gateway status yet."
    };
  }

  if (timedOut) {
    return {
      badge: "Still processing",
      badgeVariant: "warning",
      icon: <BsClockHistory />,
      title: "Still processing",
      copy: "The payment provider has not returned a final result yet."
    };
  }

  return {
    badge: "Waiting for confirmation",
    badgeVariant: "info",
    icon: <BsCreditCard />,
    title: "Waiting for payment",
    copy: "Complete the mobile money prompt while we check the transaction in the background."
  };
};

const PaymentProcessingPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const checkout = useMemo(() => readPesapalProcessingState(searchParams), [searchParams]);
  const [statusResult, setStatusResult] = useState(null);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [pollingTimedOut, setPollingTimedOut] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);

  const resultQuery = buildPesapalResultQuery({
    orderTrackingId: checkout.orderTrackingId,
    orderMerchantReference: checkout.orderMerchantReference
  });

  useEffect(() => {
    let isActive = true;
    let retryTimer = null;
    let attempts = 0;
    const maxAttempts = 60;
    setPollingTimedOut(false);

    const verify = async () => {
      if (!checkout.orderTrackingId && !checkout.orderMerchantReference) {
        if (isActive) {
          setError("Payment reference is missing. Please reopen checkout from your booking.");
        }
        return;
      }

      try {
        const data = await fetchPesapalPaymentStatus({
          orderTrackingId: checkout.orderTrackingId,
          orderMerchantReference: checkout.orderMerchantReference
        });
        if (!isActive) return;

        setStatusResult(data);
        setError("");

        const status = String(data?.status || "").toLowerCase();
        const paymentStatus = String(data?.paymentStatus || data?.booking?.paymentStatus || "").toLowerCase();
        const bookingStatus = String(data?.bookingStatus || data?.booking?.bookingStatus || "").toLowerCase();
        const bookingConfirmed =
          bookingStatus === "confirmed" && Boolean(data?.booking?.bokunBookingId);
        const paymentReceived =
          SUCCESS_STATUSES.has(status) ||
          bookingConfirmed ||
          paymentStatus === "paid";
        const paymentFailed =
          FAILURE_STATUSES.has(status) ||
          ["failed", "reversed", "cancelled"].includes(paymentStatus) ||
          ["failed", "reversed", "cancelled"].includes(bookingStatus);

        if (paymentReceived) {
          navigate(`/payment-success${resultQuery ? `?${resultQuery}` : ""}`, { replace: true });
          return;
        }

        if (paymentFailed) {
          navigate(`/payment-failure${resultQuery ? `?${resultQuery}` : ""}`, { replace: true });
          return;
        }

        attempts += 1;
        if (attempts < maxAttempts) {
          retryTimer = window.setTimeout(verify, 5000);
        } else {
          setPollingTimedOut(true);
        }
      } catch (err) {
        if (!isActive) return;

        setError(err.message || "Could not confirm payment status yet.");
        attempts += 1;
        if (attempts < maxAttempts) {
          retryTimer = window.setTimeout(verify, 5000);
        } else {
          setPollingTimedOut(true);
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
  }, [checkout.orderTrackingId, checkout.orderMerchantReference, navigate, refreshKey, resultQuery]);

  const statusMeta = resolveStatusMeta({
    statusResult,
    timedOut: pollingTimedOut,
    error
  });
  const latestMessage = statusResult?.message || statusMeta.copy;
  const bookingReference = statusResult?.booking?.bookingReference || checkout.bookingReference || "";
  const isAgentBooking =
    Boolean(statusResult?.booking?.isAgentBooking) ||
    String(statusResult?.booking?.sourceChannel || "").toLowerCase() === "agent_portal";
  const bookingPath = bookingReference
    ? isAgentBooking
      ? `/agent/bookings/${bookingReference}`
      : `/my-booking/${bookingReference}`
    : "";
  const trackStatusPath =
    bookingReference && resultQuery
      ? `/payment-status/${bookingReference}?${resultQuery}`
      : "";

  return (
    <main className="payment-processing-page">
      <Container className="payment-processing-shell">
        <ErrorAlert error={error} className="mb-3" />

        <div className="payment-processing-head">
          <div>
            <div className="payment-status-eyebrow">Riser Secure Payment</div>
            <h1>{statusMeta.title}</h1>
            <p>{latestMessage}</p>
          </div>
          <Badge bg={statusMeta.badgeVariant}>{statusMeta.badge}</Badge>
        </div>

        <div className="payment-processing-grid">
          <Card className="payment-processing-frame-card">
            <Card.Body>
              <div className="payment-processing-frame-head">
                <div>
                  <strong>Pesapal checkout</strong>
                  <span>{frameLoaded ? "Gateway loaded" : "Loading gateway"}</span>
                </div>
                {checkout.redirectUrl ? (
                  <Button
                    as="a"
                    href={checkout.redirectUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="outline-primary"
                    size="sm"
                  >
                    <BsBoxArrowUpRight /> Open
                  </Button>
                ) : null}
              </div>

              {checkout.redirectUrl ? (
                <iframe
                  className="payment-processing-iframe"
                  src={checkout.redirectUrl}
                  title="Pesapal secure payment"
                  onLoad={() => setFrameLoaded(true)}
                  allow="payment *"
                />
              ) : (
                <div className="payment-processing-empty">
                  <BsExclamationTriangle />
                  <strong>Payment page unavailable</strong>
                  <span>We can still check the payment status from the reference.</span>
                </div>
              )}
            </Card.Body>
          </Card>

          <Card className="payment-processing-status-card">
            <Card.Body>
              <div className={`payment-processing-icon is-${statusMeta.badgeVariant}`}>
                {statusMeta.icon}
              </div>
              <h2>{statusMeta.title}</h2>
              <p>{latestMessage}</p>

              <div className="payment-processing-details">
                <div>
                  <span>Booking</span>
                  <strong>{bookingReference || "-"}</strong>
                </div>
                <div>
                  <span>Gateway status</span>
                  <strong>{statusResult?.status || "checking"}</strong>
                </div>
                <div>
                  <span>Payment status</span>
                  <strong>{statusResult?.paymentStatus || statusResult?.booking?.paymentStatus || "pending"}</strong>
                </div>
              </div>

              {pollingTimedOut ? (
                <div className="payment-polling-notice" role="status">
                  We are still checking with Pesapal. You can reopen this page from your booking status link.
                </div>
              ) : null}

              <div className="payment-processing-actions">
                <Button variant="outline-primary" onClick={() => setRefreshKey((current) => current + 1)}>
                  <BsArrowRepeat /> Check now
                </Button>
                {trackStatusPath ? (
                  <Button as={Link} to={trackStatusPath} variant="outline-secondary">
                    <BsShieldCheck /> Track status
                  </Button>
                ) : null}
                {bookingPath ? (
                  <Button as={Link} to={bookingPath} variant="outline-secondary">
                    View booking
                  </Button>
                ) : null}
              </div>
            </Card.Body>
          </Card>
        </div>
      </Container>
    </main>
  );
};

export default PaymentProcessingPage;
