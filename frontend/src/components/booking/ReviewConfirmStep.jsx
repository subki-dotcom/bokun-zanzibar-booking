import Card from "react-bootstrap/Card";
import Form from "react-bootstrap/Form";
import { useEffect, useState } from "react";
import {
  BsCalendar3,
  BsCheckCircle,
  BsClock,
  BsEnvelope,
  BsGeoAlt,
  BsGlobe2,
  BsPencil,
  BsPeople,
  BsPerson,
  BsSignpostSplit,
  BsTelephone
} from "react-icons/bs";
import { formatDate } from "../../utils/formatters";

const toSafeNumber = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatTravelDate = (value) => (value ? formatDate(value, "ddd, MMM D, YYYY") : "Not selected");

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

const buildPassengerSummary = (rows = [], pax = {}) => {
  const selectedRows = (rows || []).filter((row) => Number(row.quantity || 0) > 0);

  if (selectedRows.length) {
    return selectedRows
      .map((row) => {
        const quantity = toSafeNumber(row.quantity);
        const rawTitle = String(row.title || "Passenger").trim();
        const title = quantity === 1 ? rawTitle.replace(/s$/i, "") : rawTitle;
        return `${title} x${quantity}`;
      })
      .join(", ");
  }

  const adults = toSafeNumber(pax?.adults);
  const children = toSafeNumber(pax?.children);
  const infants = toSafeNumber(pax?.infants);
  const pieces = [];

  if (adults > 0) pieces.push(`${adults === 1 ? "Adult" : "Adults"} x${adults}`);
  if (children > 0) pieces.push(`${children === 1 ? "Child" : "Children"} x${children}`);
  if (infants > 0) pieces.push(`${infants === 1 ? "Infant" : "Infants"} x${infants}`);

  return pieces.length ? pieces.join(", ") : "Adult x1";
};

const ReviewSectionCard = ({ icon, title, actionLabel = "Edit", onAction, actionDisabled = false, children }) => (
  <Card className="surface-card review-section-card">
    <Card.Body>
      <div className="review-section-head">
        <div className="review-section-title">
          <span className="review-section-icon">{icon}</span>
          <h4>{title}</h4>
        </div>
        {onAction ? (
          <button
            type="button"
            className="btn btn-outline-secondary review-edit-btn"
            onClick={onAction}
            disabled={actionDisabled}
          >
            <BsPencil />
            {actionLabel}
          </button>
        ) : null}
      </div>
      {children}
    </Card.Body>
  </Card>
);

const ReviewRows = ({ rows = [] }) => (
  <div className="review-detail-grid">
    {rows
      .filter((row) => !row.hidden)
      .map((row) => (
        <div className="review-detail-row" key={row.label}>
          <span className="review-detail-label">
            {row.icon}
            {row.label}
          </span>
          {row.badge ? (
            <strong className="review-status-badge">{row.value}</strong>
          ) : (
            <strong>{row.value}</strong>
          )}
        </div>
      ))}
  </div>
);

const ReviewConfirmStep = ({
  flowState = {},
  submitting = false,
  onEditCustomer,
  onEditTrip,
  countries = [],
  paymentMethodSelector = null,
  onApplyPromo = null,
  promoLoading = false
}) => {
  const customer = flowState.customer || {};
  const fullName = `${customer.firstName || ""} ${customer.lastName || ""}`.trim();
  const passengerText = buildPassengerSummary(flowState.priceCategoryParticipants || [], flowState.pax || {});
  const pickupAddress = String(customer.hotelName || "").trim();
  const [promoCode, setPromoCode] = useState(flowState.promoCode || "");
  const [promoMessage, setPromoMessage] = useState("");

  useEffect(() => {
    setPromoCode(flowState.promoCode || "");
  }, [flowState.promoCode]);

  const applyPromo = async () => {
    const result = await onApplyPromo?.(promoCode);
    if (!result) return;
    setPromoMessage(result.applied ? `Promo applied: ${result.name || "discount added"}.` : "No active promotion matched this code.");
  };

  const bookedRows = [
    {
      icon: <BsSignpostSplit />,
      label: "Option",
      value: flowState.option?.name || "Not selected"
    },
    {
      icon: <BsCalendar3 />,
      label: "Travel Date",
      value: formatTravelDate(flowState.travelDate)
    },
    {
      icon: <BsClock />,
      label: "Time",
      value: flowState.startTime || "Not selected"
    },
    {
      icon: <BsPeople />,
      label: "Passengers",
      value: passengerText
    },
    {
      icon: <BsGeoAlt />,
      label: "Pickup Address",
      value: pickupAddress,
      hidden: !pickupAddress
    },
    {
      icon: <BsCheckCircle />,
      label: "Status",
      value: flowState.availabilityChecked ? "Live availability checked" : "Pending recheck",
      badge: true
    }
  ];

  const customerRows = [
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
      icon: <BsGlobe2 />,
      label: "Country",
      value: resolveCountryLabel(customer.country, countries)
    }
  ];

  return (
    <div className="checkout-review-stack">
      <ReviewSectionCard
        icon={<BsCalendar3 />}
        title="Booked Option"
        actionLabel="Change"
        onAction={onEditTrip}
        actionDisabled={submitting}
      >
        <ReviewRows rows={bookedRows} />
      </ReviewSectionCard>

      <ReviewSectionCard
        icon={<BsPerson />}
        title="Customer Details"
        onAction={onEditCustomer}
        actionDisabled={submitting}
      >
        <ReviewRows rows={customerRows} />
      </ReviewSectionCard>

      <Card className="surface-card checkout-promo-card">
        <Card.Body>
          <h4>Promo code</h4>
          <div className="checkout-promo-form">
            <Form.Control
              value={promoCode}
              onChange={(event) => setPromoCode(event.target.value.toUpperCase())}
              placeholder="Enter promo code"
              aria-label="Promo code"
              disabled={promoLoading || submitting}
            />
            <button type="button" className="btn btn-outline-success" onClick={applyPromo} disabled={promoLoading || submitting || (!promoCode.trim() && !flowState.promoCode)}>
              {promoLoading ? "Checking..." : promoCode.trim() ? "Apply" : "Remove"}
            </button>
          </div>
          {promoMessage ? <p className="checkout-promo-message" role="status">{promoMessage}</p> : null}
        </Card.Body>
      </Card>

      {paymentMethodSelector}
    </div>
  );
};

export default ReviewConfirmStep;
