import Card from "react-bootstrap/Card";
import Badge from "react-bootstrap/Badge";
import { BsCalendar3, BsCashStack, BsClock, BsInfoCircle, BsPeople, BsSignpostSplit, BsTag } from "react-icons/bs";
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
    questions,
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
  const questionCount = Array.isArray(questions) ? questions.length : 0;

  const estimatedTotal = liveQuoteReady
    ? toSafeNumber(quotePricing.finalPayable)
    : toSafeNumber(availability?.pricing?.grossAmount) + extrasTotal;

  return (
    <Card className="surface-card booking-sticky smart-summary-card">
      <Card.Body>
        <h5 className="mb-3">Booking summary</h5>

        <div className="d-flex flex-wrap gap-2 mb-3">
          <Badge bg={liveAvailabilityReady ? "success-subtle" : "secondary"} text={liveAvailabilityReady ? "success" : "light"}>
            {liveAvailabilityReady ? "Live availability checked" : "Quote pending"}
          </Badge>
          <Badge bg={liveQuoteReady ? "info-subtle" : "warning-subtle"} text={liveQuoteReady ? "info" : "dark"}>
            {liveQuoteReady ? "Live quote ready" : "Waiting live quote"}
          </Badge>
        </div>

        <div className="summary-line-item">
          <span><BsSignpostSplit className="me-2" />Product</span>
          <strong>{tour?.title || "Tour"}</strong>
        </div>
        <div className="summary-line-item">
          <span><BsSignpostSplit className="me-2" />Selected option</span>
          <strong>{option?.name || "Not selected"}</strong>
        </div>
        <div className="summary-line-item">
          <span><BsTag className="me-2" />Price catalog</span>
          <strong>{priceCatalog?.title || "Default"}</strong>
        </div>
        <div className="summary-line-item">
          <span><BsCalendar3 className="me-2" />Date</span>
          <strong>{formatTravelDate(travelDate)}</strong>
        </div>
        <div className="summary-line-item">
          <span><BsClock className="me-2" />Time</span>
          <strong>{startTime || "Shown after date selection"}</strong>
        </div>
        <div className="summary-line-item">
          <span><BsPeople className="me-2" />Passengers</span>
          <strong>{paxSummary}</strong>
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

        <div className="summary-subsection">
          <div className="summary-line-item">
            <span><BsInfoCircle className="me-2" />Booking questions</span>
            <strong>{questionCount > 0 ? `${questionCount} required` : "None"}</strong>
          </div>
        </div>

        <hr />

        <div className="summary-line-item total-line">
          <span><BsCashStack className="me-2" />Estimated total</span>
          <strong>{formatCurrency(estimatedTotal, quoteCurrency)}</strong>
        </div>

        {quoteLoading || availabilityLoading ? (
          <small className="text-muted d-block mt-2">Refreshing live pricing...</small>
        ) : null}

        <div className="mt-3">
          <ChangeTripDetailsAction className="w-100" onClick={onChangeTripDetails} />
        </div>
      </Card.Body>
    </Card>
  );
};

export default BookingSummarySidebar;

