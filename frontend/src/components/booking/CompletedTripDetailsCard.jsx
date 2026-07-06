import Card from "react-bootstrap/Card";
import { BsCalendar3, BsCheckCircle, BsClock, BsGeoAlt, BsPencil, BsPeople, BsSignpostSplit } from "react-icons/bs";
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
  return `Adults ${adults} | Children ${children} | Infants ${infants}`;
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
    { icon: <BsSignpostSplit />, label: "Option", value: flowState.option?.name || "Not selected" },
    { icon: <BsCalendar3 />, label: "Travel Date", value: safeDate(flowState.travelDate) },
    { icon: <BsClock />, label: "Time", value: flowState.startTime || "Not selected" },
    { icon: <BsPeople />, label: "Passengers", value: passengerText },
    { icon: <BsGeoAlt />, label: "Pickup Location", value: flowState.customer?.hotelName || "Select in customer details" },
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
            <p className="text-muted mb-0">Please review your selected tour information</p>
          </div>
          <ChangeTripDetailsAction onClick={onChangeTripDetails} disabled={loading} icon={<BsPencil />} label="Change" />
        </div>

        <div className="completed-trip-table mt-3">
          {rows.map((row) => (
            <div className="completed-trip-row" key={row.label}>
              <span className="completed-trip-label">{row.icon}{row.label}</span>
              <strong className={row.success ? "text-success" : ""}>{row.value}</strong>
            </div>
          ))}
        </div>
      </Card.Body>
    </Card>
  );
};

export default CompletedTripDetailsCard;

