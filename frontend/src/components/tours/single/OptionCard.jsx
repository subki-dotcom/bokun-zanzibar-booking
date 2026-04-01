import { Button, Card } from "react-bootstrap";
import { Link } from "react-router-dom";
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
  liveComparedAdults = 1,
  selectedStartTime = "",
  travelDate = "",
  adults = 1,
  onChangeStartTime,
  selectedPriceCatalogId = "",
  hasDateFilter = false,
  isSelected = false,
  onSelect
}) => {
  const optionDescription = toPlainText(option.description || "");
  const liveTotalPrice = resolveLivePriceAmount(liveAvailability?.lowestPriceForTwo);
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
  const bookingQuery = new URLSearchParams({
    option: String(option.bokunOptionId || "")
  });

  if (travelDate) {
    bookingQuery.set("date", travelDate);
  }

  if (effectiveSelectedTime) {
    bookingQuery.set("time", effectiveSelectedTime);
  }

  if (Number(adults || 0) > 0) {
    bookingQuery.set("adults", String(adults));
  }
  if (selectedPriceCatalogId) {
    bookingQuery.set("catalog", String(selectedPriceCatalogId));
  }

  const bookingPath = `/booking/${tour.slug}?${bookingQuery.toString()}`;
  const canBookFromCard = Boolean(hasDateFilter && travelDate && isLiveAvailable);

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
          amount={tour.fromPrice}
          currency={tour.currency}
          summary={option.pricingSummary}
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
                  ? `${formatCurrency(liveTotalPrice, liveCurrency)} (Adult x ${liveComparedAdults})`
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
            <Button as={Link} to={bookingPath} className="premium-btn text-white">
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
