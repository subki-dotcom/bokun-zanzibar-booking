import { splitDescription } from "./singleTour.helpers";

const AboutTourSection = ({ description = "" }) => {
  const paragraphs = splitDescription(description);

  return (
    <section className="single-tour-section">
      <div className="single-tour-section-head">
        <h3>About this tour</h3>
      </div>

      {paragraphs.length ? (
        <div className="single-tour-copy">
          {paragraphs.map((paragraph, index) => (
            <p key={`about-${index}`}>{paragraph}</p>
          ))}
        </div>
      ) : (
        <p className="single-tour-muted mb-0">Detailed description is not yet available from Bokun.</p>
      )}
    </section>
  );
};

export default AboutTourSection;
