import { BsInfoCircleFill } from "react-icons/bs";
import { toTextList } from "./singleTour.helpers";

const ImportantInformationSection = ({ importantInformation = [] }) => {
  const rows = toTextList(importantInformation);

  return (
    <section className="single-tour-section">
      <div className="single-tour-section-head">
        <h3>Important information</h3>
      </div>

      {rows.length ? (
        <div className="important-info-list">
          {rows.map((item, index) => (
            <div className="important-info-item" key={`info-${index}`}>
              <BsInfoCircleFill />
              <span>{item}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="single-tour-muted mb-0">No additional important information published in Bokun.</p>
      )}
    </section>
  );
};

export default ImportantInformationSection;
