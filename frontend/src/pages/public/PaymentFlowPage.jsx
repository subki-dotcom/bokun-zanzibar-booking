import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LuCheck } from "react-icons/lu";
import "../../components/checkout/checkout.css";
import "../../components/payment/payment.css";
import { BRAND } from "../../config/brand";
import useMediaQuery from "../../hooks/useMediaQuery";
import { fetchBookingPaymentStatus, openBookingPaymentSession } from "../../api/paymentsApi";
import { usePaymentProviders } from "../../context/PaymentProvidersContext";
import { readPesapalProcessingState } from "../../utils/pesapalProcessing";
import { paymentChoices } from "../../components/checkout/checkoutData";
import { CheckoutHeader } from "../../components/checkout/CheckoutHeader";
import PayScreen, { ChangeMethodLink } from "../../components/payment/PayScreen";
import { CompactSummary, PaySummary, ProblemSummary } from "../../components/payment/PaymentSummary";
import { PROBLEM_COPY, problemKind, screenFor } from "../../components/payment/paymentData";

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

const PaymentFooter = () => (
  <footer className="pf-footer">
    <a href="/terms" target="_blank" rel="noreferrer">Terms</a>
    <span aria-hidden="true">·</span>
    <a href="/privacy" target="_blank" rel="noreferrer">Privacy</a>
    <span aria-hidden="true">·</span>
    <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a>
    <span aria-hidden="true">·</span>
    <a href={BRAND.phoneHref}>{BRAND.phone}</a>
  </footer>
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

  const screen = linkError ? "link_error" : waiting ? "processing" : loadError && data ? "problem" : screenFor(data);

  // Paid: the confirmation page.
  useEffect(() => {
    if (screen === "confirmed" && data) navigate(`/my-booking/${encodeURIComponent(data.bookingReference)}`, { replace: true });
  }, [screen, data, navigate]);

  // While a payment is being confirmed, ask again every 3 seconds for up to a minute.
  useEffect(() => {
    if (screen !== "processing") return undefined;
    const started = Date.now();
    const timer = setInterval(async () => {
      const result = await load({ recheck: true });
      if ((result && result.status !== "processing" && result.status !== "awaiting_payment") || Date.now() - started > POLL_LIMIT_MS) {
        setWaiting(false);
        clearInterval(timer);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [screen, load]);

  // Focus follows the screen.
  useEffect(() => {
    if (screen !== "loading") headingRef.current?.focus({ preventScroll: true });
  }, [screen]);

  const openSession = useCallback(
    async (provider = "") => {
      setBusy(true);
      setActionError("");
      try {
        const result = await openBookingPaymentSession(reference, { key, provider });
        if (result.session?.redirectUrl && result.session.provider && result.session.provider !== "pesapal") {
          window.location.assign(result.session.redirectUrl);
          return true;
        }
        setData(result);
        setLoadError(false);
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

  const aside = screen === "pay" ? <PaySummary data={data} /> : <ProblemSummary data={data} />;

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
        <h1 tabIndex={-1} ref={headingRef} className="pf-loading-title">Loading secure payment…</h1>
      </section>
    );
  } else {
    // Placeholder for the problem and processing screens (step 3).
    const kind = problemKind(data, loadError);
    main = (
      <section className="ck-card pf-main" aria-labelledby="pf-title">
        <h1 id="pf-title" tabIndex={-1} ref={headingRef}>
          {screen === "link_error" ? "We couldn't open this payment link" : screen === "processing" ? "Confirming your payment…" : PROBLEM_COPY[kind].title}
        </h1>
        <p>{screen === "link_error" ? linkError : screen === "processing" ? "This usually takes a few seconds." : PROBLEM_COPY[kind].why}</p>
        {actionError ? <p className="ck-notice is-error" role="alert">{actionError}</p> : null}
        {screen === "problem" && data?.trip?.bookable !== false ? (
          <button type="button" className="ck-btn pf-primary" onClick={() => openSession()} disabled={busy}>
            {busy ? <span className="ck-spinner" aria-hidden="true" /> : null}
            Continue to payment
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <div className="ck pf">
      <CheckoutHeader>{isMobile ? null : <Progress />}</CheckoutHeader>
      <main className="ck-container pf-container">
        {screen === "pay" ? <ChangeMethodLink onClick={() => setPicking(true)} /> : null}
        <div className="pf-layout">
          {isMobile && data ? <CompactSummary data={data} /> : null}
          <div className="pf-main-col">{main}</div>
          {isMobile ? null : <aside className="pf-aside">{aside}</aside>}
        </div>
      </main>
      <PaymentFooter />
    </div>
  );
};

export default PaymentFlowPage;
