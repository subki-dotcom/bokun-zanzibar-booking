import { Link } from "react-router-dom";
import { LuChevronLeft, LuLock } from "react-icons/lu";
import { BRAND } from "../../config/brand";
import { STEPS } from "./checkoutData";

// Desktop checkout header: logo and "Secure checkout" only (no site navigation while paying); the payment page adds
// its progress in the middle.
export const CheckoutHeader = ({ children = null }) => (
  <header className="ck-header">
    <div className="ck-header-inner">
      <Link to="/" className="ck-logo" aria-label={`${BRAND.name} home`}>
        <span className="ck-logo-mark" aria-hidden="true">{BRAND.name.charAt(0)}</span>
        <strong>{BRAND.name}</strong>
      </Link>
      {children}
      <span className="ck-secure">
        <LuLock aria-hidden="true" /> Secure checkout
      </span>
    </div>
  </header>
);

// Mobile header: back (previous step, or the tour on the first step), title and the secure-checkout lock.
export const MobileCheckoutHeader = ({ onBack }) => (
  <header className="ck-header ck-mheader">
    <button type="button" className="ck-icon-btn" onClick={onBack} aria-label="Back">
      <LuChevronLeft aria-hidden="true" />
    </button>
    <h1>Checkout</h1>
    <span className="ck-icon-btn ck-mheader-lock" role="img" aria-label="Secure checkout">
      <LuLock aria-hidden="true" />
    </span>
  </header>
);

// Three segments under the mobile header; the open step and those before it are filled.
export const MobileProgress = ({ index = 0 }) => (
  <div
    className="ck-progress"
    role="progressbar"
    aria-label="Checkout progress"
    aria-valuemin={1}
    aria-valuemax={STEPS.length}
    aria-valuenow={index + 1}
    aria-valuetext={`Step ${index + 1} of ${STEPS.length}: ${STEPS[index]?.title || ""}`}
  >
    {STEPS.map((step, position) => (
      <span key={step.id} className={position <= index ? "is-active" : ""} />
    ))}
  </div>
);
