import { BsCarFrontFill, BsGeoAltFill, BsTranslate, BsWallet2 } from "react-icons/bs";

const OptionMetaRow = ({ option = {} }) => {
  const language = option.language || "As published in Bokun";
  const pickupLabel = option.pickupSupported ? "Pickup supported" : "No pickup";
  const meetingLabel = option.meetingPointSupported ? "Meeting point supported" : "Meeting point not specified";

  return (
    <div className="option-meta-row">
      <span>
        <BsTranslate className="me-2" />
        {language}
      </span>
      <span>
        <BsCarFrontFill className="me-2" />
        {pickupLabel}
      </span>
      <span>
        <BsGeoAltFill className="me-2" />
        {meetingLabel}
      </span>
      <span>
        <BsWallet2 className="me-2" />
        {option.pricingSummary || "Live pricing and availability"}
      </span>
    </div>
  );
};

export default OptionMetaRow;
