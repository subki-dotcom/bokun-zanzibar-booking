import Card from "react-bootstrap/Card";
import {
  BsEnvelope,
  BsGeoAlt,
  BsLock,
  BsPencil,
  BsPerson,
  BsShieldCheck,
  BsTelephone
} from "react-icons/bs";
import { isCustomerSummaryValid } from "./CustomerSummaryCard";
import ConfirmActionRow from "./ConfirmActionRow";
import CheckoutPaymentSummaryCard from "./CheckoutPaymentSummaryCard";

const resolveCountryLabel = (countryCode = "", countries = []) => {
  const rawValue = String(countryCode || "").trim();
  if (!rawValue) return "Not selected";

  const match = (countries || []).find(
    (country = {}) => String(country.code || "").toUpperCase() === rawValue.toUpperCase()
  );

  if (match) {
    return match.label || `${match.title || match.name || rawValue} (${match.code || rawValue})`;
  }

  return rawValue;
};

const buildCustomerRows = (customer = {}, countries = []) => {
  const fullName = `${customer.firstName || ""} ${customer.lastName || ""}`.trim();

  return [
    {
      icon: <BsPerson />,
      label: "Name",
      value: fullName || "Not provided"
    },
    {
      icon: <BsEnvelope />,
      label: "Email",
      value: customer.email || "Not provided"
    },
    {
      icon: <BsTelephone />,
      label: "Phone",
      value: customer.phone || "Not provided"
    },
    {
      icon: <BsShieldCheck />,
      label: "Country",
      value: resolveCountryLabel(customer.country, countries)
    },
    {
      icon: <BsGeoAlt />,
      label: "Pickup Address",
      value: customer.hotelName || "Not selected"
    }
  ];
};

const ReviewConfirmStep = ({
  flowState = {},
  submitting = false,
  onBack,
  onConfirm,
  onEditCustomer,
  countries = [],
  showPaymentSummary = true,
  mobileReviewSidebar = null
}) => {
  const customer = flowState.customer || {};
  const customerValid = isCustomerSummaryValid(customer);
  const hasQuoteToken = Boolean(flowState?.quote?.quoteToken);
  const disableConfirm = !customerValid || !hasQuoteToken;
  const rows = buildCustomerRows(customer, countries);

  return (
    <div className="checkout-review-stack">
      <Card className="surface-card smart-step-card review-confirm-main-card checkout-readonly-card">
        <Card.Body>
          <div className="review-confirm-header checkout-readonly-head">
            <div>
              <h4 className="mb-1">Customer Details</h4>
            </div>
            <div className="completed-trip-head-actions">
              <span className="checkout-review-mode-pill">
                <BsLock />
                Review mode
              </span>
              <button
                type="button"
                className="btn btn-outline-secondary change-trip-btn"
                onClick={onEditCustomer}
                disabled={submitting}
              >
                <BsPencil />
                Edit
              </button>
            </div>
          </div>

          <div className="checkout-readonly-table mt-3">
            {rows.map((row) => (
              <div className="checkout-readonly-row" key={row.label}>
                <span className="checkout-readonly-label">
                  {row.icon}
                  {row.label}
                </span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
        </Card.Body>
      </Card>

      {mobileReviewSidebar ? (
        <div className="checkout-mobile-review-sidebar-slot">
          {mobileReviewSidebar}
        </div>
      ) : null}

      {showPaymentSummary ? (
        <>
          <CheckoutPaymentSummaryCard flowState={flowState} />
          <Card className="surface-card smart-step-card checkout-confirm-card">
            <Card.Body>
              <ConfirmActionRow
                submitting={submitting}
                disableConfirm={disableConfirm}
                confirmLabel="Confirm & Pay Secure Checkout"
                loadingLabel="Redirecting to Pesapal..."
                onBack={onBack}
                onConfirm={onConfirm}
                confirmIcon={<BsLock />}
              />
            </Card.Body>
          </Card>
        </>
      ) : null}
    </div>
  );
};

export default ReviewConfirmStep;
