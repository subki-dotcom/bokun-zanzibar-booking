import { BsLock } from "react-icons/bs";
import { usePaymentProviders } from "../../context/PaymentProvidersContext";

const PaymentMethodSelector = ({
  selectedMethod = "pesapal",
  onChange,
  disabled = false,
  className = "",
  inputName = "paymentMethod",
  titleId = "payment-method-title"
}) => {
  const { availableProviders, loading, error } = usePaymentProviders();

  return (
    <section className={`payment-method-card ${className}`.trim()} aria-labelledby={titleId}>
    <div className="payment-method-head">
      <h4 id={titleId}>
        <span className="payment-method-head-icon">
          <BsLock />
        </span>
        Payment Method
      </h4>
    </div>

    {loading ? <p className="payment-method-status" role="status">Checking secure payment methods...</p> : null}
    {error ? <p className="payment-method-status is-error" role="alert">{error}</p> : null}
    {!loading && !availableProviders.length ? <p className="payment-method-status is-error" role="alert">No secure payment method is currently available. Please contact support.</p> : null}
    {availableProviders.length ? <div className="payment-method-grid" role="radiogroup" aria-label="Payment method">
      {availableProviders.map((method) => {
        const isSelected = selectedMethod === method.id;
        const isDisabled = disabled || !method.enabled;

        return (
          <label
            key={method.id}
            className={[
              "payment-method-option",
              isSelected ? "is-selected" : "",
              isDisabled ? "is-disabled" : ""
            ].filter(Boolean).join(" ")}
            title={method.title}
          >
            <input
              type="radio"
              name={inputName}
              value={method.id}
              aria-label={method.title}
              checked={isSelected}
              disabled={isDisabled}
              onChange={() => {
                if (!isDisabled) {
                  onChange?.(method.id);
                }
              }}
            />
            <span className="payment-method-logo-wrap">
              <img className="payment-method-logo" src={method.logo} alt={method.title} loading="lazy" />
            </span>
            {isSelected ? <span className="payment-method-selected-dot" aria-hidden="true" /> : null}
          </label>
        );
      })}
    </div> : null}
    </section>
  );
};

export default PaymentMethodSelector;
