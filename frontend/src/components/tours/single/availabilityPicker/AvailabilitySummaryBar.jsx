import { Button } from "react-bootstrap";
import { BsCalendar3, BsPeople, BsTranslate, BsTag } from "react-icons/bs";
import { formatDate } from "../../../../utils/formatters";

const summarizePassengers = (pax = { adults: 1, children: 0, infants: 0 }) => {
  const adults = Math.max(0, Number(pax?.adults || 0));
  const children = Math.max(0, Number(pax?.children || 0));
  const infants = Math.max(0, Number(pax?.infants || 0));

  const chunks = [];
  if (adults > 0) chunks.push(`${adults} adult${adults > 1 ? "s" : ""}`);
  if (children > 0) chunks.push(`${children} child${children > 1 ? "ren" : ""}`);
  if (infants > 0) chunks.push(`${infants} infant${infants > 1 ? "s" : ""}`);

  return chunks.length ? chunks.join(", ") : "1 adult";
};

const AvailabilitySummaryBar = ({
  travelDate = "",
  pax = { adults: 1, children: 0, infants: 0 },
  selectedRateLabel = "",
  languageLabel = "",
  onEditSearch
}) => (
  <div className="availability-summary-bar">
    <div className="availability-summary-items">
      <div className="availability-summary-item">
        <BsCalendar3 />
        <span>{travelDate ? formatDate(travelDate, "ddd, MMM D, YYYY") : "Date not selected"}</span>
      </div>
      <div className="availability-summary-item">
        <BsPeople />
        <span>{summarizePassengers(pax)}</span>
      </div>
      <div className="availability-summary-item">
        <BsTranslate />
        <span>{languageLabel || "Language per option"}</span>
      </div>
      {selectedRateLabel ? (
        <div className="availability-summary-item">
          <BsTag />
          <span>{selectedRateLabel}</span>
        </div>
      ) : null}
    </div>
    <Button variant="outline-secondary" size="sm" className="availability-summary-edit-btn" onClick={onEditSearch}>
      Edit search
    </Button>
  </div>
);

export default AvailabilitySummaryBar;
