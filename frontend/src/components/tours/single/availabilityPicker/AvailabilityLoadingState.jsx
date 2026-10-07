import { OptionLoadingSkeleton } from "../TourLoadingSkeleton";

const AvailabilityLoadingState = () => (
  <div className="availability-state-wrap" role="status" aria-busy="true" aria-label="Loading available options">
    <span className="visually-hidden">Loading available options...</span>
    <div className="availability-loading-grid">
      {[1, 2, 3].map((row) => (
        <OptionLoadingSkeleton key={row} />
      ))}
    </div>
  </div>
);

export default AvailabilityLoadingState;
