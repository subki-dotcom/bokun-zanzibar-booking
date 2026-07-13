import Card from "react-bootstrap/Card";
import {
  BsCalendar3,
  BsClock,
  BsEnvelope,
  BsFileEarmarkText,
  BsInfoCircle,
  BsLock,
  BsPeople,
  BsSignpostSplit,
  BsTelephone
} from "react-icons/bs";
import { formatCurrency, formatDate } from "../../utils/formatters";
import { resolveCheckoutPricing } from "./CheckoutPaymentSummaryCard";
import ConfirmActionRow from "./ConfirmActionRow";

const toSafeNumber = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatTravelDate = (value) => (value ? formatDate(value, "ddd, MMM D, YYYY") : "Not selected");

const resolveProductTitle = (tour = {}) =>
  String(tour.shortTitle || tour.title || "Tour").replace(/\s+/g, " ").trim() || "Tour";

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

const SummaryRow = ({ icon = null, label, value, className = "" }) => (
  <div className={`review-summary-row ${className}`.trim()}>
    <span>
      {icon}
      {label}
    </span>
    <strong>{value}</strong>
  </div>
);

const ReviewOrderSummarySidebar = ({
  flowState = {},
  tour = null,
  paymentMethodSelector = null,
  submitting = false,
  disableConfirm = false,
  onConfirm,
  confirmLabel = "Pay Securely",
  loadingLabel = "Redirecting to payment...",
  className = ""
}) => {
  const pricing = resolveCheckoutPricing(flowState);
  const passengerText = buildPassengerSummary(flowState.priceCategoryParticipants || [], flowState.pax || {});

  return (
    <aside className={`review-order-sidebar ${className}`.trim()}>
      <Card className="surface-card review-order-card">
        <Card.Body>
          <div className="review-section-title review-order-title">
            <span className="review-section-icon">
              <BsFileEarmarkText />
            </span>
            <h4>Order Summary</h4>
          </div>

          <div className="review-summary-lines">
            <SummaryRow icon={<BsSignpostSplit />} label="Product" value={resolveProductTitle(tour || {})} />
            <SummaryRow icon={<BsCalendar3 />} label="Date" value={formatTravelDate(flowState.travelDate)} />
            <SummaryRow icon={<BsClock />} label="Time" value={flowState.startTime || "Not selected"} />
            <SummaryRow icon={<BsPeople />} label="Travelers" value={passengerText} />
          </div>

          <div className="review-summary-pricing">
            <SummaryRow label="Subtotal" value={formatCurrency(pricing.subtotal, pricing.currency)} />
            <SummaryRow
              label={
                <>
                  Booking Fee <BsInfoCircle />
                </>
              }
              value={formatCurrency(pricing.bookingFee, pricing.currency)}
            />
            <SummaryRow
              className="review-summary-total"
              label="Total Payable"
              value={formatCurrency(pricing.finalPayable, pricing.currency)}
            />
          </div>
        </Card.Body>
      </Card>

      {paymentMethodSelector}

      <Card className="surface-card review-pay-card">
        <Card.Body>
          <ConfirmActionRow
            className="checkout-confirm-full"
            showBack={false}
            submitting={submitting}
            disableConfirm={disableConfirm}
            confirmLabel={confirmLabel}
            loadingLabel={loadingLabel}
            onConfirm={onConfirm}
            confirmIcon={<BsLock />}
          />
        </Card.Body>
      </Card>

      <Card className="surface-card review-help-card">
        <Card.Body>
          <h5>Need help?</h5>
          <p>Our support team is here to help you.</p>
          <a className="review-help-row" href="tel:+255778775044">
            <BsTelephone />
            <span>+255 778 775 044</span>
          </a>
          <a className="review-help-row" href="mailto:info@risertoursandsafaris.co.tz">
            <BsEnvelope />
            <span>info@risertoursandsafaris.co.tz</span>
          </a>
        </Card.Body>
      </Card>
    </aside>
  );
};

export default ReviewOrderSummarySidebar;
