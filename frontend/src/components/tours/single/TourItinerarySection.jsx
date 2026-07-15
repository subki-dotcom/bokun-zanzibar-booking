import { useEffect, useMemo, useState } from "react";
import { BsChevronDown, BsClock, BsGeoAlt, BsTicketPerforated } from "react-icons/bs";

const TourItinerarySection = ({ itinerary = [] }) => {
  const [isMobile, setIsMobile] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  const visibleItinerary = useMemo(
    () => (isMobile && !showAll ? itinerary.slice(0, 3) : itinerary),
    [isMobile, itinerary, showAll]
  );

  return (
    <section id="itinerary" className="single-tour-section product-detail-section product-itinerary-section">
      <div className="single-tour-section-head">
        <h3>Itinerary</h3>
        <p>Main stops and key highlights</p>
      </div>

      {itinerary.length ? (
        <div className="itinerary-list product-itinerary-list">
          {visibleItinerary.map((rawItem, index) => {
            const item = typeof rawItem === "string"
              ? { title: "", description: rawItem }
              : rawItem;

            return (
              <article className="itinerary-item product-itinerary-item" key={item.id || `itinerary-${index}`}>
                <div className="itinerary-index">{index + 1}</div>
                <div className={`itinerary-content product-itinerary-content ${item.image ? "has-image" : ""}`.trim()}>
                  {item.image ? <img className="itinerary-image" src={item.image} alt={item.imageAlt || item.title || "Itinerary stop"} loading="lazy" /> : null}
                  <div className="itinerary-text">
                  {item.title ? <h4>{item.title}</h4> : null}
                  {item.description ? <p>{item.description}</p> : null}
                    <div className="product-itinerary-meta">
                      {item.duration ? <span><BsClock /> {item.duration}</span> : null}
                      {item.admission ? <span><BsTicketPerforated /> {item.admission}</span> : null}
                      {item.location ? <span><BsGeoAlt /> {item.location}</span> : null}
                    </div>
                  </div>
                  <BsChevronDown className="product-itinerary-chevron" aria-hidden="true" />
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="single-tour-muted mb-0">Itinerary details are not currently published for this experience.</p>
      )}

      {isMobile && itinerary.length > 3 ? <button type="button" className="product-itinerary-toggle" onClick={() => setShowAll((value) => !value)}>{showAll ? "Show less" : "View all itinerary"}<BsChevronDown className={showAll ? "is-open" : ""} /></button> : null}
    </section>
  );
};

export default TourItinerarySection;
