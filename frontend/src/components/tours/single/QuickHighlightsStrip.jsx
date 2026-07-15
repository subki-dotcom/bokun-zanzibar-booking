import { BsClock, BsGeoAlt, BsGrid3X3Gap, BsPeople, BsSignpostSplit, BsTranslate } from "react-icons/bs";
import { buildQuickHighlights } from "./singleTour.helpers";

const iconMap = {
  duration: BsClock,
  location: BsGeoAlt,
  difficulty: BsSignpostSplit,
  category: BsGrid3X3Gap,
  "group-size": BsPeople,
  language: BsTranslate
};

const QuickHighlightsStrip = ({ tour = {} }) => {
  const highlights = buildQuickHighlights(tour);

  return (
    <section className="single-tour-quick-strip">
      {highlights.map((item, index) => {
        const Icon = iconMap[item.key] || BsGrid3X3Gap;

        return (
          <div className="quick-strip-item" key={item.key || item.label}>
            <div className="quick-strip-icon">
              <Icon />
            </div>
            <div className="quick-strip-copy">
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
