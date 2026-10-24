import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LuCheck } from "react-icons/lu";
import "../../components/checkout/checkout.css";
import "../../components/payment/payment.css";
import useMediaQuery from "../../hooks/useMediaQuery";
import { fetchBookingPaymentStatus, openBookingPaymentSession } from "../../api/paymentsApi";
import { usePaymentProviders } from "../../context/PaymentProvidersContext";
import { readPesapalProcessingState } from "../../utils/pesapalProcessing";
import { paymentChoices } from "../../components/checkout/checkoutData";
import { CheckoutHeader } from "../../components/checkout/CheckoutHeader";
import PayScreen, { ChangeMethodLink } from "../../components/payment/PayScreen";
import ProblemScreen, { LinkErrorScreen, ProcessingScreen } from "../../components/payment/ProblemScreen";
import { CompactSummary, PaySummary, ProblemSummary } from "../../components/payment/PaymentSummary";
import { confirmedHref, problemKind, screenFor } from "../../components/payment/paymentData";

const POLL_MS = 3000;
const POLL_LIMIT_MS = 60000;

const Progress = () => (
  <ol className="pf-progress" aria-label="Checkout progress">
    <li className="is-done"><LuCheck aria-hidden="true" /> Details</li>
    <li aria-hidden="true" className="pf-progress-line">—</li>
    <li className="is-done"><LuCheck aria-hidden="true" /> Activity</li>
    <li aria-hidden="true" className="pf-progress-line">—</li>
    <li className="is-current" aria-current="step">3 Payment</li>
  </ol>
);

// /payment-processing?checkoutKey=…&bookingReference=… : the payment pages (mockups "Pay" and "PayIssue"). The screen
// comes from the booking's payment status on the server, so the link works in any browser.
const PaymentFlowPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width: 767.98px)");
  const legacy = useMemo(() => readPesapalProcessingState(searchParams), [searchParams]);
  const reference = String(searchParams.get("bookingReference") || legacy.bookingReference || "").trim();
  const key = String(searchParams.get("checkoutKey") || "").trim();
  const { availableProviders } = usePaymentProviders();
  const choices = useMemo(() => paymentChoices(availableProviders.map((provider) => provider.id)), [availableProviders]);

  const [data, setData] = useState(null);
  const [linkError, setLinkError] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [picking, setPicking] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [stillProcessing, setStillProcessing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState("");
  const headingRef = useRef(null);

  const load = useCallback(
    async ({ recheck = false } = {}) => {
      if (!reference || !key) {
        setLinkError("This payment link is incomplete. Please open it again from your email, or contact us with your booking reference.");
        return null;
      }
      try {
        const result = await fetchBookingPaymentStatus(reference, { key, recheck });
        setData(result);
        setLinkError("");
        return result;
      } catch (error) {
        setLinkError(error.message || "We could not open this payment link.");
        return null;
      }
    },
    [reference, key]
  );

  useEffect(() => {
    load();
  }, [load]);

  const base = screenFor(data);
  const screen = linkError
    ? "link_error"
    : base === "confirmed" || base === "loading"
      ? base
      : (waiting || base === "processing") && !stillProcessing
        ? "processing"
        : base === "pay" && !loadError && !waiting
          ? "pay"
          : "problem";

  // Paid: the confirmation page.
  useEffect(() => {
    if (screen === "confirmed" && data) navigate(confirmedHref({ reference: data.bookingReference, key: data.key || key }), { replace: true });
  }, [screen, data, navigate, key]);

  // While a payment is being confirmed, ask the provider again every 3 seconds for up to a minute; then the problem
  // page offers "Check payment status" (never a second payment).
  useEffect(() => {
    if (screen !== "processing") return undefined;
    const started = Date.now();
    const timer = setInterval(async () => {
      const result = await load({ recheck: true });
      const settled = result && result.status !== "processing" && !(waiting && result.status === "awaiting_payment");
      if (settled) {
        setWaiting(false);
        clearInterval(timer);
      } else if (Date.now() - started > POLL_LIMIT_MS) {
        setWaiting(false);
        setStillProcessing(true);
        clearInterval(timer);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [screen, load, waiting]);

  // Focus follows the screen.
  useEffect(() => {
    if (screen !== "loading") headingRef.current?.focus({ preventScroll: true });
  }, [screen]);

  const openSession = useCallback(
    async (provider = "") => {
      setBusy(true);
      setActionError("");
      setCheckResult("");
      try {
        const result = await openBookingPaymentSession(reference, { key, provider });
        if (result.session?.redirectUrl && result.session.provider && result.session.provider !== "pesapal") {
          window.location.assign(result.session.redirectUrl);
          return true;
        }
        setData(result);
        setLoadError(false);
        setStillProcessing(result.status === "processing");
        return true;
      } catch (error) {
        setActionError(error.message || "We could not open the payment page. Please try again.");
        if (error.code === "TRIP_DATE_PASSED" || error.code === "TRIP_UNAVAILABLE") await load();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reference, key, load]
  );

  // "Already paid? Check status": the provider is asked, and the answer is shown here.
  const checkStatus = useCallback(async () => {
    setChecking(true);
    setCheckResult("");
    const result = await load({ recheck: true });
    setChecking(false);
    if (!result) return;
    if (result.status === "paid") {
      setCheckResult("Payment confirmed.");
    } else if (result.status === "processing") {
      setStillProcessing(true);
      setCheckResult("Your payment is still being confirmed. Please check again in a minute.");
    } else {
      setCheckResult("We haven't received a payment for this booking yet. If you paid a moment ago, please check again in a minute.");
    }
  }, [load]);

  const statusLabel = screen === "processing" || (data?.status === "processing") ? "Confirming payment" : data?.status === "cancelled" ? "Cancelled" : "Awaiting payment";
  const aside = screen === "pay" ? <PaySummary data={data} /> : <ProblemSummary data={data} statusLabel={statusLabel} />;

  let main;
  if (screen === "pay") {
    main = (
      <PayScreen
        data={data}
        headingRef={headingRef}
        choices={choices}
        switching={busy}
        picking={picking}
        onPicking={setPicking}
        onSwitchMethod={openSession}
        onLoadError={() => setLoadError(true)}
        onFrameReturn={() => setWaiting(true)}
      />
    );
  } else if (screen === "loading" || screen === "confirmed") {
    main = (
      <section className="ck-card pf-main pf-center" aria-busy="true">
        <span className="pf-spinner" aria-hidden="true" />
        <h1 tabIndex={-1} ref={headingRef} className="pf-loading-title">{screen === "confirmed" ? "Payment confirmed" : "Loading your booking…"}</h1>
      </section>
    );
  } else if (screen === "processing") {
    main = <ProcessingScreen headingRef={headingRef} />;
  } else if (screen === "link_error") {
    main = <LinkErrorScreen message={linkError} headingRef={headingRef} />;
  } else {
    main = (
      <ProblemScreen
        data={data}
        kind={problemKind(data, loadError, stillProcessing)}
        headingRef={headingRef}
        choices={choices}
        busy={busy}
        checking={checking}
        actionError={actionError}
        checkResult={checkResult}
        onContinue={openSession}
        onCheck={checkStatus}
      />
    );
  }

  return (
    <div className="ck pf">
      <CheckoutHeader>{isMobile || screen !== "pay" ? null : <Progress />}</CheckoutHeader>
      <main className="ck-container pf-container">
        {screen === "pay" ? <ChangeMethodLink onClick={() => setPicking(true)} /> : null}
        <div className="pf-layout">
          {isMobile && data ? <CompactSummary data={data} /> : null}
          <div className="pf-main-col">{main}</div>
          {isMobile || screen === "link_error" ? null : <aside className="pf-aside">{aside}</aside>}
        </div>
      </main>
    </div>
  );
};

export default PaymentFlowPage;
