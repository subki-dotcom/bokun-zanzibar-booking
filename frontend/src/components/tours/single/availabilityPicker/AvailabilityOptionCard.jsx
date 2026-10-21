import { Button } from "react-bootstrap";
import { BsArrowRight, BsCheckCircleFill, BsGeoAlt, BsTranslate, BsTruck, BsCashCoin } from "react-icons/bs";
import { formatCurrency, toPlainText, truncateText } from "../../../../utils/formatters";
import { pricePresentation } from "../pricePresentation";

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

  return "";
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
  const optionLanguage = String(option?.language || "").trim();
  const entranceLabel = inferEntranceLabel(option);
  const shortDescription = truncateText(toPlainText(option?.description || ""), 130);
  const priceAmount = resolveLiveAmount(option);
  const displayPrice = pricePresentation({
    ...option, ...option.liveAvailability, amount: priceAmount,
    isTotal: Number(option.liveAvailability?.lowestPriceForTwo) > 0
  });
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
  // The first available start time is chosen until the guest picks another one.
  const effectiveSlot = selectedSlot || slots[0] || null;
  const selectedSlotKey = effectiveSlot?.selectionKey || "";
  const liveTotal = Number(option?.liveAvailability?.lowestPriceForTwo || 0);
  const liveAdults = Math.max(0, Number(option?.liveAvailability?.comparedAdults || 0));
  const isGroupPrice = String(option?.liveAvailability?.pricingType || option?.pricingType || "") === "per_group";
  const startTimeSelectId = `available-start-time-${String(option?.bokunOptionId || option?.name || "option")
    .replace(/[^a-z0-9_-]/gi, "-")
    .toLowerCase()}`;

  const handleContinue = () => {
    if (!effectiveSlot) {
      return;
    }

    onSelectOption?.(option);
    onChangeTime?.(option?.bokunOptionId || "", effectiveSlot);
    onContinue?.(option, effectiveSlot.time, effectiveSlot);
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

      {shortDescription ? <p className="availability-option-copy">{shortDescription}</p> : null}

      <div className="availability-option-meta">
        {optionLanguage ? (
          <div>
            <BsTranslate />
            <span>{optionLanguage}</span>
          </div>
        ) : null}
        <div>
          <BsTruck />
          <span>{option?.pickupSupported ? "Pickup available" : "Meeting point option"}</span>
        </div>
        {entranceLabel ? (
          <div>
            <BsGeoAlt />
            <span>{entranceLabel}</span>
          </div>
        ) : null}
        <div>
          <BsCashCoin />
          <span>
            {liveTotal > 0 && liveAdults > 0
              ? `Total ${formatCurrency(liveTotal, currency)} ${isGroupPrice ? "for your group" : `for ${liveAdults} adult${liveAdults > 1 ? "s" : ""}`}`
              : priceAmount > 0
                ? `From ${formatCurrency(displayPrice.amount, currency)} ${displayPrice.label}`
                : "Price shown at checkout"}
          </span>
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
        <Button
          className="premium-btn text-white availability-option-continue-btn w-100"
          onClick={handleContinue}
          disabled={!effectiveSlot}
        >
          Book this option
          <BsArrowRight className="ms-2" />
        </Button>
      </div>
    </article>
  );
};

export default AvailabilityOptionCard;
