import { BsCarFrontFill, BsGeoAltFill } from "react-icons/bs";
import { toTextList } from "./singleTour.helpers";

const MeetingPickupSection = ({ meetingInfo = "", pickupInfo = "" }) => {
  const meetingLines = toTextList(meetingInfo);
  const pickupLines = toTextList(pickupInfo);

  if (!meetingLines.length && !pickupLines.length) {
    return (
      <section className="single-tour-section">
        <div className="single-tour-section-head">
          <h3>Meeting and pickup</h3>
        </div>
        <p className="single-tour-muted mb-0">Meeting and pickup details are not specified in Bokun.</p>
      </section>
    );
  }

  return (
    <section className="single-tour-section">
      <div className="single-tour-section-head">
        <h3>Meeting and pickup</h3>
      </div>

      <div className="meeting-pickup-grid">
        <div className="meeting-pickup-card">
          <h5>
            <BsGeoAltFill className="me-2" />
            Meeting point
          </h5>
          {meetingLines.length ? (
            <ul>
              {meetingLines.map((line, index) => (
                <li key={`meeting-${index}`}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="single-tour-muted mb-0">Meeting point will be confirmed during booking.</p>
          )}
        </div>

        <div className="meeting-pickup-card">
          <h5>
            <BsCarFrontFill className="me-2" />
            Pickup
          </h5>
          {pickupLines.length ? (
            <ul>
              {pickupLines.map((line, index) => (
                <li key={`pickup-${index}`}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="single-tour-muted mb-0">Pickup details are not listed for this product.</p>
          )}
        </div>
      </div>
    </section>
  );
};

export default MeetingPickupSection;
