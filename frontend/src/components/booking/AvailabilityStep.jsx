import { useState } from "react";
import Card from "react-bootstrap/Card";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import Placeholder from "react-bootstrap/Placeholder";

const AvailabilityStep = ({
  travelDate,
  startTime,
  setTravelDate,
  setStartTime,
  availability,
  loading,
  onCheckAvailability,
  onBack,
  onNext
}) => {
  const [touched, setTouched] = useState(false);
  const hasDateError = touched && !travelDate;
  const handleDateChange = (value) => {
    setTravelDate(value);

    if (value) {
      onCheckAvailability("", { travelDate: value, startTime: "" });
    }
  };

  return (
    <Card className="surface-card">
      <Card.Body>
        <h4 className="mb-3">Date & Availability</h4>

        <Form.Group className="mb-3">
          <Form.Label>Travel date</Form.Label>
          <Form.Control
            type="date"
            value={travelDate}
            onChange={(event) => handleDateChange(event.target.value)}
            isInvalid={hasDateError}
          />
          <Form.Control.Feedback type="invalid">Please select a travel date.</Form.Control.Feedback>
        </Form.Group>

        <Button
          variant="outline-info"
          onClick={() => {
            setTouched(true);
            if (travelDate) onCheckAvailability("", { travelDate, startTime });
          }}
          disabled={loading}
        >
          {loading ? "Checking..." : "Check Live Availability"}
        </Button>

        {loading ? (
          <div className="mt-4">
            <Placeholder as="div" animation="glow" className="mb-2">
              <Placeholder xs={12} />
            </Placeholder>
            <Placeholder as="div" animation="glow">
              <Placeholder xs={8} />
            </Placeholder>
          </div>
        ) : null}

        {availability?.slots?.length ? (
          <div className="mt-4">
            <h6 className="mb-2">Available start times</h6>
            <div className="start-time-grid">
              {availability.slots.map((slot) => (
                <button
                  type="button"
                  key={slot.time}
                  className={`start-time-chip ${startTime === slot.time ? "is-active" : ""}`.trim()}
                  disabled={slot.status !== "available" && slot.status !== "limited"}
                  onClick={() => {
                    setStartTime(slot.time);
                    onCheckAvailability("", { startTime: slot.time });
                  }}
                >
                  {slot.time} ({slot.capacityLeft} left)
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="d-flex justify-content-between mt-4">
          <Button variant="outline-secondary" onClick={onBack}>
            Back
          </Button>
          <Button className="premium-btn text-white" onClick={onNext} disabled={!travelDate || !startTime}>
            Continue
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
};

export default AvailabilityStep;
