import { useState } from "react";
import { splitDescription } from "./singleTour.helpers";

const AboutTourSection = ({ description = "" }) => {
  const paragraphs = splitDescription(description);
  const [expanded, setExpanded] = useState(false);
  const visibleParagraphs = expanded ? paragraphs : paragraphs.slice(0, 2);

  return (
    <section className="single-tour-section">
      <div className="single-tour-section-head">
        <h3>About this tour</h3>
      </div>

      {paragraphs.length ? (
        <div className="single-tour-copy">
          {visibleParagraphs.map((paragraph, index) => (
            <p key={`about-${index}`}>{paragraph}</p>
          ))}
          {paragraphs.length > 2 ? <button type="button" className="product-summary-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Read less" : "Read more"}</button> : null}
        </div>
      ) : (
        <p className="single-tour-muted mb-0">Detailed description is not yet available from Bokun.</p>
      )}
    </section>
  );
};

export default AboutTourSection;
