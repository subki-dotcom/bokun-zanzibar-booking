import { buildExperienceDetails } from "./singleTour.helpers";

const ExperienceDetailsGrid = ({ tour = {} }) => {
  const details = buildExperienceDetails(tour);

  return (
    <section className="single-tour-section">
      <div className="single-tour-section-head">
        <h3>Experience details</h3>
      </div>

      <div className="experience-grid">
        {details.map((detail) => (
          <div className="experience-item" key={detail.label}>
            <div className="experience-label">{detail.label}</div>
            <div className="experience-value">{detail.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default ExperienceDetailsGrid;
