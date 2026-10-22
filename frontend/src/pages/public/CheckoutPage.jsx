import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LuChevronLeft } from "react-icons/lu";
import "../../components/checkout/checkout.css";
import useMediaQuery from "../../hooks/useMediaQuery";
import useCheckout from "../../components/checkout/useCheckout";
import useCheckoutSteps from "../../components/checkout/useCheckoutSteps";
import { STEPS, formatMoney, fullName } from "../../components/checkout/checkoutData";
import { formatPhone } from "../../components/checkout/phone";
import { CheckoutHeader, MobileCheckoutHeader, MobileProgress } from "../../components/checkout/CheckoutHeader";
import StepCard from "../../components/checkout/StepCard";
import ContactStep from "../../components/checkout/ContactStep";
import { HelpCard, MobileOrderSummary, OrderSummary, helpWhatsappHref } from "../../components/checkout/OrderSummary";
import MobileCheckoutBar from "../../components/checkout/MobileCheckoutBar";

const INTROS = {
  contact: "We'll send your ticket and pickup time here.",
  activity: "",
  payment: "You won't be charged until you press Pay."
};

// Public checkout (mockup "Checkout" and "CheckoutMobile"): three steps in one page, with the order summary beside
// them on desktop and above them on phones. Booking, quote and payment logic live in useCheckout.
const CheckoutPage = () => {
  const navigate = useNavigate();
  const checkout = useCheckout();
  const steps = useCheckoutSteps(checkout.completed);
  const isMobile = useMediaQuery("(max-width: 767.98px)");
  const [attempts, setAttempts] = useState({ contact: 0, activity: 0, payment: 0 });
  const retry = (id) => setAttempts((current) => ({ ...current, [id]: current[id] + 1 }));

  const submitContact = () => {
    if (Object.keys(checkout.errorsFor("contact")).length) return retry("contact");
    checkout.completeContact();
    steps.goNext("contact", { ...checkout.completed, contact: true });
  };

  const barActions = { contact: submitContact };

  const goBack = () => {
    if (steps.index > 0) steps.go(STEPS[steps.index - 1].id, { replace: true });
    else navigate(checkout.tourHref);
  };

  const summaries = {
    contact: [fullName(checkout.form), checkout.form.email.trim(), formatPhone(checkout.phone.e164)].filter(Boolean).join(" · ")
  };

  const renderStep = (step, number) => {
    const status = steps.status(step.id);
    let body = null;
    if (status === "open" && step.id === "contact") body = <ContactStep checkout={checkout} attempt={attempts.contact} onNext={submitContact} />;
    return (
      <StepCard
        key={step.id}
        id={step.id}
        number={number}
        title={step.title}
        intro={INTROS[step.id]}
        status={status}
        summary={summaries[step.id] || ""}
        onEdit={() => steps.go(step.id)}
        headingRef={steps.headingRef(step.id)}
      >
        {body}
      </StepCard>
    );
  };

  return (
    <div className={`ck ${isMobile ? "is-mobile" : ""}`}>
      {isMobile ? (
        <>
          <MobileCheckoutHeader onBack={goBack} />
          <MobileProgress index={steps.index} />
          <MobileOrderSummary checkout={checkout} />
        </>
      ) : (
        <CheckoutHeader />
      )}

      <main className="ck-container">
        {isMobile ? null : (
          <>
            <Link to={checkout.tourHref} className="ck-back">
              <LuChevronLeft aria-hidden="true" /> Back to tour
            </Link>
            <h1>Complete your booking</h1>
          </>
        )}

        <div className="ck-layout">
          <div className="ck-steps">
            {checkout.loadError ? (
              <div className="ck-notice is-error" role="alert">
                <p>{checkout.loadError}</p>
                <Link to={checkout.tourHref} className="ck-btn ck-btn-small">Choose your trip again</Link>
              </div>
            ) : null}
            {checkout.soldOut ? (
              <div className="ck-notice is-error" role="alert">
                <p>
                  <strong>This time is no longer available.</strong> Please choose another date or start time.
                </p>
                <Link to={checkout.tourHref} className="ck-btn ck-btn-small">Choose another time</Link>
              </div>
            ) : null}
            {checkout.priceNotice ? (
              <div className="ck-notice" role="status">
                <p>{checkout.priceNotice} The new total is shown in your summary.</p>
                <div className="ck-notice-actions">
                  <button type="button" className="ck-btn ck-btn-small" onClick={checkout.dismissPriceNotice}>Continue</button>
                  <Link to={checkout.tourHref} className="ck-link">Change date or travelers</Link>
                </div>
              </div>
            ) : null}

            {STEPS.map((step, index) => renderStep(step, index + 1))}

            {isMobile ? (
              <div className="ck-trust">
                <p>Secure payment · Card, Mobile money, PayPal</p>
                <a className="ck-link" href={helpWhatsappHref(checkout)} target="_blank" rel="noreferrer">Need help? Chat on WhatsApp</a>
              </div>
            ) : null}
          </div>

          {isMobile ? null : (
            <aside className="ck-aside">
              <OrderSummary checkout={checkout} />
              <HelpCard checkout={checkout} />
            </aside>
          )}
        </div>
      </main>
      {isMobile ? (
        <MobileCheckoutBar
          total={checkout.total ? formatMoney(checkout.total, checkout.currency) : "—"}
          label={STEPS[steps.index].next || `Pay ${checkout.total ? formatMoney(checkout.total, checkout.currency) : ""} & book`}
          onAction={() => barActions[steps.open]?.()}
        />
      ) : null}
    </div>
  );
};

export default CheckoutPage;
