import { Button } from "react-bootstrap";
import { BsArrowRight, BsCheckCircleFill, BsGeoAlt, BsTranslate, BsTruck, BsCashCoin } from "react-icons/bs";
import { formatCurrency, toPlainText, truncateText } from "../../../../utils/formatters";
import TimeSlotChips from "./TimeSlotChips";

const normalizeTimeToken = (value = "") => {
  const token = String(value || "").trim();
  if (!token) {
    return "";
  }

  const match = token.match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return token;
  }

  return `${match[1].padStart(2, "0")}:${match[2].padStart(2, "0")}`;
};

const inferEntranceLabel = (option = {}) => {
  const token = `${option?.name || ""} ${option?.description || ""}`.toLowerCase();
  if (token.includes("no entrance")) {
    return "Entrance not included";
  }

  if (token.includes("entrance fee") || token.includes("entrance included")) {
    return "Entrance included";
  }

  return "Entrance details in checkout";
};

const resolveLiveAmount = (option = {}) => {
  const live = Number(option?.liveAvailability?.lowestPriceForTwo || 0);
  const fallback = Number(option?.fromPrice || 0);
  return Number.isFinite(live) && live > 0 ? live : Number.isFinite(fallback) ? fallback : 0;
};

const AvailabilityOptionCard = ({
  option = {},
  selected = false,
  selectedTime = "",
  badge = "",
  onSelectOption,
  onChangeTime,
  onContinue
}) => {
  const optionLanguage = option?.language || "English";
  const shortDescription = truncateText(
    toPlainText(option?.description || "Live option details are confirmed in Bokun during checkout."),
    130
  );
  const priceAmount = resolveLiveAmount(option);
  const currency = option?.liveAvailability?.currency || option?.currency || "USD";
  const slots = (option?.liveAvailability?.slots || [])
    .filter((slot) => slot?.status === "available" || slot?.status === "limited")
    .map((slot) => ({
      time: normalizeTimeToken(slot?.time),
      capacityLeft: Number(slot?.capacityLeft || 0)
    }))
    .filter((slot) => slot.time);

  const fallbackTime =
    normalizeTimeToken(option?.liveAvailability?.firstAvailableStartTime) ||
    normalizeTimeToken(option?.liveAvailability?.cheapestStartTime) ||
    "";
  const effectiveTime = normalizeTimeToken(selectedTime) || slots[0]?.time || fallbackTime;

  const handleContinue = () => {
    onSelectOption?.(option);
    if (effectiveTime) {
      onChangeTime?.(option?.bokunOptionId || "", effectiveTime);
    }
    onContinue?.(option, effectiveTime);
  };

  return (
    <article className={`availability-option-card ${selected ? "is-selected" : ""}`.trim()}>
      <header className="availability-option-head">
        <div>
          <div className="availability-option-kicker">Available option</div>
          <h5>{option?.name || "Tour option"}</h5>
        </div>
        <div className="availability-option-head-right">
          {badge ? <span className="availability-option-badge">{badge}</span> : null}
          {selected ? (
            <span className="availability-option-selected">
              <BsCheckCircleFill />
              Selected
            </span>
          ) : null}
        </div>
      </header>

      <p className="availability-option-copy">{shortDescription}</p>

      <div className="availability-option-meta">
        <div>
          <BsTranslate />
          <span>{optionLanguage}</span>
        </div>
        <div>
          <BsTruck />
          <span>{option?.pickupSupported ? "Pickup available" : "Meeting point option"}</span>
        </div>
        <div>
          <BsGeoAlt />
          <span>{inferEntranceLabel(option)}</span>
        </div>
        <div>
          <BsCashCoin />
          <span>{priceAmount > 0 ? `From ${formatCurrency(priceAmount, currency)}` : "Live price on request"}</span>
        </div>
      </div>

      <div className="availability-option-times">
        <div className="availability-option-times-label">Available start times</div>
        <TimeSlotChips
          slots={slots}
          value={effectiveTime}
          onChange={(time) => {
            onSelectOption?.(option);
            onChangeTime?.(option?.bokunOptionId || "", time);
          }}
        />
      </div>

      <div className="availability-option-footer">
        <Button variant="outline-secondary" className="availability-option-select-btn" onClick={() => onSelectOption?.(option)}>
          Select option
        </Button>
        <Button className="premium-btn text-white availability-option-continue-btn" onClick={handleContinue}>
          Continue
          <BsArrowRight className="ms-2" />
        </Button>
      </div>
    </article>
  );
};

export default AvailabilityOptionCard;
