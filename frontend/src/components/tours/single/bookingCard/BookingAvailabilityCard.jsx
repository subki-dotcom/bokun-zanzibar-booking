import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Spinner } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import { BsArrowRight, BsSignpostSplit } from "react-icons/bs";
import { fetchProductBookingConfig, fetchProductLiveQuote } from "../../../../api/bokunApi";
import { saveBookingSession } from "../../../../utils/bookingSession";
import PriceCatalogSelect from "./PriceCatalogSelect";
import PassengerCategorySelector from "./PassengerCategorySelector";
import DateAvailabilityPicker from "./DateAvailabilityPicker";
import StartingPriceBox from "./StartingPriceBox";
import BookingTrustNotes from "./BookingTrustNotes";
import {
  buildDefaultPassengerState,
  formatPriceLabel,
  mapBokunPricingCategories,
  mapBokunRatesToPriceCatalogOptions,
  resetQuoteOnSelectionChange
} from "../bookingCard.helpers";

const quantityFromPassengerRows = (rows = []) =>
  (rows || []).reduce((sum, row) => sum + Math.max(0, Number(row.quantity || 0)), 0);

const derivePaxFromPassengers = (passengers = [], categories = []) => {
  const categoryById = new Map(
    (categories || []).map((category) => [String(category.id || ""), category])
  );

  const summary = {
    adults: 0,
    children: 0,
    infants: 0
  };

  (passengers || []).forEach((row) => {
    const qty = Math.max(0, Number(row.quantity || 0));
    if (qty <= 0) {
      return;
    }

    const category = categoryById.get(String(row.pricingCategoryId || ""));
    const token = `${category?.label || ""}`.toLowerCase();
    if (token.includes("adult")) {
      summary.adults += qty;
      return;
    }

    if (token.includes("child")) {
      summary.children += qty;
      return;
    }

    if (token.includes("infant") || token.includes("baby")) {
      summary.infants += qty;
      return;
    }

    summary.adults += qty;
  });

  if (summary.adults + summary.children + summary.infants <= 0) {
    summary.adults = 1;
  }

  return summary;
};

const BookingAvailabilityCard = ({
  tour = {},
  selectedOption = null,
  selectedStartTime = "",
  initialSelection = null,
  onLiveAvailabilityChecked
}) => {
  const navigate = useNavigate();
  const initialAppliedRef = useRef(false);
  const onLiveAvailabilityCheckedRef = useRef(onLiveAvailabilityChecked);
  const quoteRequestSeqRef = useRef(0);
  const quoteLoadingRef = useRef(false);
  const lastAutoQuoteKeyRef = useRef("");
  const lastQuoteRequestKeyRef = useRef("");
  const lastQuoteRequestAtRef = useRef(0);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState("");
  const [rateOptions, setRateOptions] = useState([]);
  const [selectedRateId, setSelectedRateId] = useState("");
  const [pricingCategories, setPricingCategories] = useState([]);
  const [passengers, setPassengers] = useState([]);
  const [travelDate, setTravelDate] = useState("");
  const [startingFromPrice, setStartingFromPrice] = useState(0);
  const [bookingCurrency, setBookingCurrency] = useState(tour.currency || "USD");
  const [quote, setQuote] = useState(null);
  const [quoteStatus, setQuoteStatus] = useState("idle");
  const [quoteError, setQuoteError] = useState("");
  const [quoteLoading, setQuoteLoading] = useState(false);

  const productId = String(tour.bokunProductId || "");
  const seededStartTime = String(initialSelection?.startTime || "").trim();
  const resolvedSelectedStartTime = String(selectedStartTime || seededStartTime || "").trim();
  const passengersKey = useMemo(() => JSON.stringify(passengers), [passengers]);
  const autoQuoteKey = useMemo(
    () =>
      JSON.stringify({
        productId,
        selectedRateId,
        travelDate,
        bookingCurrency,
        passengers
      }),
    [productId, selectedRateId, travelDate, bookingCurrency, passengers]
  );
  const totalPassengers = useMemo(() => quantityFromPassengerRows(passengers), [passengers]);
  const paxSummary = useMemo(
    () => derivePaxFromPassengers(passengers, pricingCategories),
    [passengers, pricingCategories]
  );

  useEffect(() => {
    onLiveAvailabilityCheckedRef.current = onLiveAvailabilityChecked;
  }, [onLiveAvailabilityChecked]);

  useEffect(() => {
    quoteLoadingRef.current = quoteLoading;
  }, [quoteLoading]);

  const loadBookingConfig = useCallback(
    async (preferredRateId = "", { keepTravelDate = true } = {}) => {
      if (!productId) {
        return;
      }

      quoteRequestSeqRef.current += 1;
      setConfigLoading(true);
      setConfigError("");
      setQuoteLoading(false);

      try {
        const config = await fetchProductBookingConfig(productId, preferredRateId ? { rateId: preferredRateId } : {});
        const nextRateOptions = mapBokunRatesToPriceCatalogOptions(config.rateOptions || []);
        const nextSelectedRateId =
          String(config.defaultRateId || "").trim() ||
          String(nextRateOptions[0]?.id || "").trim();
        const nextCategories = mapBokunPricingCategories(
          config.pricingCategories || config.defaultPricingCategories || []
        );
        const nextPassengers = buildDefaultPassengerState(nextCategories);

        setRateOptions(nextRateOptions);
        setSelectedRateId(nextSelectedRateId);
        setPricingCategories(nextCategories);
        setPassengers(nextPassengers);
        setBookingCurrency(config.currency || tour.currency || "USD");
        setStartingFromPrice(Number(config.startingFromPrice || 0));
        setQuote((prev) =>
          resetQuoteOnSelectionChange({
            ...prev
          }).quote
        );
        setQuoteStatus("idle");
        setQuoteError("");
        if (!keepTravelDate) {
          setTravelDate("");
        }
      } catch (error) {
        setConfigError(error.message || "Could not load booking config");
      } finally {
        setConfigLoading(false);
      }
    },
    [productId, tour.currency]
  );

  useEffect(() => {
    initialAppliedRef.current = false;
    setTravelDate("");
    setQuote(null);
    setQuoteStatus("idle");
    setQuoteError("");
    loadBookingConfig(String(initialSelection?.rateId || ""), { keepTravelDate: false });
  }, [loadBookingConfig, initialSelection?.rateId]);

  useEffect(() => {
    if (initialAppliedRef.current || configLoading || !pricingCategories.length) {
      return;
    }

    const rawPassengers = Array.isArray(initialSelection?.passengers)
      ? initialSelection.passengers
      : [];
    const incomingQtyByCategory = new Map(
      rawPassengers.map((row = {}) => [
        String(row.categoryId || row.pricingCategoryId || ""),
        Math.max(0, Number(row.quantity || 0))
      ])
    );

    if (incomingQtyByCategory.size > 0) {
      setPassengers((prev) =>
        prev.map((row) => {
          const nextQuantity = incomingQtyByCategory.get(String(row.pricingCategoryId || ""));
          return nextQuantity === undefined ? row : { ...row, quantity: nextQuantity };
        })
      );
    }

    const seededDate = String(initialSelection?.travelDate || "").trim();
    if (seededDate) {
      setTravelDate(seededDate);
    }

    initialAppliedRef.current = true;
  }, [initialSelection, configLoading, pricingCategories]);

  const canRequestQuote = Boolean(productId && selectedRateId && travelDate && totalPassengers > 0);

  const requestLiveQuote = useCallback(
    async ({ silent = false } = {}) => {
      if (!canRequestQuote || quoteLoadingRef.current) {
        return null;
      }

      const payloadKey = JSON.stringify({
        productId,
        selectedRateId,
        travelDate,
        bookingCurrency,
        passengers
      });

      if (payloadKey === lastQuoteRequestKeyRef.current) {
        const elapsedMs = Date.now() - Number(lastQuoteRequestAtRef.current || 0);
        if (elapsedMs < 1200) {
          return quote || null;
        }
      }

      lastQuoteRequestKeyRef.current = payloadKey;
      lastQuoteRequestAtRef.current = Date.now();

      const requestSeq = quoteRequestSeqRef.current + 1;
      quoteRequestSeqRef.current = requestSeq;
      setQuoteLoading(true);
      if (!silent) {
        setQuoteError("");
      }

      try {
        const response = await fetchProductLiveQuote(productId, {
          rateId: selectedRateId,
          date: travelDate,
          passengers,
          currency: bookingCurrency
        });
        if (requestSeq !== quoteRequestSeqRef.current) {
          return null;
        }

        setQuote(response);
        setQuoteStatus("success");
        setQuoteError("");

        onLiveAvailabilityCheckedRef.current?.({
          travelDate,
          rateId: selectedRateId,
          passengers,
          pax: paxSummary,
          quote: response
        });

        return response;
      } catch (error) {
        if (requestSeq !== quoteRequestSeqRef.current) {
          return null;
        }

        setQuote(null);
        setQuoteStatus("error");
        setQuoteError(error.message || "Could not fetch live pricing");
        return null;
      } finally {
        setQuoteLoading(false);
      }
    },
    [
      canRequestQuote,
      productId,
      selectedRateId,
      travelDate,
      passengers,
      bookingCurrency,
      paxSummary
    ]
  );

  useEffect(() => {
    if (!canRequestQuote || quoteStatus !== "idle") {
      return;
    }

    if (lastAutoQuoteKeyRef.current === autoQuoteKey) {
      return;
    }

    lastAutoQuoteKeyRef.current = autoQuoteKey;

    const timer = setTimeout(() => {
      requestLiveQuote({ silent: true });
    }, 700);

    return () => clearTimeout(timer);
  }, [canRequestQuote, requestLiveQuote, autoQuoteKey, quoteStatus]);

  const handleRateChange = async (nextRateId) => {
    if (!nextRateId || String(nextRateId) === String(selectedRateId)) {
      return;
    }

    quoteRequestSeqRef.current += 1;
    lastAutoQuoteKeyRef.current = "";
    setQuoteLoading(false);
    await loadBookingConfig(nextRateId, { keepTravelDate: true });
  };

  const handlePassengerChange = (pricingCategoryId, quantity) => {
    quoteRequestSeqRef.current += 1;
    lastAutoQuoteKeyRef.current = "";
    setQuoteLoading(false);
    setPassengers((prev) => {
      const next = prev.map((row) =>
        String(row.pricingCategoryId) === String(pricingCategoryId)
          ? { ...row, quantity: Math.max(0, Number(quantity || 0)) }
          : row
      );

      return next;
    });
    setQuote((prev) => resetQuoteOnSelectionChange(prev).quote);
    setQuoteStatus("idle");
    setQuoteError("");
  };

  const handleDateChange = (nextDate) => {
    quoteRequestSeqRef.current += 1;
    lastAutoQuoteKeyRef.current = "";
    setQuoteLoading(false);
    setTravelDate(nextDate);
    setQuote((prev) => resetQuoteOnSelectionChange(prev).quote);
    setQuoteStatus("idle");
    setQuoteError("");
  };

  const primaryPriceLabel = useMemo(() => {
    if (quoteStatus === "success" && Number(quote?.totalPrice || 0) > 0) {
      return formatPriceLabel(quote.totalPrice, quote.currency || bookingCurrency, {
        fallback: "Check live pricing"
      });
    }

    return formatPriceLabel(startingFromPrice, bookingCurrency, {
      fallback: "Check live pricing",
      divideBy: 2
    });
  }, [quoteStatus, quote, startingFromPrice, bookingCurrency]);

  const priceMetaLabel =
    quoteStatus === "success" && Number(quote?.totalPrice || 0) > 0
      ? "Live total for selected passengers"
      : "per person (2 adults price / 2)";

  const canContinue = Boolean(
    productId &&
      selectedOption?.bokunOptionId &&
      selectedRateId &&
      travelDate &&
      totalPassengers > 0 &&
      quoteStatus === "success" &&
      ["AVAILABLE", "LIMITED"].includes(String(quote?.availabilityStatus || "").toUpperCase())
  );

  const continueQuery = useMemo(() => {
    const query = new URLSearchParams();
    if (selectedOption?.bokunOptionId) {
      query.set("option", String(selectedOption.bokunOptionId));
    }
    if (travelDate) {
      query.set("date", travelDate);
    }
    if (resolvedSelectedStartTime) {
      query.set("time", resolvedSelectedStartTime);
    }
    if (selectedRateId) {
      query.set("catalog", selectedRateId);
    }
    if (paxSummary.adults > 0) {
      query.set("adults", String(paxSummary.adults));
    }
    if (passengers.length > 0) {
      query.set("passengers", JSON.stringify(passengers));
    }

    return query.toString();
  }, [selectedOption?.bokunOptionId, travelDate, resolvedSelectedStartTime, selectedRateId, paxSummary.adults, passengers]);

  const continuePath = `/booking/${tour.slug}${continueQuery ? `?${continueQuery}` : ""}`;

  const handleContinueToBooking = () => {
    if (!canContinue) {
      return;
    }

    const selectedCatalog = rateOptions.find((item) => String(item.id) === String(selectedRateId));
    saveBookingSession({
      source: "single_product_page",
      product: {
        productId,
        slug: tour.slug,
        title: tour.title
      },
      tripDetails: {
        optionId: String(selectedOption?.bokunOptionId || ""),
        optionTitle: selectedOption?.name || "",
        rateId: selectedRateId,
        rateTitle: selectedCatalog?.label || "",
        travelDate,
        startTime: resolvedSelectedStartTime,
        passengers,
        pax: paxSummary
      },
      availabilityQuote: quote || null,
      currency: bookingCurrency,
      tripDetailsCompleted: true,
      availabilityChecked: true
    });

    navigate(continuePath);
  };

  return (
    <Card className="single-booking-card booking-sticky">
      <Card.Body>
        <div className="single-booking-eyebrow">Ready to book</div>
        <h4 className="single-booking-title">Check availability</h4>

        <StartingPriceBox
          label="Starting price"
          priceLabel={primaryPriceLabel}
          meta={priceMetaLabel}
          loading={configLoading}
        />

        <div className="single-booking-form mt-3">
          <PriceCatalogSelect
            options={rateOptions}
            value={selectedRateId}
            disabled={configLoading}
            onChange={handleRateChange}
          />

          <PassengerCategorySelector
            categories={pricingCategories}
            passengers={passengers}
            disabled={configLoading}
            onChangeQuantity={handlePassengerChange}
          />

          <DateAvailabilityPicker
            value={travelDate}
            disabled={configLoading}
            onChange={handleDateChange}
          />

          <Button
            className="single-booking-availability-btn w-100"
            disabled={!canRequestQuote || quoteLoading || configLoading}
            onClick={() => requestLiveQuote({ silent: false })}
          >
            {quoteLoading ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Checking...
              </>
            ) : (
              "Check availability"
            )}
          </Button>

          {configError ? <div className="single-booking-inline-error">{configError}</div> : null}
          {quoteError ? <div className="single-booking-inline-error">{quoteError}</div> : null}

          {quoteStatus === "success" ? (
            <div className="single-booking-check-result">
              Status: {quote?.availabilityStatus || "UNKNOWN"}
              {Number(quote?.remainingCapacity || 0) > 0 ? (
                <div className="mt-1">Remaining capacity: {quote.remainingCapacity}</div>
              ) : null}
              {Number(quote?.totalPrice || 0) > 0 ? (
                <div className="mt-1">
                  Live total: {formatPriceLabel(quote.totalPrice, quote.currency || bookingCurrency)}
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

        <Button className="premium-btn text-white w-100 mt-3" disabled={!canContinue} onClick={handleContinueToBooking}>
          Continue to booking
          <BsArrowRight className="ms-2" />
        </Button>

        <BookingTrustNotes />
      </Card.Body>
    </Card>
  );
};

export default BookingAvailabilityCard;
