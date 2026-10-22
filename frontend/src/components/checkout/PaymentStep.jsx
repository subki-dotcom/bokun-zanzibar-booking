import { LuLock } from "react-icons/lu";
import { formatMoney } from "./checkoutData";

// One payment method: a full-width radio card (native radio inside, so arrow keys move between methods).
export const PaymentMethodCard = ({ choice, selected, disabled, onSelect }) => (
  <label className={`ck-method ${selected ? "is-selected" : ""} ${disabled ? "is-disabled" : ""}`}>
    <input type="radio" name="ck-payment-method" value={choice.id} checked={selected} disabled={disabled} onChange={() => onSelect(choice.id)} />
    <span className="ck-radio" aria-hidden="true" />
    <span className="ck-method-text">
      <strong>{choice.title}</strong>
      <small>{choice.detail}</small>
    </span>
    <span className="ck-method-badge" aria-hidden="true">{choice.badge}</span>
  </label>
);

// Step 3: payment method, what happens next, and "Pay … & book" (create the booking, then the provider's page).
const PaymentStep = ({ checkout, onPay }) => {
  const { choices, selectedChoice, submitting, payError, fallbackChoice } = checkout;
  const total = checkout.total ? formatMoney(checkout.total, checkout.currency) : "";
  const blocked = checkout.soldOut || !checkout.pricing || !selectedChoice;

  return (
    <div>
      {checkout.providersLoading && !choices.length ? (
        <p className="ck-muted">Loading payment methods…</p>
      ) : !choices.length ? (
        <p className="ck-notice is-error" role="alert">
          Online payment is not available right now. Please contact us on WhatsApp to book.
        </p>
      ) : (
        <div className="ck-methods" role="radiogroup" aria-label="Payment method">
          {choices.map((choice) => (
            <PaymentMethodCard
              key={choice.id}
              choice={choice}
              selected={selectedChoice?.id === choice.id}
              disabled={submitting}
              onSelect={checkout.setMethod}
            />
          ))}
        </div>
      )}

      {selectedChoice ? (
        <p className="ck-pay-info" aria-live="polite">
          <LuLock aria-hidden="true" />
          <span>{selectedChoice.info}</span>
        </p>
      ) : null}

      {payError ? (
        <div className="ck-notice is-error ck-pay-error" role="alert">
          <p>{payError}</p>
          <div className="ck-notice-actions">
            <button type="button" className="ck-btn ck-btn-small" onClick={onPay} disabled={submitting}>Try again</button>
            {fallbackChoice ? (
              <button
                type="button"
                className="ck-link ck-link-btn"
                onClick={() => {
                  checkout.setMethod(fallbackChoice.id);
                }}
              >
                Use {fallbackChoice.title} instead
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="ck-step-actions ck-pay-actions">
        <button type="button" className="ck-btn ck-btn-pay" onClick={onPay} disabled={blocked || submitting} aria-busy={submitting || undefined}>
          {submitting ? <span className="ck-spinner" aria-hidden="true" /> : null}
          {submitting ? "Opening secure payment…" : `Pay ${total} & book`}
        </button>
      </div>
      <p className="ck-terms">
        By booking you agree to our{" "}
        <a href="/terms" target="_blank" rel="noreferrer">Terms</a> and{" "}
        <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
      </p>
    </div>
  );
};

export default PaymentStep;
