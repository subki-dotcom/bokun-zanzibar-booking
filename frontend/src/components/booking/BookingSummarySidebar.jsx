import Card from "react-bootstrap/Card";
import Badge from "react-bootstrap/Badge";
import {
  BsCalendar3,
  BsCheckCircle,
  BsClock,
  BsEnvelope,
  BsLock,
  BsPencil,
  BsPeople,
  BsShieldCheck,
  BsSignpostSplit,
  BsWhatsapp
} from "react-icons/bs";
import { formatCurrency, formatDate } from "../../utils/formatters";
import ChangeTripDetailsAction from "./ChangeTripDetailsAction";
import CheckoutPaymentSummaryCard from "./CheckoutPaymentSummaryCard";
import ConfirmActionRow from "./ConfirmActionRow";

const toSafeNumber = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatTravelDate = (value) => (value ? formatDate(value, "ddd, MMM D, YYYY") : "Not selected");

const resolveProductTitle = (tour = {}, compact = false) => {
  const rawTitle = String(tour.shortTitle || tour.title || "Tour").replace(/\s+/g, " ").trim();

  if (!compact) {
    return rawTitle || "Tour";
  }

  const afterColon = rawTitle.includes(":") ? rawTitle.split(":").pop().trim() : rawTitle;
  const withoutDayPrefix = afterColon.replace(/^(half|full)\s+day\s+/i, "").trim();

  if (/mnemba\s+island\s+tour/i.test(withoutDayPrefix)) {
    return "Mnemba Island Tour";
  }

  return withoutDayPrefix || rawTitle || "Tour";
};

const buildPassengerSummary = (rows = [], pax = {}) => {
  const selectedRows = (rows || []).filter((row) => Number(row.quantity || 0) > 0);

  if (selectedRows.length) {
    return selectedRows
      .map((row) => {
        const quantity = Number(row.quantity || 0);
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

const BookingSummarySidebar = ({
  flowState,
  tour,
  availability = null,
  quoteLoading = false,
  availabilityLoading = false,
  onChangeTripDetails,
  showPaymentSummary = false,
  showHelp = true,
  showConfirmAction = false,
  submitting = false,
  disableConfirm = false,
  onBack,
  onConfirm,
  confirmLabel = "Confirm & Pay Secure Checkout",
  loadingLabel = "Redirecting to payment...",
  className = "",
  compactProductTitle = false
}) => {
  const {
    travelDate,
    startTime,
    pax,
    priceCategoryParticipants,
    quote,
    extras,
    availabilityChecked
  } = flowState;

  const extrasRows = (extras || []).filter((item) => Number(item.quantity || 0) > 0);
  const extrasTotal = extrasRows.reduce(
    (sum, item) => sum + toSafeNumber(item.amount) * Math.max(1, toSafeNumber(item.quantity)),
    0
  );

  const quotePricing = quote?.pricing || null;
  const quoteCurrency = quotePricing?.currency || availability?.currency || "USD";
  const liveQuoteReady = Boolean(quote?.quoteToken && quotePricing);
  const liveAvailabilityReady = Boolean(availabilityChecked || availability?.available);
  const estimatedTotal = liveQuoteReady
    ? toSafeNumber(quotePricing.finalPayable)
    : toSafeNumber(availability?.pricing?.grossAmount) + extrasTotal;

  return (
    <div className={`booking-sticky checkout-side-stack ${className}`.trim()}>
      <Card className="surface-card smart-summary-card">
        <Card.Body>
          <h5 className="mb-3">Booking Summary</h5>

          <div className="checkout-status-pills">
            <Badge bg={liveAvailabilityReady ? "success-subtle" : "secondary"} text={liveAvailabilityReady ? "success" : "light"}>
              <BsShieldCheck /> Live Availability
            </Badge>
            <Badge bg={liveQuoteReady ? "info-subtle" : "warning-subtle"} text={liveQuoteReady ? "info" : "dark"}>
              <BsCheckCircle /> Instant Confirmation
            </Badge>
          </div>

          <div className="summary-line-item">
            <span><BsSignpostSplit />Product</span>
            <strong>{resolveProductTitle(tour, compactProductTitle)}</strong>
          </div>
          <div className="summary-line-item">
            <span><BsCalendar3 />Travel Date</span>
            <strong>{formatTravelDate(travelDate)}</strong>
          </div>
          <div className="summary-line-item">
            <span><BsClock />Time</span>
            <strong>{startTime || "Shown after date selection"}</strong>
          </div>
          <div className="summary-line-item">
            <span><BsPeople />Passengers</span>
            <strong>{buildPassengerSummary(priceCategoryParticipants, pax)}</strong>
          </div>

          {extrasRows.length ? (
            <div className="summary-subsection">
              <div className="summary-subtitle">Extras</div>
              {extrasRows.map((row) => (
                <div className="summary-line-item" key={row.code || row.label}>
                  <span>{row.label} x{Math.max(1, toSafeNumber(row.quantity))}</span>
                  <strong>{formatCurrency(toSafeNumber(row.amount) * Math.max(1, toSafeNumber(row.quantity)), quoteCurrency)}</strong>
                </div>
              ))}
            </div>
          ) : null}

          <hr />

          <div className="summary-line-item total-line">
            <span>Estimated Total</span>
            <strong>{formatCurrency(estimatedTotal, quoteCurrency)}</strong>
          </div>

          {quoteLoading || availabilityLoading ? (
            <small className="text-muted d-block mt-2">Refreshing live pricing...</small>
          ) : null}

          <div className="mt-3">
            <ChangeTripDetailsAction className="w-100" onClick={onChangeTripDetails} icon={<BsPencil />} label="Edit Trip Details" />
          </div>
        </Card.Body>
      </Card>

      {showPaymentSummary ? <CheckoutPaymentSummaryCard flowState={flowState} /> : null}

      {showHelp ? (
        <Card className="surface-card checkout-help-card">
          <Card.Body>
            <h5>Need help?</h5>
            <p>Our support team is here to help you</p>
            <div className="checkout-help-row">
              <BsWhatsapp />
              <span>+255 778 775 044</span>
            </div>
            <div className="checkout-help-row">
              <BsEnvelope />
              <span>info@risertoursandsafaris.co.tz</span>
            </div>
          </Card.Body>
        </Card>
      ) : null}

      {showConfirmAction ? (
        <Card className="surface-card checkout-side-confirm-card">
          <Card.Body>
            <ConfirmActionRow
              className="checkout-confirm-full"
              showBack
              submitting={submitting}
              disableConfirm={disableConfirm}
              confirmLabel={confirmLabel}
              loadingLabel={loadingLabel}
              onBack={onBack}
              onConfirm={onConfirm}
              confirmIcon={<BsLock />}
            />
          </Card.Body>
        </Card>
      ) : null}
    </div>
  );
};

export default BookingSummarySidebar;
