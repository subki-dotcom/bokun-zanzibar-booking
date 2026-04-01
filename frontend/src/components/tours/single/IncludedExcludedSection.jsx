import { BsCheckCircleFill, BsXCircleFill } from "react-icons/bs";
import { toTextList } from "./singleTour.helpers";

const IncludedExcludedSection = ({ included = [], excluded = [] }) => {
  const includedLines = toTextList(included);
  const excludedLines = toTextList(excluded);

  return (
    <section className="single-tour-section">
      <div className="single-tour-section-head">
        <h3>Included and excluded</h3>
      </div>

      <div className="included-excluded-grid">
        <div className="included-excluded-card">
          <h5>
            <BsCheckCircleFill className="me-2 text-success" />
            Included
          </h5>
          {includedLines.length ? (
            <ul>
              {includedLines.map((line, index) => (
                <li key={`included-${index}`}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="single-tour-muted mb-0">Included items are not listed in Bokun for this product.</p>
          )}
        </div>

        <div className="included-excluded-card">
          <h5>
            <BsXCircleFill className="me-2 text-danger" />
            Excluded
          </h5>
          {excludedLines.length ? (
            <ul>
              {excludedLines.map((line, index) => (
                <li key={`excluded-${index}`}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="single-tour-muted mb-0">No exclusions are listed in Bokun for this product.</p>
          )}
        </div>
      </div>
    </section>
  );
};

export default IncludedExcludedSection;
