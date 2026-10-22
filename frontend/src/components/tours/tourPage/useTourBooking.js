import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchProductBookingConfig } from "../../../api/bokunApi";
import { fetchTourAvailableDates, fetchTourOptionQuotes } from "../../../api/toursApi";
import { startTourCheckout } from "../single/tourCheckout";
import { pricePresentation } from "../single/pricePresentation";
import { trackSelectDate, trackSelectOption, trackSelectTravelers } from "../../../utils/analytics";
import { bookableSlots, displayOptionName, isAdultCategory, needsTimeChoice, paxFromCounts, slotKey, travellerCategories } from "./bookingHelpers";

export { ageLabel, displayOptionName, paxFromCounts, travellerCategories, travellersLabel } from "./bookingHelpers";

const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

// The trip a link asks for (checkout's "Back to tour" / "Change date or travelers"): option, date, time, travellers.
const readPrefill = (searchParams) => {
  const date = String(searchParams.get("date") || "").trim();
  let passengers = [];
  try {
    passengers = JSON.parse(searchParams.get("passengers") || "[]");
  } catch {
    passengers = [];
  }
  return {
    optionId: String(searchParams.get("option") || "").trim(),
    travelDate: /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= todayIso() ? date : "",
    time: String(searchParams.get("time") || "").trim(),
    counts: Object.fromEntries(
      (Array.isArray(passengers) ? passengers : [])
        .map((row) => [String(row?.pricingCategoryId || row?.categoryId || ""), Math.max(0, Number(row?.quantity) || 0)])
        .filter(([id]) => id)
    )
  };
};

// Booking state for the tour page: travellers, date, bookable options with exact totals, start time, checkout.
const useTourBooking = (tour = {}) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [prefill] = useState(() => readPrefill(searchParams));
  const productId = String(tour.bokunProductId || "");
  const [config, setConfig] = useState(null);
  const [counts, setCounts] = useState({});
  const [travelDate, setTravelDate] = useState(prefill.travelDate);
  const [availability, setAvailability] = useState(null);
  const [quotes, setQuotes] = useState(null);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [quotesError, setQuotesError] = useState("");
  const [selectedOptionId, setSelectedOptionId] = useState(prefill.optionId);
  const [slotByOption, setSlotByOption] = useState({});
  const quoteSeq = useRef(0);

  useEffect(() => {
    if (!productId) return undefined;
    let active = true;
    fetchProductBookingConfig(productId)
      .then((result) => {
        if (!active) return;
        setConfig(result);
        const categories = travellerCategories(result);
        setCounts((current) => {
          if (Object.keys(current).length) return current;
          const next = {};
          const asked = categories.some((category) => prefill.counts[category.id] > 0);
          categories.forEach((category, index) => {
            next[category.id] = asked
              ? Math.min(category.max, Math.max(category.min, prefill.counts[category.id] || 0))
              : Math.max(category.min, category.defaultQuantity, index === 0 && isAdultCategory(category) ? 1 : 0);
          });
          return next;
        });
      })
      .catch(() => active && setConfig({}));
    return () => { active = false; };
  }, [productId]);

  useEffect(() => {
    if (!tour.slug) return undefined;
    let active = true;
    fetchTourAvailableDates(tour.slug, { from: todayIso(), days: 90 })
      .then((result) => active && result && setAvailability({ startDate: result.startDate, endDate: result.endDate, dates: new Set(result.availableDates || []) }))
      .catch(() => {});
    return () => { active = false; };
  }, [tour.slug]);

  const categories = useMemo(() => travellerCategories(config || {}), [config]);
  const pax = useMemo(() => paxFromCounts(categories, counts), [categories, counts]);
  const travellerCount = pax.adults + pax.children + pax.infants;
  const passengers = useMemo(
    () => categories.map((category) => ({ pricingCategoryId: category.id, quantity: Math.max(0, Number(counts[category.id] || 0)) })).filter((row) => row.quantity > 0),
    [categories, counts]
  );
  const rateId = String(config?.defaultRateId || "");

  // Exact totals for every option whenever the date or the travellers change.
  useEffect(() => {
    if (!tour.slug || !travelDate || !passengers.length || !config) {
      setQuotes(null);
      return undefined;
    }
    const seq = ++quoteSeq.current;
    setQuotesLoading(true);
    setQuotesError("");
    const timer = setTimeout(() => {
      fetchTourOptionQuotes(tour.slug, { travelDate, passengers, rateId })
        .then((result) => {
          if (seq !== quoteSeq.current) return;
          setQuotes(result);
        })
        .catch((error) => {
          if (seq !== quoteSeq.current) return;
          setQuotes(null);
          setQuotesError(error.message || "Could not load prices for this date. Please try again.");
        })
        .finally(() => seq === quoteSeq.current && setQuotesLoading(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [tour.slug, travelDate, passengers, rateId, config]);

  const options = useMemo(() => {
    const byId = new Map((quotes?.options || []).map((option) => [String(option.optionId), option]));
    return (tour.options || [])
      .filter((option) => option?.active !== false)
      .map((option) => {
        const quote = byId.get(String(option.bokunOptionId));
        const slots = bookableSlots(quote?.slots);
        return {
          id: String(option.bokunOptionId),
          option,
          name: displayOptionName(option.name),
          description: String(option.description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
          available: Boolean(quote?.available) && slots.length > 0,
          total: Number(quote?.total) > 0 ? Number(quote.total) : null,
          currency: quote?.currency || quotes?.currency || tour.currency || "USD",
          pricingType: quote?.pricingType || option.pricingType || "",
          capacityLeft: Number(quote?.capacityLeft || 0),
          slots
        };
      })
      .filter((option) => !quotes || option.available)
      .sort((a, b) => (a.total ?? Infinity) - (b.total ?? Infinity));
  }, [quotes, tour.options, tour.currency]);

  const lowestOptionId = options.find((option) => option.total)?.id || "";

  // Keep the guest's option when it is still bookable; otherwise select the lowest price.
  useEffect(() => {
    if (!quotes) return;
    setSelectedOptionId((current) => (options.some((option) => option.id === current) ? current : lowestOptionId || options[0]?.id || ""));
  }, [quotes, options, lowestOptionId]);

  const selectedOption = options.find((option) => option.id === selectedOptionId) || null;
  const selectedSlot = selectedOption
    ? selectedOption.slots.find((slot) => slotKey(slot) === slotByOption[selectedOption.id]) ||
      (selectedOption.id === prefill.optionId && selectedOption.slots.find((slot) => slot.time === prefill.time)) ||
      (needsTimeChoice(selectedOption.slots) ? null : selectedOption.slots[0]) ||
      null
    : null;

  const startingPrice = useMemo(() => {
    const preview = config?.startingPrice;
    if (preview && Number(config?.startingFromPrice) > 0) {
      const display = pricePresentation({ ...preview, amount: Number(config.startingFromPrice), isTotal: true });
      return { amount: display.amount, currency: preview.currency || config.currency || "USD", label: preview.pricingType === "per_group" ? "per group" : "per adult" };
    }
    return Number(tour.fromPrice) > 0 ? { amount: Number(tour.fromPrice), currency: tour.currency || "USD", label: "per adult" } : null;
  }, [config, tour.fromPrice, tour.currency]);

  const setCount = useCallback((categoryId, value) => {
    setCounts((current) => {
      const category = categories.find((item) => item.id === categoryId);
      if (!category) return current;
      const next = { ...current, [categoryId]: Math.max(category.min, Math.min(category.max, value)) };
      const nextPax = paxFromCounts(categories, next);
      if (nextPax.adults < 1 && categories.some(isAdultCategory)) return current;
      trackSelectTravelers(tour, nextPax.adults + nextPax.children + nextPax.infants);
      return next;
    });
  }, [categories, tour]);

  const chooseDate = useCallback((date) => {
    setTravelDate(date);
    if (date) trackSelectDate(tour, travellerCount);
  }, [tour, travellerCount]);

  const chooseOption = useCallback((optionId) => {
    setSelectedOptionId(optionId);
    trackSelectOption(tour, travellerCount);
  }, [tour, travellerCount]);

  const chooseSlot = useCallback((optionId, slot) => {
    setSelectedOptionId(optionId);
    setSlotByOption((current) => ({ ...current, [optionId]: slotKey(slot) }));
  }, []);

  const canBook = Boolean(selectedOption && selectedSlot && travelDate && passengers.length && rateId && selectedOption.total);

  const book = useCallback(() => {
    if (!canBook) return false;
    return startTourCheckout({
      tour,
      navigate,
      option: selectedOption.option,
      travelDate,
      rateId,
      startTime: selectedSlot.time,
      startTimeSlot: { ...selectedSlot },
      passengers,
      pax,
      // Checkout shows this total at once while it confirms the live price.
      quote: { total: selectedOption.total, currency: selectedOption.currency }
    });
  }, [canBook, tour, navigate, selectedOption, travelDate, rateId, selectedSlot, passengers, pax]);

  return {
    ready: Boolean(config),
    categories,
    counts,
    pax,
    travellerCount,
    setCount,
    travelDate,
    chooseDate,
    availability,
    quotesLoading,
    quotesError,
    hasQuotes: Boolean(quotes),
    options,
    lowestOptionId,
    selectedOption,
    selectedSlot,
    chooseOption,
    chooseSlot,
    slotKey,
    startingPrice,
    cancellationSummary: String(config?.cancellationPolicy?.policySummary || tour.cancellationPolicy || ""),
    startTimes: [...new Set(options.flatMap((option) => option.slots.map((slot) => slot.time)))].sort(),
    lowAvailability: Boolean(selectedOption && selectedOption.capacityLeft > 0 && selectedOption.capacityLeft <= 5),
    canBook,
    book
  };
};

export default useTourBooking;
