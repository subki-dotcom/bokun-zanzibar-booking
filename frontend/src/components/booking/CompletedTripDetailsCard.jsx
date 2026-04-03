import Card from "react-bootstrap/Card";
import Badge from "react-bootstrap/Badge";
import { BsCalendar3, BsCheckCircleFill, BsGeoAlt, BsPeople, BsSignpostSplit, BsTag } from "react-icons/bs";
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

  return (
    <Card className="surface-card completed-trip-card mb-3">
      <Card.Body>
        <div className="completed-trip-head">
          <div>
            <div className="single-booking-eyebrow">Trip setup completed</div>
            <h4 className="mb-1">Your travel details are already selected</h4>
            <p className="text-muted mb-0">
              Checkout continues from the next step. No need to repeat option/date/passenger setup.
            </p>
          </div>
          <Badge bg="success-subtle" text="success" className="completed-badge">
            <BsCheckCircleFill className="me-1" />
            Ready
          </Badge>
        </div>

        <div className="completed-trip-grid mt-3">
          <div className="completed-trip-item">
            <span><BsSignpostSplit className="me-2" />Option</span>
            <strong>{flowState.option?.name || "Not selected"}</strong>
          </div>
          <div className="completed-trip-item">
            <span><BsTag className="me-2" />Price catalog</span>
            <strong>{flowState.priceCatalog?.title || "Default"}</strong>
          </div>
          <div className="completed-trip-item">
            <span><BsCalendar3 className="me-2" />Travel date</span>
            <strong>{safeDate(flowState.travelDate)}</strong>
          </div>
          <div className="completed-trip-item">
            <span><BsPeople className="me-2" />Passengers</span>
            <strong>{passengerText}</strong>
          </div>
          <div className="completed-trip-item">
            <span><BsGeoAlt className="me-2" />Destination</span>
            <strong>{tour?.destination || "Zanzibar"}</strong>
          </div>
          <div className="completed-trip-item">
            <span>Status</span>
            <strong>{flowState.availabilityChecked ? "Live availability checked" : "Pending recheck"}</strong>
          </div>
        </div>

        <div className="mt-3 d-flex justify-content-end">
          <ChangeTripDetailsAction onClick={onChangeTripDetails} disabled={loading} />
        </div>
      </Card.Body>
    </Card>
  );
};

export default CompletedTripDetailsCard;

