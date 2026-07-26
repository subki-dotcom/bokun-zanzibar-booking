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
import {
  buildPaymentResultQuery,
  getPaymentResultPresentation,
  publicPaymentRefreshError
} from "../../utils/publicPaymentResult";

const resolveStatusMeta = ({ statusResult = null, timedOut = false, error = "" } = {}) => {
  const presentation = getPaymentResultPresentation(statusResult);

  if (presentation.publicStatus === "PAID" || presentation.publicStatus === "CONFIRMED") {
    return {
      badge: presentation.badge,
      badgeVariant: "success",
      icon: <BsCheckCircle />,
      title: presentation.title,
      copy: presentation.message
    };
  }

  if (presentation.publicStatus === "FAILED" || presentation.publicStatus === "CANCELLED") {
    return {
      badge: presentation.badge,
      badgeVariant: presentation.badgeVariant,
      icon: <BsExclamationTriangle />,
      title: presentation.title,
      copy: presentation.message
    };
  }

  if (error) {
    return {
      badge: "Checking again",
      badgeVariant: "warning",
      icon: <BsArrowRepeat />,
      title: "Still checking payment",
      copy: publicPaymentRefreshError
    };
  }

  if (timedOut) {
    return {
      badge: "Still processing",
      badgeVariant: "warning",
      icon: <BsClockHistory />,
      title: "Still processing",
      copy: "Your payment is being processed. Please wait while we confirm it."
    };
  }

  return {
    badge: presentation.badge,
    badgeVariant: presentation.badgeVariant,
    icon: <BsCreditCard />,
    title: presentation.title,
    copy: presentation.message
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

  const resultQuery = buildPaymentResultQuery({
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
          setError(publicPaymentRefreshError);
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

        const presentation = getPaymentResultPresentation(data);
        const paymentReceived = ["PAID", "CONFIRMED"].includes(presentation.publicStatus);
        const paymentFailed = ["FAILED", "CANCELLED"].includes(presentation.publicStatus);

        if (paymentReceived) {
          navigate(`/payment-success${resultQuery ? `?${resultQuery}` : ""}`, { replace: true });
          return;
        }

        if (paymentFailed) {
          navigate(`/payment-success${resultQuery ? `?${resultQuery}` : ""}`, { replace: true });
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

        setError(publicPaymentRefreshError);
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
  const presentation = getPaymentResultPresentation(statusResult);
  const latestMessage = statusMeta.copy;
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
                  <span>Payment</span>
                  <strong>{presentation.paymentLabel}</strong>
                </div>
                <div>
                  <span>Booking confirmation</span>
                  <strong>{presentation.bookingLabel}</strong>
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
