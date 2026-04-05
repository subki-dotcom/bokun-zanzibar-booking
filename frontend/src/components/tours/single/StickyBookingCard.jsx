import { useMemo, useRef } from "react";
import { Button, Card, Form } from "react-bootstrap";
import { Link } from "react-router-dom";
import {
  BsCheckCircle,
  BsChevronDown,
  BsPeople,
  BsShieldCheck,
  BsSignpostSplit,
  BsTag
} from "react-icons/bs";
import { formatCurrency } from "../../../utils/formatters";

const extractPriceFromSummary = (value = "") => {
  const normalized = String(value || "").replace(/,/g, "");
  const match = normalized.match(/(\d+(?:\.\d+)?)/);
  if (!match) {
    return 0;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatLocalDate = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const resolveCatalogId = (catalog = {}) =>
  String(catalog?.activityPriceCatalogId || catalog?.catalogId || "").trim();

const StickyBookingCard = ({
  tour = {},
  selectedOption = null,
  adults = 1,
  travelDate = "",
  onAdultsChange,
  onTravelDateChange,
  onCheckAvailability,
  checkingAvailability = false,
  loadingStartingPrice = false,
  lowestLivePriceForTwo = null,
  availabilityResult = null,
  availabilityError = "",
  priceCatalogs = [],
  selectedPriceCatalogId = "",
  onPriceCatalogChange,
  priceCategories = []
}) => {
  const dateInputRef = useRef(null);
  const bookingQuery = new URLSearchParams();
  if (selectedOption?.bokunOptionId) {
    bookingQuery.set("option", String(selectedOption.bokunOptionId));
  }
  if (travelDate) {
    bookingQuery.set("date", travelDate);
  }
  if (Number(adults || 0) > 0) {
    bookingQuery.set("adults", String(adults));
  }
  if (selectedPriceCatalogId) {
    bookingQuery.set("catalog", String(selectedPriceCatalogId));
  }
  const bookingPath = `/booking/${tour.slug}${bookingQuery.toString() ? `?${bookingQuery.toString()}` : ""}`;
  const availableCount = Number(availabilityResult?.availableCount || 0);
  const hasAvailabilityResult = Boolean(availabilityResult?.travelDate);
  const activePriceCatalogs = (priceCatalogs || []).filter((catalog) => catalog?.active !== false);
  const selectedPriceCatalog = activePriceCatalogs.find(
    (catalog) => resolveCatalogId(catalog) === String(selectedPriceCatalogId || "")
  );
  const primaryTravelerLabel = useMemo(() => {
    const categories = (priceCategories || []).filter((category) => String(category?.categoryId || "").trim());
    if (!categories.length) {
      return "Adult";
    }

    const adultCategory = categories.find((category) =>
      `${category?.ticketCategory || ""} ${category?.title || ""}`.toLowerCase().includes("adult")
    );

    return adultCategory?.title || categories[0]?.title || "Adult";
  }, [priceCategories]);
  const minDate = useMemo(() => formatLocalDate(new Date()), []);
  const derivedLowestFromOptions = useMemo(() => {
    const candidates = (availabilityResult?.options || [])
      .filter((option) => option?.available && Number(option?.lowestPriceForTwo || 0) > 0)
      .sort((a, b) => Number(a.lowestPriceForTwo) - Number(b.lowestPriceForTwo));

    if (!candidates.length) {
      return null;
    }

    return {
      amount: Number(candidates[0].lowestPriceForTwo),
      currency: candidates[0].currency || tour.currency || "USD",
      comparedAdults: Number(availabilityResult?.comparedAdults || 2),
      optionId: String(candidates[0].optionId || "")
    };
  }, [availabilityResult, tour.currency]);
  const effectiveLowest =
    lowestLivePriceForTwo && Number(lowestLivePriceForTwo?.amount || 0) > 0
      ? lowestLivePriceForTwo
      : derivedLowestFromOptions;
  const liveFromAmount = Number(effectiveLowest?.amount || 0);
  const liveFromCurrency = effectiveLowest?.currency || tour.currency || "USD";
  const liveComparedAdults = Number(effectiveLowest?.comparedAdults || 2);
  const startingAmount = useMemo(() => {
    if (liveFromAmount > 0) {
      return liveFromAmount;
    }

    const directFromPrice = Number(tour.fromPrice || 0);
    if (directFromPrice > 0) {
      return directFromPrice;
    }

    const selectedOptionPrice = extractPriceFromSummary(selectedOption?.pricingSummary || "");
    if (selectedOptionPrice > 0) {
      return selectedOptionPrice;
    }

    const fallbackPrice = (tour.options || [])
      .map((option) => extractPriceFromSummary(option?.pricingSummary || ""))
      .find((price) => price > 0);

    return fallbackPrice || 0;
  }, [liveFromAmount, tour.fromPrice, tour.options, selectedOption?.pricingSummary]);
  const perPersonAmount = liveFromAmount > 0 ? liveFromAmount / 2 : startingAmount;
  const priceLabel = perPersonAmount > 0 ? formatCurrency(perPersonAmount, liveFromCurrency) : "Live pricing";
  const pricingMode =
    liveFromAmount > 0
      ? "per person (2 adults price / 2)"
      : String(selectedOption?.pricingSummary || "").toLowerCase().includes("group")
        ? "per group"
        : "per person";
  const pricingMetaLabel = loadingStartingPrice && liveFromAmount <= 0 ? "loading live price..." : pricingMode;

  const openDatePicker = () => {
    if (!dateInputRef.current) {
      return;
    }

    if (typeof dateInputRef.current.showPicker === "function") {
      dateInputRef.current.showPicker();
      return;
    }

    dateInputRef.current.focus();
  };

  return (
    <Card className="single-booking-card booking-sticky">
      <Card.Body>
        <div className="single-booking-eyebrow">Ready to book</div>
        <h4 className="single-booking-title">Check availability</h4>
        <div className="single-booking-starting">
          <div className="single-booking-starting-label">Starting price</div>
          <div className="single-booking-starting-value">{priceLabel}</div>
          <div className="single-booking-starting-meta">{pricingMetaLabel}</div>
        </div>

        <div className="single-booking-form mt-3">
          {activePriceCatalogs.length ? (
            <div>
              <div className="single-booking-inline-label">Price catalog (Bokun)</div>
              <div className="single-booking-select-wrap">
                <BsTag className="single-booking-input-icon" />
                <Form.Select
                  value={selectedPriceCatalogId}
                  onChange={(event) => onPriceCatalogChange?.(event.target.value)}
                  aria-label="Select price catalog"
                >
                  {activePriceCatalogs.map((catalog) => (
                    <option key={resolveCatalogId(catalog)} value={resolveCatalogId(catalog)}>
                      {catalog.title}
                      {catalog.isVendorDefault ? " (Default)" : ""}
                    </option>
                  ))}
                </Form.Select>
                <BsChevronDown className="single-booking-input-arrow" />
              </div>
            </div>
          ) : (
            <div className="single-booking-inline-muted">Using default Bokun price catalog</div>
          )}

          <div className="single-booking-select-wrap">
            <BsPeople className="single-booking-input-icon" />
            <Form.Select
              value={adults}
              onChange={(event) => onAdultsChange?.(Number(event.target.value || 1))}
              aria-label="Select travelers"
            >
              {Array.from({ length: 12 }).map((_, index) => {
                const count = index + 1;
                return (
                  <option key={count} value={count}>
                    {primaryTravelerLabel} x {count}
                  </option>
                );
              })}
            </Form.Select>
            <BsChevronDown className="single-booking-input-arrow" />
          </div>

          <div className="single-booking-select-wrap single-booking-date-wrap">
            <Form.Control
              ref={dateInputRef}
              type="date"
              min={minDate}
              value={travelDate}
              onChange={(event) => onTravelDateChange?.(event.target.value)}
              onFocus={() => openDatePicker()}
              aria-label="Select date"
            />
          </div>

          <Button
            className="single-booking-availability-btn w-100"
            onClick={onCheckAvailability}
            disabled={checkingAvailability || !travelDate}
          >
            {checkingAvailability ? "Checking..." : "Check availability"}
          </Button>

          {availabilityError ? <div className="single-booking-inline-error">{availabilityError}</div> : null}

          {hasAvailabilityResult ? (
            <div className="single-booking-check-result">
              {availableCount > 0
                ? `${availableCount} option(s) available for ${availabilityResult.travelDate}`
                : `No options available for ${availabilityResult.travelDate}`}
              {selectedPriceCatalog?.title ? (
                <div className="mt-1">Price catalog: {selectedPriceCatalog.title}</div>
              ) : null}
              {availableCount > 0 && liveFromAmount > 0 ? (
                <div className="mt-1">
                  Per person {formatCurrency(liveFromAmount / 2, liveFromCurrency)}
                  {" "}
                  ({formatCurrency(liveFromAmount, liveFromCurrency)} for {liveComparedAdults} adults)
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="single-booking-summary-list mt-3">
          <div className="summary-row">
            <span className="summary-label">
              <BsSignpostSplit className="me-2" />
              Selected option
            </span>
            <span className="summary-value">{selectedOption?.name || "Choose an option below"}</span>
          </div>
        </div>

        <Button as={Link} to={bookingPath} className="premium-btn text-white w-100 mt-3">
          Continue to booking
        </Button>

        <div className="single-booking-trust mt-3">
          <div>
            <BsShieldCheck className="me-2" />
            Live pricing and availability
          </div>
          <div>
            <BsCheckCircle className="me-2" />
            Departure time shown after date selection
          </div>
          <div>
            <BsCheckCircle className="me-2" />
            Final booking is confirmed in Bokun
          </div>
        </div>
      </Card.Body>
    </Card>
  );
};

export default StickyBookingCard;
