import { BsClock, BsGeoAlt, BsGrid3X3Gap, BsStars } from "react-icons/bs";
import { buildQuickHighlights } from "./singleTour.helpers";

const iconMap = [BsClock, BsGeoAlt, BsGrid3X3Gap, BsStars];

const QuickHighlightsStrip = ({ tour = {} }) => {
  const highlights = buildQuickHighlights(tour);

  return (
    <section className="single-tour-quick-strip">
      {highlights.map((item, index) => {
        const Icon = iconMap[index] || BsStars;

        return (
          <div className="quick-strip-item" key={item.label}>
            <div className="quick-strip-icon">
              <Icon />
            </div>
            <div>
              <div className="quick-strip-label">{item.label}</div>
              <div className="quick-strip-value">{item.value}</div>
            </div>
          </div>
        );
      })}
    </section>
  );
};

export default QuickHighlightsStrip;
