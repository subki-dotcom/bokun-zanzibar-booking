import { useState } from "react";
import { Link } from "react-router-dom";
import { LuClock, LuMessageCircle } from "react-icons/lu";
import { BRAND } from "../../config/brand";
import { formatMoney } from "../checkout/checkoutData";
import { MethodPicker } from "./PayScreen";
import { PROBLEM_COPY, whatsappReferenceHref } from "./paymentData";

// Payment problem page (mockup "PayIssue"): what happened, a way to finish paying, and help. Recoverable, so no red.
const ProblemScreen = ({ data, kind, headingRef, choices = [], busy = false, checking = false, actionError = "", checkResult = "", onContinue, onCheck }) => {
  const [picking, setPicking] = useState(false);
  const copy = PROBLEM_COPY[kind] || PROBLEM_COPY.expired;
  const amount = data ? formatMoney(data.amount, data.currency) : "";
  const tourHref = data?.tour?.slug ? `/tours/${data.tour.slug}` : "/tours";
  const whatsapp = whatsappReferenceHref(BRAND.whatsappHref, data?.bookingReference, data?.tour?.title);

  return (
    <section className="ck-card pf-main pf-problem" aria-labelledby="pf-title">
      <span className="pf-problem-icon" aria-hidden="true"><LuClock /></span>
      <h1 id="pf-title" tabIndex={-1} ref={headingRef}>{copy.title}</h1>
      <p className="pf-lead">
        {copy.lead[0]}
        <strong>{copy.lead[1]}</strong>
        {copy.lead[2]}
      </p>

      {actionError ? <p className="ck-notice is-error pf-inline" role="alert">{actionError}</p> : null}

      {picking ? (
        <MethodPicker
          choices={choices}
          current={choices.find((item) => item.provider === data?.provider)?.id || ""}
          busy={busy}
          onCancel={() => setPicking(false)}
          onPick={async (choice) => {
            const done = await onContinue?.(choice.provider);
            if (done !== false) setPicking(false);
          }}
        />
      ) : (
        <>
          {copy.action === "pay" ? (
            <button type="button" className="ck-btn pf-primary" onClick={() => onContinue?.()} disabled={busy} aria-busy={busy || undefined}>
              {busy ? <span className="ck-spinner" aria-hidden="true" /> : null}
              Continue to payment{amount ? ` · ${amount}` : ""}
            </button>
          ) : copy.action === "check" ? (
            <button type="button" className="ck-btn pf-primary" onClick={onCheck} disabled={checking} aria-busy={checking || undefined}>
              {checking ? <span className="ck-spinner" aria-hidden="true" /> : null}
              Check payment status
            </button>
          ) : (
            <Link to={tourHref} className="ck-btn pf-primary">Choose a new date</Link>
          )}

          {copy.action === "pay" ? (
            <div className="pf-secondary">
              {choices.length > 1 ? (
                <button type="button" className="pf-outline" onClick={() => setPicking(true)} disabled={busy}>Use another payment method</button>
              ) : null}
              <button type="button" className="pf-outline" onClick={onCheck} disabled={checking} aria-busy={checking || undefined}>
                {checking ? "Checking…" : "Already paid? Check status"}
              </button>
            </div>
          ) : null}
        </>
      )}

      <p className="pf-check-result" aria-live="polite">{checkResult}</p>

      <div className="pf-why">
        <strong>Why did this happen?</strong>
        <p>{copy.why}</p>
      </div>

      <div className="pf-help pf-help-problem">
        <span>Need help? We reply fast.</span>
        {whatsapp ? (
          <a className="ck-link" href={whatsapp} target="_blank" rel="noreferrer">
            <LuMessageCircle aria-hidden="true" /> WhatsApp us your reference
          </a>
        ) : null}
        <a className="pf-help-mail" href={`mailto:${BRAND.email}`}>{BRAND.email}</a>
      </div>
    </section>
  );
};

// While the payment provider confirms: a calm wait, announced to screen readers.
export const ProcessingScreen = ({ headingRef }) => (
  <section className="ck-card pf-main pf-center" aria-labelledby="pf-title" aria-busy="true">
    <span className="pf-spinner" aria-hidden="true" />
    <h1 id="pf-title" tabIndex={-1} ref={headingRef} className="pf-processing-title">Confirming your payment…</h1>
    <p className="pf-processing-text" role="status">This usually takes a few seconds. Please keep this page open and don't pay again.</p>
  </section>
);

// The link itself could not be opened (wrong or incomplete key).
export const LinkErrorScreen = ({ message, headingRef }) => (
  <section className="ck-card pf-main pf-problem" aria-labelledby="pf-title">
    <span className="pf-problem-icon" aria-hidden="true"><LuClock /></span>
    <h1 id="pf-title" tabIndex={-1} ref={headingRef}>We couldn't open this payment link</h1>
    <p className="pf-lead">{message} <strong>No money has been taken.</strong></p>
    <div className="pf-help pf-help-problem">
      <span>Need help? We reply fast.</span>
      {BRAND.whatsappHref ? <a className="ck-link" href={BRAND.whatsappHref} target="_blank" rel="noreferrer"><LuMessageCircle aria-hidden="true" /> WhatsApp us</a> : null}
      <a className="pf-help-mail" href={`mailto:${BRAND.email}`}>{BRAND.email}</a>
    </div>
  </section>
);

export default ProblemScreen;
