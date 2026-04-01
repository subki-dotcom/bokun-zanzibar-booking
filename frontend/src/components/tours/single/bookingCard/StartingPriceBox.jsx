import Spinner from "react-bootstrap/Spinner";

const StartingPriceBox = ({ label = "Starting price", priceLabel = "Check live pricing", meta = "", loading = false }) => (
  <div className="single-booking-starting">
    <div className="single-booking-starting-label">{label}</div>
    <div className="single-booking-starting-value">
      {loading ? <Spinner animation="border" size="sm" /> : priceLabel}
    </div>
    {meta ? <div className="single-booking-starting-meta">{meta}</div> : null}
  </div>
);

export default StartingPriceBox;
