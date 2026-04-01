import { BsSignpost2 } from "react-icons/bs";

const TourItinerarySection = ({ itinerary = [] }) => {
  return (
    <section className="single-tour-section">
      <div className="single-tour-section-head">
        <h3>Itinerary</h3>
      </div>

      {itinerary.length ? (
        <div className="itinerary-list">
          {itinerary.map((item, index) => (
            <div className="itinerary-item" key={`itinerary-${index}`}>
              <div className="itinerary-index">{index + 1}</div>
              <div className="itinerary-text">
                <div className="itinerary-step-label">
                  <BsSignpost2 className="me-1" />
                  Stop {index + 1}
                </div>
                <div>{item}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="single-tour-muted mb-0">
          Itinerary details are not currently published for this product in Bokun.
        </p>
      )}
    </section>
  );
};

export default TourItinerarySection;
