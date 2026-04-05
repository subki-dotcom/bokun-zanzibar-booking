import { Button, Card } from "react-bootstrap";
import { BsArrowRight, BsCheckCircleFill, BsClockHistory, BsCurrencyDollar } from "react-icons/bs";
import PriceDisplay from "./PriceDisplay";
import OptionMetaRow from "./OptionMetaRow";
import { formatCurrency, toPlainText } from "../../../utils/formatters";

const resolveLivePriceAmount = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (value && typeof value === "object") {
    const nested = Number(value.amount || 0);
    return Number.isFinite(nested) ? nested : 0;
  }

  return 0;
};

const OptionCard = ({
  option = {},
  tour = {},
  liveAvailability = null,
  selectedStartTime = "",
  travelDate = "",
  pax = { adults: 1, children: 0, infants: 0 },
  passengers = [],
  onChangeStartTime,
  selectedPriceCatalogId = "",
  hasDateFilter = false,
  isSelected = false,
  onSelect,
  onBookOption
}) => {
  const optionDescription = toPlainText(option.description || "");
  const liveTotalPrice = resolveLivePriceAmount(
    liveAvailability?.totalPrice ??
      liveAvailability?.liveTotalPrice ??
      liveAvailability?.lowestPriceForTwo
  );
  const optionStartingPrice = resolveLivePriceAmount(
    option?.fromPrice ?? option?.startingFromPrice ?? option?.minPrice ?? 0
  );
  const liveCurrency = liveAvailability?.currency || tour.currency || "USD";
  const liveStartTime =
    liveAvailability?.firstAvailableStartTime ||
    liveAvailability?.cheapestStartTime ||
    liveAvailability?.slots?.find((slot) => slot?.status === "available" || slot?.status === "limited")?.time ||
    liveAvailability?.slots?.[0]?.time ||
    "";
  const isLiveAvailable = Boolean(liveAvailability?.available);
  const availableSlots = (() => {
    const slotMap = new Map();

    (liveAvailability?.slots || [])
      .filter((slot) => slot?.status === "available" || slot?.status === "limited")
      .forEach((slot) => {
        const time = String(slot?.time || "");
        if (!time) {
          return;
        }

        const current = slotMap.get(time);
        if (!current) {
          slotMap.set(time, {
            time,
            capacityLeft: Number(slot?.capacityLeft || 0)
          });
          return;
        }

        current.capacityLeft = Math.max(current.capacityLeft, Number(slot?.capacityLeft || 0));
      });

    return Array.from(slotMap.values()).sort((a, b) =>
      a.time.localeCompare(b.time, undefined, { numeric: true })
    );
  })();
  const effectiveSelectedTime = (() => {
    if (selectedStartTime && availableSlots.some((slot) => slot.time === selectedStartTime)) {
      return selectedStartTime;
    }

    return availableSlots[0]?.time || liveStartTime || "";
  })();
  const selectedPassengerTotal = (Array.isArray(passengers) ? passengers : []).reduce(
    (sum, row) => sum + Math.max(0, Number(row?.quantity || 0)),
    0
  );
  const passengerSummary = [
    Number(pax?.adults || 0) > 0 ? `${Number(pax?.adults || 0)} adult${Number(pax?.adults || 0) > 1 ? "s" : ""}` : "",
    Number(pax?.children || 0) > 0 ? `${Number(pax?.children || 0)} child${Number(pax?.children || 0) > 1 ? "ren" : ""}` : "",
    Number(pax?.infants || 0) > 0 ? `${Number(pax?.infants || 0)} infant${Number(pax?.infants || 0) > 1 ? "s" : ""}` : ""
  ]
    .filter(Boolean)
    .join(", ");

  const displayAmount = hasDateFilter && isLiveAvailable && liveTotalPrice > 0 ? liveTotalPrice : optionStartingPrice;
  const displaySummary =
    hasDateFilter && isLiveAvailable && liveTotalPrice > 0
      ? `Live total${passengerSummary ? ` (${passengerSummary})` : ""}`
      : option.pricingSummary;

  const canBookFromCard = Boolean(
    hasDateFilter &&
      travelDate &&
      isLiveAvailable &&
      typeof onBookOption === "function"
  );

  const handleBookOption = () => {
    if (!canBookFromCard || typeof onBookOption !== "function") {
      return;
    }

    onBookOption(option, {
      travelDate,
      startTime: effectiveSelectedTime,
      rateId: selectedPriceCatalogId,
      passengerCount: selectedPassengerTotal
    });
  };

  return (
    <Card className={`single-option-card ${isSelected ? "is-selected" : ""}`.trim()}>
      <Card.Body>
        <div className="single-option-top">
          <div>
            <div className="single-option-label">Bookable option</div>
            <h5 className="single-option-title">{option.name || "Option"}</h5>
          </div>
          {isSelected ? (
            <div className="single-option-selected">
              <BsCheckCircleFill className="me-1" />
              Selected
            </div>
          ) : null}
        </div>

        <p className="single-option-description">
          {optionDescription || "Option details are managed in Bokun and available during live checkout."}
        </p>

        <PriceDisplay
          amount={displayAmount}
          currency={liveCurrency}
          summary={displaySummary}
          mode={hasDateFilter && isLiveAvailable && liveTotalPrice > 0 ? "live_total" : ""}
          compact
        />

        <OptionMetaRow option={option} />

        {hasDateFilter ? (
          <div className={`option-live-box ${isLiveAvailable ? "is-available" : "is-unavailable"}`.trim()}>
            <div className="option-live-row">
              <span className="option-live-label">
                <BsClockHistory className="me-2" />
                Availability time
              </span>
              <span className="option-live-value">
                {isLiveAvailable ? liveStartTime || "Time pending from Bokun" : "Not available"}
              </span>
            </div>
            <div className="option-live-row">
              <span className="option-live-label">
                <BsCurrencyDollar className="me-2" />
                Total price
              </span>
              <span className="option-live-value">
                {isLiveAvailable && liveTotalPrice > 0
                  ? `${formatCurrency(liveTotalPrice, liveCurrency)}${passengerSummary ? ` (${passengerSummary})` : ""}`
                  : "No live total"}
              </span>
            </div>
          </div>
        ) : null}

        {hasDateFilter && isLiveAvailable ? (
          <div className="option-time-picker">
            <div className="option-time-picker-label">Available start times</div>
            <div className="option-time-grid">
              {availableSlots.length ? (
                availableSlots.map((slot) => {
                  const isActive = String(slot.time) === String(effectiveSelectedTime);
                  const leftCount = Number(slot.capacityLeft || 0);
                  return (
                    <button
                      key={slot.time}
                      type="button"
                      className={`option-time-chip ${isActive ? "is-active" : ""}`.trim()}
                      onClick={() => onChangeStartTime?.(option?.bokunOptionId || "", slot.time)}
                    >
                      {slot.time}
                      {leftCount > 0 && leftCount < 1000 ? ` (${leftCount} left)` : ""}
                    </button>
                  );
                })
              ) : (
                <div className="option-time-empty">
                  {effectiveSelectedTime || "Time pending from Bokun"}
                </div>
              )}
            </div>
          </div>
        ) : null}

        <div className="single-option-actions">
          <Button
            variant={isSelected ? "secondary" : "outline-secondary"}
            onClick={() => onSelect(option)}
          >
            {isSelected ? "Option selected" : "Select option"}
          </Button>
          {canBookFromCard ? (
            <Button className="premium-btn text-white" onClick={handleBookOption}>
              Book this option <BsArrowRight className="ms-1" />
            </Button>
          ) : (
            <Button variant="outline-secondary" disabled>
              Check availability first
            </Button>
          )}
        </div>
      </Card.Body>
    </Card>
  );
};

export default OptionCard;
