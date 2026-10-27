import BrandMark from "../BrandMark";
import { Link } from "react-router-dom";
import { LuCheck, LuLock } from "react-icons/lu";
import { SITE } from "../../../config/site";
import "./siteHeader.css";

const STEPS = ["Details", "Activity", "Payment"];

// ✓ Details — ✓ Activity — (3 Payment): steps before `current` are done; `current` 3 means all are done.
export const CheckoutSteps = ({ current = 0 }) => (
  <ol className="shc-steps" aria-label="Checkout progress">
    {STEPS.map((label, index) => (
      <li key={label} className={index < current ? "is-done" : index === current ? "is-current" : ""} aria-current={index === current ? "step" : undefined}>
        {index > 0 ? <span className="shc-line" aria-hidden="true">—</span> : null}
        <span className="shc-step">
          {index < current ? <LuCheck aria-hidden="true" /> : <span className="shc-num">{index + 1}</span>}
          {label}
          {index < current ? <span className="sh-visually-hidden"> (done)</span> : null}
        </span>
      </li>
    ))}
  </ol>
);

// Checkout, payment and confirmation pages (desktop): logo, progress, help line and "Secure checkout"; no site
// navigation. With confirmLeave, the logo asks before leaving a booking that has details in it.
const CheckoutHeader = ({ step = 0, confirmLeave = false, showSteps = true }) => {
  const leave = (event) => {
    if (confirmLeave && !window.confirm("Leave checkout? Your booking is not finished yet.")) event.preventDefault();
  };
  return (
    <header className="sh shc" role="banner">
      <div className="sh-container shc-inner">
        <Link to="/" className="sh-logo" onClick={leave} aria-label={`${SITE.name} home`}>
          <span className="sh-logo-mark brand-mark-slot" aria-hidden="true"><BrandMark size="100%" /></span>
          <span className="sh-logo-text">
            <strong>{SITE.name}</strong>
          </span>
        </Link>
        {showSteps ? <CheckoutSteps current={step} /> : <span />}
        <div className="shc-help">
          <span>
            Need help? <a href={SITE.phoneHref}>{SITE.phone}</a>
          </span>
          <span className="shc-secure">
            <LuLock aria-hidden="true" /> Secure checkout
          </span>
        </div>
      </div>
    </header>
  );
};

export default CheckoutHeader;
