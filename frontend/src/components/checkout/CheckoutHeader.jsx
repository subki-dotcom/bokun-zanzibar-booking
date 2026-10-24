import { LuChevronLeft, LuLock } from "react-icons/lu";
import { STEPS } from "./checkoutData";

// The desktop checkout header is the site header's checkout variant (components/common/siteHeader).

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
