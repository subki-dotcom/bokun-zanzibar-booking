import { Button } from "react-bootstrap";

const AvailabilityErrorState = ({ message = "", onEditSearch }) => (
  <div className="availability-state-wrap is-error">
    <div className="availability-state-title">Could not load availability</div>
    <div className="availability-state-subtitle">
      {message || "Something went wrong while loading live Bokun availability."}
    </div>
    <Button variant="outline-secondary" className="mt-2" onClick={onEditSearch}>
      Go back and edit search
    </Button>
  </div>
);

export default AvailabilityErrorState;
