import Loader from "../../../common/Loader";

const StartingPriceBox = ({ label = "Starting price", priceLabel = "Check live pricing", meta = "", loading = false }) => (
  <div className="single-booking-starting">
    <div className="single-booking-starting-label">{label}</div>
    <div className="single-booking-starting-value">
      {loading ? <Loader variant="inline" message="Loading price..." /> : priceLabel}
    </div>
    {meta ? <div className="single-booking-starting-meta">{meta}</div> : null}
  </div>
);

export default StartingPriceBox;
