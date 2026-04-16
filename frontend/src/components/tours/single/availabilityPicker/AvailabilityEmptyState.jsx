import { Button } from "react-bootstrap";

const AvailabilityEmptyState = ({ onEditSearch }) => (
  <div className="availability-state-wrap">
    <div className="availability-state-title">No options available for this date</div>
    <div className="availability-state-subtitle">
      Try another date or passenger mix to see more available Bokun options.
    </div>
    <Button variant="outline-secondary" className="mt-2" onClick={onEditSearch}>
      Change search details
    </Button>
  </div>
);

export default AvailabilityEmptyState;
