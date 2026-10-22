import { useEffect, useRef, useState } from "react";
import { LuChevronLeft, LuCreditCard, LuShield } from "react-icons/lu";
import { BRAND } from "../../config/brand";
import { formatMoney } from "../checkout/checkoutData";
import { PaymentMethodCard } from "../checkout/PaymentStep";
import { whatsappReferenceHref } from "./paymentData";

const LOAD_TIMEOUT_MS = 15000;

const PROVIDER_LINE = {
  pesapal: "Card or mobile money · processed by Pesapal",
  dpo: "Card payment · processed by DPO",
  paypal: "PayPal"
};

// Another payment method for the same booking (never a new booking).
export const MethodPicker = ({ choices, current, busy, onPick, onCancel }) => {
  const [picked, setPicked] = useState(current || choices[0]?.id || "");
  const choice = choices.find((item) => item.id === picked) || null;
  return (
    <div className="pf-methods">
      <h2 className="pf-methods-title">Choose how to pay</h2>
      <div className="ck-methods" role="radiogroup" aria-label="Payment method">
        {choices.map((item) => (
          <PaymentMethodCard key={item.id} choice={item} selected={picked === item.id} disabled={busy} onSelect={setPicked} />
        ))}
      </div>
      <div className="pf-methods-actions">
        <button type="button" className="ck-btn" disabled={!choice || busy} onClick={() => onPick(choice)} aria-busy={busy || undefined}>
          {busy ? <span className="ck-spinner" aria-hidden="true" /> : null}
          Continue with {choice?.title.toLowerCase() || "this method"}
        </button>
        <button type="button" className="ck-link ck-link-btn" onClick={onCancel} disabled={busy}>Keep the current method</button>
      </div>
    </div>
  );
};

// Pay page main card: the provider's page embedded, with a loader, a 15-second fallback and help links.
const PayScreen = ({ data, headingRef, choices = [], switching = false, picking = false, onPicking, onSwitchMethod, onLoadError, onFrameReturn }) => {
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const frameRef = useRef(null);
  const provider = data.session?.provider || "pesapal";
  const currentChoice = choices.find((item) => item.provider === provider)?.id || "";

  // No load within 15 seconds: the problem page offers to try again.
  useEffect(() => {
    if (loaded || picking) return undefined;
    const timer = setTimeout(() => onLoadError?.(), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loaded, picking, attempt, onLoadError]);

  // The provider's return page inside the frame tells this page the payment step ended.
  useEffect(() => {
    const onMessage = (event) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (event.data?.type === "riser:pesapal-frame-return") onFrameReturn?.();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onFrameReturn]);

  const reload = () => {
    setLoaded(false);
    setAttempt((value) => value + 1);
  };

  return (
    <section className="ck-card pf-main" aria-labelledby="pf-title">
      <div className="pf-pay-head">
        <div>
          <h1 id="pf-title" tabIndex={-1} ref={headingRef}>Pay securely</h1>
          <p>{PROVIDER_LINE[provider] || PROVIDER_LINE.pesapal}</p>
        </div>
        <div className="pf-amount">
          <small>Amount due</small>
          <strong>{formatMoney(data.amount, data.currency)}</strong>
        </div>
      </div>

      {picking ? (
        <MethodPicker
          choices={choices}
          current={currentChoice}
          busy={switching}
          onCancel={() => onPicking?.(false)}
          onPick={async (choice) => {
            if (choice.provider === provider) {
              onPicking?.(false);
              return;
            }
            const done = await onSwitchMethod?.(choice.provider);
            if (done !== false) onPicking?.(false);
          }}
        />
      ) : (
        <div className="pf-frame">
          {!loaded ? (
            <div className="pf-frame-loading" role="status">
              <span className="pf-spinner" aria-hidden="true" />
              <LuCreditCard aria-hidden="true" />
              <strong>Loading secure payment…</strong>
            </div>
          ) : null}
          <iframe
            key={attempt}
            ref={frameRef}
            src={data.session.redirectUrl}
            title="Secure payment form"
            allow="payment *"
            onLoad={() => setLoaded(true)}
            className={loaded ? "is-loaded" : ""}
          />
        </div>
      )}

      <div className="pf-trust">
        <span><LuShield aria-hidden="true" /> 256-bit encrypted</span>
        <span>We never see or store your card number</span>
        <span className="pf-trust-logos" aria-label="Accepted: Visa, Mastercard, M-Pesa">VISA · Mastercard · M-Pesa</span>
      </div>

      <div className="pf-help">
        <span>Having trouble?</span>
        <button type="button" className="ck-link ck-link-btn" onClick={reload}>Reload payment form</button>
        {choices.length > 1 ? (
          <button type="button" className="ck-link ck-link-btn" onClick={() => onPicking?.(true)}>Use another payment method</button>
        ) : null}
        {BRAND.whatsappHref ? (
          <a className="ck-link" href={whatsappReferenceHref(BRAND.whatsappHref, data.bookingReference, data.tour?.title)} target="_blank" rel="noreferrer">
            Chat on WhatsApp
          </a>
        ) : null}
      </div>
    </section>
  );
};

export const ChangeMethodLink = ({ onClick }) => (
  <button type="button" className="pf-back ck-link-btn" onClick={onClick}>
    <LuChevronLeft aria-hidden="true" /> Change payment method
  </button>
);

export default PayScreen;
