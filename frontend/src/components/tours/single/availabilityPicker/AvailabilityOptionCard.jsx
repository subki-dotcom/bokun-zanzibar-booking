import { Button } from "react-bootstrap";
import { BsArrowRight, BsCheckCircleFill, BsGeoAlt, BsTranslate, BsTruck, BsCashCoin } from "react-icons/bs";
import { formatCurrency, toPlainText, truncateText } from "../../../../utils/formatters";

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
  selectedTimeSlot = null,
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
    .map((slot, index) => {
      const time = normalizeTimeToken(slot?.time);
      const capacityLeft = Number(slot?.capacityLeft);
      const startTimeId = String(slot?.startTimeId || "").trim();

      return {
        ...slot,
        time,
        startTimeId,
        capacityLeft,
        selectionKey: `${startTimeId || "time"}:${time}:${index}`
      };
    })
    .filter((slot) => slot.time && Number.isFinite(slot.capacityLeft) && slot.capacityLeft > 0);
  const normalizedSelectedTime = normalizeTimeToken(selectedTime);
  const selectedSlot =
    slots.find((slot) => {
      const selectedStartTimeId = String(selectedTimeSlot?.startTimeId || "").trim();
      if (selectedStartTimeId) {
        return selectedStartTimeId === slot.startTimeId;
      }

      return slot.time === normalizedSelectedTime;
    }) || null;
  const selectedSlotKey = selectedSlot?.selectionKey || "";
  const startTimeSelectId = `available-start-time-${String(option?.bokunOptionId || option?.name || "option")
    .replace(/[^a-z0-9_-]/gi, "-")
    .toLowerCase()}`;

  const handleContinue = () => {
    if (!selectedSlot) {
      return;
    }

    onSelectOption?.(option);
    onChangeTime?.(option?.bokunOptionId || "", selectedSlot);
    onContinue?.(option, selectedSlot.time, selectedSlot);
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
        <label className="availability-option-times-label" htmlFor={startTimeSelectId}>
          Available start times
        </label>
        <select
          id={startTimeSelectId}
          className="availability-start-time-select"
          value={selectedSlotKey}
          onChange={(event) => {
            const nextSlot = slots.find((slot) => slot.selectionKey === event.target.value) || null;
            onSelectOption?.(option);
            onChangeTime?.(option?.bokunOptionId || "", nextSlot);
          }}
          disabled={!slots.length}
          aria-describedby={!slots.length ? `${startTimeSelectId}-status` : undefined}
        >
          <option value="">{slots.length ? "Select start time" : "No start times available"}</option>
          {slots.map((slot) => {
            const capacityLabel = slot.capacityLeft >= 1000 ? "Available" : `${slot.capacityLeft} left`;
            return (
              <option key={slot.selectionKey} value={slot.selectionKey}>
                {slot.time} - {capacityLabel}
              </option>
            );
          })}
        </select>
        {!slots.length ? (
          <p id={`${startTimeSelectId}-status`} className="availability-start-time-status" role="status">
            No bookable start times are available for this option.
          </p>
        ) : null}
      </div>

      <div className="availability-option-footer">
        <Button variant="outline-secondary" className="availability-option-select-btn" onClick={() => onSelectOption?.(option)}>
          Select option
        </Button>
        <Button
          className="premium-btn text-white availability-option-continue-btn"
          onClick={handleContinue}
          disabled={!selectedSlot}
        >
          Continue
          <BsArrowRight className="ms-2" />
        </Button>
      </div>
    </article>
  );
};

export default AvailabilityOptionCard;
