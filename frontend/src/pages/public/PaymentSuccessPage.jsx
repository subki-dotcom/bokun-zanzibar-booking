import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Container } from "react-bootstrap";
import { Link, useSearchParams } from "react-router-dom";
import {
  verifyPesapalPayment,
  verifyDpoPayment,
  verifyPaypalPayment
} from "../../api/paymentsApi";
import ErrorAlert from "../../components/common/ErrorAlert";
import Loader from "../../components/common/Loader";
import { BRAND } from "../../config/brand";
import {
  notifyPesapalFrameReturn,
  readPesapalProcessingState,
  storePesapalProcessingState
} from "../../utils/pesapalProcessing";
import {
  buildPaymentResultQuery,
  getPaymentResultPresentation,
  publicPaymentRefreshError,
  shouldPollPaymentResult
} from "../../utils/publicPaymentResult";

const readParam = (searchParams, ...keys) => {
  for (const key of keys) {
    const value = String(searchParams.get(key) || "").trim();
    if (value) {
      return value;
    }
  }

  return "";
};

const PaymentSuccessPage = () => {
  const [searchParams] = useSearchParams();
  const pesapalState = useMemo(() => readPesapalProcessingState(searchParams), [searchParams]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pollingTimedOut, setPollingTimedOut] = useState(false);

  const orderTrackingId = readParam(searchParams, "OrderTrackingId", "orderTrackingId") || pesapalState.orderTrackingId;
  const orderMerchantReference =
    readParam(searchParams, "OrderMerchantReference", "orderMerchantReference") ||
    pesapalState.orderMerchantReference;
  const transactionToken = readParam(searchParams, "TransactionToken", "transactionToken", "ID");
  const paypalOrderId = readParam(searchParams, "token", "paypalOrderId");

  useEffect(() => {
    const hasPesapalReference =
      readParam(searchParams, "OrderTrackingId", "orderTrackingId") ||
      readParam(searchParams, "OrderMerchantReference", "orderMerchantReference");

    if (!hasPesapalReference) {
      return;
    }

    const checkoutKey = storePesapalProcessingState({
      checkoutKey: pesapalState.checkoutKey,
      redirectUrl: pesapalState.redirectUrl,
      orderTrackingId,
      orderMerchantReference,
      bookingReference: pesapalState.bookingReference
    });
    const cleanParams = new URLSearchParams();
    cleanParams.set("checkoutKey", checkoutKey);
    window.history.replaceState(null, "", `${window.location.pathname}?${cleanParams.toString()}`);
  }, [orderTrackingId, orderMerchantReference, pesapalState, searchParams]);

  useEffect(() => {
    let isActive = true;
    let retryTimer = null;
    let attempts = 0;
    const maxAttempts = 24;
    setPollingTimedOut(false);

    const verify = async () => {
      if (!orderTrackingId && !orderMerchantReference && !transactionToken && !paypalOrderId) {
        if (isActive) {
          setError(publicPaymentRefreshError);
          setLoading(false);
        }
        return;
      }

      try {
        const data = paypalOrderId
          ? await verifyPaypalPayment({ orderId: paypalOrderId })
          : transactionToken
            ? await verifyDpoPayment({ transactionToken })
            : await verifyPesapalPayment({
                orderTrackingId,
                orderMerchantReference
              });
        if (!isActive) return;

        setResult(data);
        setError("");

        attempts += 1;
        if (shouldPollPaymentResult(data) && attempts < maxAttempts) {
          retryTimer = window.setTimeout(verify, 5000);
        } else if (shouldPollPaymentResult(data)) {
          setPollingTimedOut(true);
        }
      } catch (err) {
        if (!isActive) return;

        setError(publicPaymentRefreshError);
        attempts += 1;
        if (attempts < 6) {
          retryTimer = window.setTimeout(verify, 5000);
        }
      } finally {
        if (isActive) {
          setLoading(false);
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
  }, [orderTrackingId, orderMerchantReference, transactionToken, paypalOrderId, refreshKey]);

  useEffect(() => {
    if (!result || (!orderTrackingId && !orderMerchantReference)) return;
    notifyPesapalFrameReturn("success");
  }, [orderMerchantReference, orderTrackingId, result]);

  if (loading) {
    return (
      <Container className="py-4">
        <Loader message="Confirming your payment..." />
      </Container>
    );
  }

  const presentation = getPaymentResultPresentation(result);
  const booking = result?.booking || null;
  const isAgentBooking =
    Boolean(booking?.isAgentBooking) ||
    String(booking?.sourceChannel || "").toLowerCase() === "agent_portal";
  const paymentStatusQuery = buildPaymentResultQuery({
    orderTrackingId,
    orderMerchantReference
  });
  const bookingReference = booking?.bookingReference || result?.bookingReference || pesapalState.bookingReference || "";
  const bookingPath = bookingReference
    ? isAgentBooking
      ? `/agent/bookings/${bookingReference}`
      : `/my-booking/${bookingReference}`
    : "";
  const paymentStatusPath =
    bookingReference && paymentStatusQuery
      ? `/payment-status/${bookingReference}?${paymentStatusQuery}`
      : "";
  const retryPaymentPath = bookingReference ? `/payment/checkout/${bookingReference}` : "";
  const supportHref = `mailto:${BRAND.email}?subject=${encodeURIComponent(`Payment support ${bookingReference || ""}`)}`;
  const canRetry = presentation.isFailed || presentation.isCancelled;
  const canCheckAgain = presentation.publicStatus === "PENDING" || presentation.publicStatus === "PAID";
  const paidAmount = Number(
    result?.amountPaid ||
      booking?.amountPaid ||
      booking?.invoiceSnapshot?.amountPaid ||
      booking?.pendingCheckout?.paidAmount ||
      booking?.pricingSnapshot?.amountPaid ||
      0
  );
  const currency = booking?.currency || booking?.invoiceSnapshot?.currency || result?.currency || "USD";
  const requiresReconciliation = Boolean(result?.reconciliationRequired);

  return (
    <Container className="py-4">
      <ErrorAlert error={error} className="mb-3" />

      <Card className={`surface-card payment-result-card payment-result-card-${presentation.publicStatus.toLowerCase()}`}>
        <Card.Body>
          <div className="payment-result-brand">
            <strong>{BRAND.name}</strong>
            <span>{BRAND.location}</span>
          </div>

          <div className="payment-result-badge-wrap">
            <Badge bg={presentation.badgeVariant}>{presentation.badge}</Badge>
          </div>

          <h2 className="mb-2">{presentation.title}</h2>
          <p className="section-subtitle mb-3">{presentation.message}</p>

          {pollingTimedOut && canCheckAgain ? (
            <div className="payment-polling-notice" role="status">
              We are still confirming this payment. You may safely close this page and check again from your booking.
            </div>
          ) : null}

          {requiresReconciliation ? (
            <div className="payment-polling-notice" role="status">
              This payment was returned from a different checkout environment. Our support team must reconcile it before the booking can be displayed here. Do not pay again.
            </div>
          ) : null}

          {bookingReference || booking ? (
            <div className="payment-result-grid">
              <div>
                <span>Booking reference</span>
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
              <div>
                <span>Payment method</span>
                <strong>{result?.paymentMethod || booking?.paymentMethod || "Pesapal"}</strong>
              </div>
              {presentation.isPaid && paidAmount > 0 ? (
                <div>
                  <span>Amount paid</span>
                  <strong>{currency} {paidAmount.toFixed(2)}</strong>
                </div>
              ) : null}
              {booking?.productTitle ? (
                <div>
                  <span>Tour</span>
                  <strong>{booking.productTitle}</strong>
                </div>
              ) : null}
              {booking?.travelDate ? (
                <div>
                  <span>Travel date</span>
                  <strong>{booking.travelDate}{booking.startTime ? ` at ${booking.startTime}` : ""}</strong>
                </div>
              ) : null}
              {presentation.isConfirmed && booking?.confirmationCode ? (
                <div>
                  <span>Confirmation code</span>
                  <strong>{booking.confirmationCode}</strong>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="d-flex flex-wrap gap-2 mt-4">
            {canCheckAgain && !requiresReconciliation ? (
              <Button variant="outline-primary" onClick={() => setRefreshKey((current) => current + 1)}>
                Check status now
              </Button>
            ) : null}
            {canRetry && retryPaymentPath && !requiresReconciliation ? (
              <Button as={Link} to={retryPaymentPath} className="premium-btn text-white">
                Try Again
              </Button>
            ) : null}
            {bookingPath && !requiresReconciliation ? (
              <Button as={Link} to={bookingPath} className="premium-btn text-white">
                View Booking
              </Button>
            ) : null}
            {paymentStatusPath && canCheckAgain && !requiresReconciliation ? (
              <Button as={Link} to={paymentStatusPath} variant="outline-primary">
                Track payment status
              </Button>
            ) : null}
            {bookingReference && presentation.isPaid && !requiresReconciliation ? (
              <Button as={Link} to={`/invoice/${bookingReference}`} variant="outline-secondary">
                Download receipt
              </Button>
            ) : null}
            <Button as="a" href={supportHref} variant="outline-secondary">
              Contact Support
            </Button>
            <Button as={Link} to={isAgentBooking ? "/agent/products" : "/tours"} variant="outline-secondary">
              {isAgentBooking ? "Back to products" : "Browse tours"}
            </Button>
          </div>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default PaymentSuccessPage;
