import Card from "react-bootstrap/Card";
import Badge from "react-bootstrap/Badge";
import {
  BsCalendar3,
  BsCashStack,
  BsCheckCircle,
  BsClock,
  BsEnvelope,
  BsPencil,
  BsPeople,
  BsShieldCheck,
  BsSignpostSplit,
  BsWhatsapp,
  BsGeoAlt,
  BsLock
} from "react-icons/bs";
import { formatCurrency, formatDate } from "../../utils/formatters";
import ChangeTripDetailsAction from "./ChangeTripDetailsAction";

const toSafeNumber = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatTravelDate = (value) => (value ? formatDate(value, "ddd, MMM D, YYYY") : "Not selected");

const BookingSummarySidebar = ({
  flowState,
  tour,
  availability = null,
  quoteLoading = false,
  availabilityLoading = false,
  onChangeTripDetails
}) => {
  const {
    option,
    travelDate,
    startTime,
    pax,
    priceCategoryParticipants,
    priceCatalog,
    quote,
    extras,
    availabilityChecked
  } = flowState;

  const paxRows = (priceCategoryParticipants || []).filter((row) => Number(row.quantity || 0) > 0);
  const paxSummary = paxRows.length
    ? paxRows.map((row) => `${row.title || "Passenger"} x${row.quantity}`).join(", ")
    : `Adults ${toSafeNumber(pax?.adults)} | Children ${toSafeNumber(pax?.children)} | Infants ${toSafeNumber(pax?.infants)}`;

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
    <div className="booking-sticky checkout-side-stack">
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
            <strong>{tour?.title || "Tour"}</strong>
          </div>
          <div className="summary-line-item">
            <span><BsPencil />Selected Option</span>
            <strong>{option?.name || "Not selected"}</strong>
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
            <strong>{paxSummary}</strong>
          </div>
          <div className="summary-line-item">
            <span><BsGeoAlt />Pickup Location</span>
            <strong>{flowState.customer?.hotelName || "Select in customer details"}</strong>
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
            <span><BsCashStack />Estimated Total</span>
            <strong>{formatCurrency(estimatedTotal, quoteCurrency)}</strong>
          </div>

          {quoteLoading || availabilityLoading ? (
            <small className="text-muted d-block mt-2">Refreshing live pricing...</small>
          ) : null}

          <div className="mt-3">
            <ChangeTripDetailsAction className="w-100" onClick={onChangeTripDetails} icon={<BsPencil />} label="Change Trip Details" />
          </div>
        </Card.Body>
      </Card>

      <Card className="surface-card checkout-trust-card">
        <Card.Body>
          <h5>Why book with us?</h5>
          {[
            ["Best Price Guarantee", "We offer the best prices for all our tours", <BsShieldCheck />],
            ["Secure Payments", "Your payment is 100% secure", <BsLock />],
            ["Local Support", "24/7 support from our local team", <BsPeople />],
            ["Instant Confirmation", "Get your booking confirmation instantly", <BsCheckCircle />]
          ].map(([title, copy, icon]) => (
            <div className="checkout-trust-row" key={title}>
              <span>{icon}</span>
              <div>
                <strong>{title}</strong>
                <small>{copy}</small>
              </div>
            </div>
          ))}

          <div className="checkout-help-block">
            <h6>Need help?</h6>
            <p>Our support team is here to help you</p>
            <div><BsWhatsapp /> <span>+255 778 775 044</span></div>
            <div><BsEnvelope /> <span>info@risertoursandsafaris.co.tz</span></div>
          </div>
        </Card.Body>
      </Card>
    </div>
  );
};

export default BookingSummarySidebar;

