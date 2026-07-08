import Card from "react-bootstrap/Card";
import { BsCalendar3, BsCheckCircle, BsClock, BsLock, BsPencil, BsPeople, BsSignpostSplit } from "react-icons/bs";
import ChangeTripDetailsAction from "./ChangeTripDetailsAction";
import { formatDate } from "../../utils/formatters";

const safeDate = (value = "") => {
  if (!value) {
    return "Not selected";
  }

  return formatDate(value, "ddd, MMM D, YYYY");
};

const buildPassengerSummary = (rows = [], pax = {}) => {
  const selectedRows = (rows || []).filter((row) => Number(row.quantity || 0) > 0);
  if (selectedRows.length) {
    return selectedRows.map((row) => `${row.title || "Passenger"} x${row.quantity}`).join(", ");
  }

  const adults = Number(pax.adults || 0);
  const children = Number(pax.children || 0);
  const infants = Number(pax.infants || 0);
  const pieces = [];
  if (adults > 0) pieces.push(`${adults === 1 ? "Adult" : "Adults"} x${adults}`);
  if (children > 0) pieces.push(`${children === 1 ? "Child" : "Children"} x${children}`);
  if (infants > 0) pieces.push(`${infants === 1 ? "Infant" : "Infants"} x${infants}`);

  return pieces.length ? pieces.join(", ") : "Adult x1";
};

const CompletedTripDetailsCard = ({
  tour = null,
  flowState = {},
  onChangeTripDetails,
  loading = false
}) => {
  const passengerText = buildPassengerSummary(
    flowState.priceCategoryParticipants || [],
    flowState.pax || {}
  );
  const rows = [
    { icon: <BsSignpostSplit />, label: "Option", value: flowState.option?.name || "Not selected", highlight: true },
    { icon: <BsCalendar3 />, label: "Travel Date", value: safeDate(flowState.travelDate) },
    { icon: <BsClock />, label: "Time", value: flowState.startTime || "Not selected" },
    { icon: <BsPeople />, label: "Passengers", value: passengerText },
    {
      icon: <BsCheckCircle />,
      label: "Status",
      value: flowState.availabilityChecked ? "Live availability checked" : "Pending recheck",
      success: flowState.availabilityChecked
    }
  ];

  return (
    <Card className="surface-card completed-trip-card mb-3">
      <Card.Body>
        <div className="completed-trip-head">
          <div>
            <h4 className="mb-1">Trip Details</h4>
          </div>
          <div className="completed-trip-head-actions">
            <span className="checkout-review-mode-pill">
              <BsLock />
              Review mode
            </span>
            <ChangeTripDetailsAction onClick={onChangeTripDetails} disabled={loading} icon={<BsPencil />} label="Change" />
          </div>
        </div>

        <div className="completed-trip-table mt-3">
          {rows.map((row) => (
            <div className={`completed-trip-row ${row.highlight ? "is-highlight" : ""}`.trim()} key={row.label}>
              <span className="completed-trip-label">{row.icon}{row.label}</span>
              <strong className={row.success ? "is-success" : ""}>{row.value}</strong>
            </div>
          ))}
        </div>
      </Card.Body>
    </Card>
  );
};

export default CompletedTripDetailsCard;

