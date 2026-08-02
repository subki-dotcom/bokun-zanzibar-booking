import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Container } from "react-bootstrap";
import {
  BsArrowRepeat,
  BsCalendarCheck,
  BsCheckCircle,
  BsClockHistory,
  BsCreditCard,
  BsExclamationTriangle,
  BsLock,
  BsShieldCheck
} from "react-icons/bs";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { fetchPesapalPaymentStatus } from "../../api/paymentsApi";
import ErrorAlert from "../../components/common/ErrorAlert";
import {
  PESAPAL_FRAME_RETURN_MESSAGE,
  readPesapalProcessingState,
  shouldStartPesapalStatusPolling
} from "../../utils/pesapalProcessing";
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
    badge: "Payment required",
    badgeVariant: "warning",
    icon: <BsCreditCard />,
    title: "Complete your payment",
    copy: "Complete payment to confirm your booking."
  };
};

const PaymentProcessingPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const checkout = useMemo(() => readPesapalProcessingState(searchParams), [searchParams]);
  const [statusResult, setStatusResult] = useState(null);
  const [error, setError] = useState("");
  const [pollingTimedOut, setPollingTimedOut] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [checking, setChecking] = useState(false);
  const [gatewayReturned, setGatewayReturned] = useState(false);
  const paymentFrameRef = useRef(null);

  const resultQuery = buildPaymentResultQuery({
    orderTrackingId: checkout.orderTrackingId,
    orderMerchantReference: checkout.orderMerchantReference
  });
  const hasGatewayReturnParams = Boolean(
    String(searchParams.get("OrderTrackingId") || searchParams.get("orderTrackingId") || "").trim() ||
      String(searchParams.get("OrderMerchantReference") || searchParams.get("orderMerchantReference") || "").trim()
  );

  const checkStatus = useCallback(
    async ({ redirectOnTerminal = false, silent = false } = {}) => {
      if (!checkout.orderTrackingId && !checkout.orderMerchantReference) {
        if (!silent) setError(publicPaymentRefreshError);
        return "UNKNOWN";
      }

      if (!silent) {
        setChecking(true);
        setError("");
        setPollingTimedOut(false);
      }

      try {
        const data = await fetchPesapalPaymentStatus({
          orderTrackingId: checkout.orderTrackingId,
          orderMerchantReference: checkout.orderMerchantReference
        });

        setStatusResult(data);
        setError("");

        const presentation = getPaymentResultPresentation(data);
        const terminal = ["PAID", "CONFIRMED", "FAILED", "CANCELLED"].includes(presentation.publicStatus);

        if (redirectOnTerminal && terminal) {
          navigate(`/payment-success${resultQuery ? `?${resultQuery}` : ""}`, { replace: true });
        }

        return presentation.publicStatus;
      } catch (err) {
        if (!silent) setError(publicPaymentRefreshError);
        return "UNKNOWN";
      } finally {
        if (!silent) setChecking(false);
      }
    },
    [checkout.orderTrackingId, checkout.orderMerchantReference, navigate, resultQuery]
  );

  useEffect(() => {
    const handleGatewayReturn = (event) => {
      if (event.source !== paymentFrameRef.current?.contentWindow) return;
      if (event.data?.type !== PESAPAL_FRAME_RETURN_MESSAGE) return;
      setGatewayReturned(true);
    };

    window.addEventListener("message", handleGatewayReturn);
    return () => window.removeEventListener("message", handleGatewayReturn);
  }, []);

  useEffect(() => {
    const shouldPoll = shouldStartPesapalStatusPolling({
      gatewayReturned,
      hasGatewayReturnParams
    });
    if (!shouldPoll || (!checkout.orderTrackingId && !checkout.orderMerchantReference)) return undefined;

    let active = true;
    let timer = null;
    let elapsedMs = 0;
    const intervalMs = 5000;
    const timeoutMs = 180000;

    setPollingTimedOut(false);

    const poll = async () => {
      if (!active) return;
      const publicStatus = await checkStatus({ redirectOnTerminal: true, silent: true });
      if (["PAID", "CONFIRMED", "FAILED", "CANCELLED"].includes(publicStatus)) {
        active = false;
        if (timer) window.clearInterval(timer);
      }
    };

    void poll();

    timer = window.setInterval(() => {
      elapsedMs += intervalMs;

      if (elapsedMs >= timeoutMs) {
        active = false;
        window.clearInterval(timer);
        setPollingTimedOut(true);
        return;
      }

      void poll();
    }, intervalMs);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [
    checkStatus,
    checkout.orderMerchantReference,
    checkout.orderTrackingId,
    gatewayReturned,
    hasGatewayReturnParams
  ]);

  const statusMeta = resolveStatusMeta({
    statusResult,
    timedOut: pollingTimedOut,
    error
  });
  const presentation = getPaymentResultPresentation(statusResult);
  const bookingReference = statusResult?.booking?.bookingReference || checkout.bookingReference || "";
  const paymentLabel =
    !statusResult || presentation.publicStatus === "PENDING"
      ? "Awaiting payment"
      : presentation.paymentLabel;
  const bookingLabel =
    !statusResult || presentation.publicStatus === "PENDING"
      ? "Not confirmed"
      : presentation.bookingLabel;
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

        <div className="payment-processing-grid">
          <Card className="payment-processing-frame-card">
            <Card.Body>
              {checkout.redirectUrl ? (
                <>
                  {!frameLoaded ? (
                    <div className="payment-processing-frame-loading" role="status">
                      <span /> Loading secure payment...
                    </div>
                  ) : null}
                  <iframe
                    ref={paymentFrameRef}
                    className="payment-processing-iframe"
                    src={checkout.redirectUrl}
                    title="Pesapal secure payment"
                    onLoad={() => setFrameLoaded(true)}
                    allow="payment *"
                  />
                </>
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
              <div className={`payment-processing-badge is-${statusMeta.badgeVariant}`}>
                {presentation.publicStatus === "PENDING" ? <BsLock /> : statusMeta.icon}
                <span>{statusMeta.badge}</span>
              </div>

              <h2>{statusMeta.title}</h2>
              <p>{statusMeta.copy}</p>

              <div className="payment-processing-details">
                <div className="payment-processing-reference">
                  <span>Order reference</span>
                  <strong>{bookingReference || "Unavailable"}</strong>
                </div>

                <div className="payment-processing-state-row">
                  <span className={`payment-processing-state-icon is-${statusMeta.badgeVariant}`}>
                    {statusMeta.icon}
                  </span>
                  <span>Payment</span>
                  <strong>{paymentLabel}</strong>
                </div>

                <div className="payment-processing-state-row">
                  <span className="payment-processing-state-icon is-neutral">
                    <BsCalendarCheck />
                  </span>
                  <span>Booking</span>
                  <strong>{bookingLabel}</strong>
                </div>
              </div>

              {pollingTimedOut ? (
                <div className="payment-polling-notice" role="status">
                  We are still checking with Pesapal. You can reopen this page from your booking status link.
                </div>
              ) : null}

              <div className="payment-processing-actions">
                {gatewayReturned || hasGatewayReturnParams || pollingTimedOut ? (
                  <Button
                    variant="link"
                    disabled={checking}
                    onClick={() => checkStatus({ redirectOnTerminal: true })}
                  >
                    <BsArrowRepeat /> {checking ? "Checking..." : "Check payment status"}
                  </Button>
                ) : null}
                {pollingTimedOut && trackStatusPath ? (
                  <Button as={Link} to={trackStatusPath} variant="outline-secondary">
                    <BsShieldCheck /> Track status
                  </Button>
                ) : null}
                {presentation.isConfirmed && bookingPath ? (
                  <Button as={Link} to={bookingPath} variant="outline-secondary">
                    View booking
                  </Button>
                ) : null}
              </div>

              <div className="payment-processing-secure-note">
                <BsShieldCheck />
                <span>Secure payment via Pesapal</span>
              </div>
            </Card.Body>
          </Card>
        </div>
      </Container>
    </main>
  );
};

export default PaymentProcessingPage;
