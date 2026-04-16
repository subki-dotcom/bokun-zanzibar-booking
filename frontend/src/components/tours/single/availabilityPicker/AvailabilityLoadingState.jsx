import Placeholder from "react-bootstrap/Placeholder";

const AvailabilityLoadingState = () => (
  <div className="availability-state-wrap" aria-live="polite">
    <div className="availability-state-title">Checking live availability...</div>
    <div className="availability-state-subtitle">
      We are fetching real-time options and pricing from Bokun.
    </div>
    <div className="availability-loading-grid">
      {[1, 2, 3].map((row) => (
        <div key={row} className="availability-loading-card">
          <Placeholder as="div" animation="glow">
            <Placeholder xs={7} />
          </Placeholder>
          <Placeholder as="div" animation="glow">
            <Placeholder xs={10} />
          </Placeholder>
          <Placeholder as="div" animation="glow">
            <Placeholder xs={6} />
          </Placeholder>
        </div>
      ))}
    </div>
  </div>
);

export default AvailabilityLoadingState;
