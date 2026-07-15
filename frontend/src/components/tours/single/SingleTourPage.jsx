import { useEffect, useMemo, useRef, useState } from "react";
import { Container } from "react-bootstrap";
import { useNavigate, useSearchParams } from "react-router-dom";
import ProductGallery from "./ProductGallery";
import ProductHeader from "./ProductHeader";
import QuickFactCards from "./QuickFactCards";
import StickyAvailabilityCard from "./StickyAvailabilityCard";
import AboutTourSection from "./AboutTourSection";
import ItineraryTimeline from "./ItineraryTimeline";
import MeetingPickupCards from "./MeetingPickupCards";
import IncludedExcludedCards from "./IncludedExcludedCards";
import ImportantInfoCard from "./ImportantInfoCard";
import ProductTopRow from "./ProductTopRow";
import ProductDetailTabs from "./ProductDetailTabs";
import ProductSidebarInfo from "./ProductSidebarInfo";
import MobileBookingBar from "./MobileBookingBar";
import AvailabilityOptionModal from "./availabilityPicker/AvailabilityOptionModal";
import { buildItinerary } from "./singleTour.helpers";
import { checkTourOptionsAvailability } from "../../../api/toursApi";
import { saveBookingSession } from "../../../utils/bookingSession";

const SingleTourPage = ({
  tour = {},
  portal = "public",
  checkoutPath = "",
  sessionSource = "single_product_page"
}) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }

    return window.matchMedia("(min-width: 1024px)").matches;
  });
  const preferredOptionId = String(searchParams.get("option") || "").trim();
  const preferredCatalogId = String(searchParams.get("catalog") || "").trim();
  const preferredTravelDate = String(searchParams.get("date") || "").trim();
  const preferredStartTime = String(searchParams.get("time") || "").trim();
  const preferredPassengers = useMemo(() => {
    const raw = String(searchParams.get("passengers") || "").trim();
    if (!raw) {
      return [];
    }

    try {
      return JSON.parse(decodeURIComponent(raw));
    } catch {
      try {
        return JSON.parse(raw);
      } catch {
        return [];
      }
    }
  }, [searchParams]);
  const activeOptions = useMemo(
    () => (tour.options || []).filter((option) => option.active !== false),
    [tour.options]
  );
  const [selectedOptionId, setSelectedOptionId] = useState("");
  const [travelDate, setTravelDate] = useState("");
  const [selectedPriceCatalogId, setSelectedPriceCatalogId] = useState("");
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [availabilityResult, setAvailabilityResult] = useState(null);
  const [selectedStartTimesByOption, setSelectedStartTimesByOption] = useState({});
  const [selectedPassengers, setSelectedPassengers] = useState([]);
  const [selectedPax, setSelectedPax] = useState({ adults: 1, children: 0, infants: 0 });
  const [selectedRateLabel, setSelectedRateLabel] = useState("");
  const [showAvailabilityPicker, setShowAvailabilityPicker] = useState(false);
  const [latestQuote, setLatestQuote] = useState(null);
  const lastAvailabilityCheckKeyRef = useRef("");
  const mobileBookingRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const handleBreakpointChange = (event) => {
      setIsDesktop(event.matches);
    };

    setIsDesktop(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleBreakpointChange);
      return () => mediaQuery.removeEventListener("change", handleBreakpointChange);
    }

    mediaQuery.addListener(handleBreakpointChange);
    return () => mediaQuery.removeListener(handleBreakpointChange);
  }, []);

  useEffect(() => {
    const firstOptionId = activeOptions[0]?.bokunOptionId || "";
    const preferredExists = activeOptions.some(
      (option) => String(option.bokunOptionId || "") === preferredOptionId
    );
    const nextOptionId = preferredExists ? preferredOptionId : firstOptionId;
    setSelectedOptionId(nextOptionId);
  }, [activeOptions, preferredOptionId]);

  useEffect(() => {
    if (!preferredStartTime) {
      return;
    }

    const targetOptionId = String(preferredOptionId || selectedOptionId || "").trim();
    if (!targetOptionId) {
      return;
    }

    setSelectedStartTimesByOption((prev) => {
      if (prev[targetOptionId]) {
        return prev;
      }

      return {
        ...prev,
        [targetOptionId]: normalizeTimeToken(preferredStartTime)
      };
    });
  }, [preferredStartTime, preferredOptionId, selectedOptionId]);

  const selectedOption =
    activeOptions.find((option) => String(option.bokunOptionId) === String(selectedOptionId)) || null;

  const itinerary = useMemo(() => buildItinerary(tour), [tour]);
  const normalizeOptionId = (value) => String(value || "").trim();
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
  const getFirstAvailableTime = (optionAvailability = {}) => {
    const openSlot =
      (optionAvailability?.slots || []).find(
        (slot) => slot?.status === "available" || slot?.status === "limited"
      ) || null;

    return (
      normalizeTimeToken(openSlot?.time) ||
      normalizeTimeToken(optionAvailability?.firstAvailableStartTime) ||
      normalizeTimeToken(optionAvailability?.cheapestStartTime) ||
      ""
    );
  };

  const availableOptionIdSet = useMemo(
    () => new Set((availabilityResult?.availableOptionIds || []).map((id) => normalizeOptionId(id))),
    [availabilityResult]
  );

  const liveByOptionId = useMemo(
    () =>
      new Map(
        (availabilityResult?.options || []).map((item) => [normalizeOptionId(item.optionId), item])
      ),
    [availabilityResult]
  );

  const optionsToRender = useMemo(() => {
    if (!availabilityResult) {
      return activeOptions.map((option) => ({
        ...option,
        liveAvailability: null
      }));
    }

    return activeOptions
      .filter((option) => availableOptionIdSet.has(normalizeOptionId(option.bokunOptionId)))
      .map((option) => ({
        ...option,
        liveAvailability: liveByOptionId.get(normalizeOptionId(option.bokunOptionId)) || null,
        selectedStartTime: selectedStartTimesByOption[normalizeOptionId(option.bokunOptionId)] || ""
      }));
  }, [activeOptions, availabilityResult, availableOptionIdSet, liveByOptionId, selectedStartTimesByOption]);

  const handleSelectOption = (option) => {
    const nextOptionId = option?.bokunOptionId || "";
    setSelectedOptionId(nextOptionId);
  };

  const handleOptionStartTimeChange = (optionId, startTime) => {
    const normalizedOptionId = normalizeOptionId(optionId);
    setSelectedStartTimesByOption((prev) => ({
      ...prev,
      [normalizedOptionId]: normalizeTimeToken(startTime)
    }));

    if (normalizedOptionId) {
      setSelectedOptionId(normalizedOptionId);
    }
  };

  const handleLiveAvailabilityChecked = async ({
    travelDate: nextTravelDate = "",
    rateId = "",
    rateLabel = "",
    pax = { adults: 1, children: 0, infants: 0 },
    passengers = [],
    quote = null,
    triggerSource = "manual"
  } = {}) => {
    if (!nextTravelDate || checkingAvailability) {
      return;
    }

    const normalizedPax = {
      adults: Math.max(0, Number(pax?.adults || 0)),
      children: Math.max(0, Number(pax?.children || 0)),
      infants: Math.max(0, Number(pax?.infants || 0))
    };
    const normalizedPassengers = (Array.isArray(passengers) ? passengers : [])
      .map((row = {}) => ({
        pricingCategoryId: String(row.pricingCategoryId || row.categoryId || "").trim(),
        quantity: Math.max(0, Number(row.quantity || 0))
      }))
      .filter((row) => row.pricingCategoryId);
    const availabilityRequestKey = JSON.stringify({
      travelDate: nextTravelDate,
      rateId: String(rateId || ""),
      passengers: normalizedPassengers
    });

    setTravelDate(nextTravelDate);
    setSelectedPriceCatalogId(String(rateId || ""));
    setSelectedRateLabel(String(rateLabel || ""));
    setSelectedPax(normalizedPax);
    setSelectedPassengers(normalizedPassengers);
    setLatestQuote(quote || null);
    if (triggerSource === "manual") {
      setShowAvailabilityPicker(true);
    }

    if (lastAvailabilityCheckKeyRef.current === availabilityRequestKey && availabilityResult) {
      setAvailabilityError("");
      return;
    }

    setAvailabilityResult(null);
    setAvailabilityError("");

    setCheckingAvailability(true);
    setAvailabilityError("");

    try {
      const result = await checkTourOptionsAvailability(tour.slug, {
        travelDate: nextTravelDate,
        pax: normalizedPax,
        priceCatalogId: String(rateId || "")
      });

      setAvailabilityResult(result);
      lastAvailabilityCheckKeyRef.current = availabilityRequestKey;
      setSelectedStartTimesByOption((prev) => {
        const next = {};

        (result?.options || []).forEach((optionAvailability) => {
          const optionId = normalizeOptionId(optionAvailability?.optionId);
          if (!optionId) {
            return;
          }

          const openTimes = (optionAvailability?.slots || [])
            .filter((slot) => slot?.status === "available" || slot?.status === "limited")
            .map((slot) => normalizeTimeToken(slot.time))
            .filter(Boolean);
          const previousTime = normalizeTimeToken(prev[optionId]);
          const defaultTime = getFirstAvailableTime(optionAvailability);

          if (previousTime && openTimes.includes(previousTime)) {
            next[optionId] = previousTime;
          } else {
            next[optionId] = defaultTime;
          }
        });

        return next;
      });

      const availableIds = (result?.availableOptionIds || []).map((id) => String(id));
      const lowestOptionId = String(result?.lowestPriceForTwo?.optionId || "");
      if (availableIds.length) {
        if (lowestOptionId && availableIds.includes(lowestOptionId)) {
          setSelectedOptionId(lowestOptionId);
        } else if (!availableIds.includes(String(selectedOptionId))) {
          setSelectedOptionId(availableIds[0]);
        }
      } else {
        setSelectedOptionId("");
      }
    } catch (error) {
      setAvailabilityError(error.message || "Could not check live availability right now");
      setLatestQuote(null);
    } finally {
      setCheckingAvailability(false);
    }
  };

  const handleBookOption = (option, { startTime = "", travelDate: nextDate = "", rateId = "" } = {}) => {
    const optionId = String(option?.bokunOptionId || "").trim();
    const resolvedDate = String(nextDate || travelDate || "").trim();
    const resolvedRateId = String(rateId || selectedPriceCatalogId || "").trim();
    const resolvedStartTime = normalizeTimeToken(
      startTime || selectedStartTimesByOption[String(optionId || "").trim()] || preferredStartTime || ""
    );
    const normalizedPassengers = (selectedPassengers || [])
      .map((row = {}) => ({
        pricingCategoryId: String(row.pricingCategoryId || "").trim(),
        quantity: Math.max(0, Number(row.quantity || 0))
      }))
      .filter((row) => row.pricingCategoryId && row.quantity > 0);

    if (!optionId || !resolvedDate || !resolvedRateId || !normalizedPassengers.length) {
      return;
    }

    const selectedCatalog =
      (tour.priceCatalogs || []).find((catalog = {}) => {
        const catalogId = String(
          catalog.activityPriceCatalogId || catalog.catalogId || catalog.id || ""
        ).trim();
        return catalogId === resolvedRateId;
      }) || null;

    saveBookingSession({
      source: sessionSource,
      product: {
        productId: String(tour.bokunProductId || ""),
        slug: tour.slug,
        title: tour.title
      },
      tripDetails: {
        optionId,
        optionTitle: option?.name || "",
        rateId: resolvedRateId,
        rateTitle: selectedCatalog?.title || selectedCatalog?.label || "",
        travelDate: resolvedDate,
        startTime: resolvedStartTime,
        passengers: normalizedPassengers,
        pax: selectedPax
      },
      availabilityQuote: latestQuote || null,
      currency: latestQuote?.currency || tour.currency || "USD",
      tripDetailsCompleted: true,
      availabilityChecked: true
    });

    const query = new URLSearchParams();
    query.set("option", optionId);
    query.set("date", resolvedDate);
    query.set("catalog", resolvedRateId);
    query.set("passengers", JSON.stringify(normalizedPassengers));

    if (resolvedStartTime) {
      query.set("time", resolvedStartTime);
    }

    if (Number(selectedPax?.adults || 0) > 0) {
      query.set("adults", String(selectedPax.adults));
    }

    const resolvedCheckoutPath = checkoutPath || `/booking/${tour.slug}`;
    navigate(`${resolvedCheckoutPath}?${query.toString()}`);
  };

  const selectedOptionStartTime =
    selectedStartTimesByOption[normalizeOptionId(selectedOption?.bokunOptionId)] || "";

  const availabilityCardProps = {
    tour,
    selectedOption,
    selectedStartTime: selectedOptionStartTime,
    initialSelection: {
      rateId: preferredCatalogId,
      travelDate: preferredTravelDate,
      startTime: preferredStartTime,
      passengers: preferredPassengers
    },
    onLiveAvailabilityChecked: handleLiveAvailabilityChecked,
    hideContinueButton: true,
    checkoutPath,
    sessionSource
  };

  const handleContinueWithOption = (option, startTime = "") => {
    handleSelectOption(option);
    handleBookOption(option, {
      startTime,
      travelDate,
      rateId: selectedPriceCatalogId
    });
  };

  const handleEditSearch = () => {
    setShowAvailabilityPicker(false);

    if (typeof window !== "undefined") {
      const card = window.document.querySelector(".single-booking-card");
      if (card?.scrollIntoView) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  };

  const openMobileBooking = () => {
    mobileBookingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const hasIncluded = Boolean((tour.included || []).length || (tour.excluded || []).length);
  const hasMeeting = Boolean(tour.meetingInfo || tour.pickupInfo);
  const hasImportantInformation = Boolean((tour.importantInformation || []).length);
  const hasReviews = Number(tour.rating || 0) > 0 || Number(tour.reviewCount || 0) > 0;

  return (
    <main className={`single-tour-page product-detail-page ${portal === "agent" ? "agent-tour-booking-page" : ""}`}>
      <Container className="product-detail-shell">
        <ProductTopRow rating={tour.rating} reviewCount={tour.reviewCount} />

        <div className="product-detail-layout">
          <article className="single-tour-left-column product-detail-main">
            <ProductGallery images={tour.images} title={tour.title} videoUrl={tour.videoUrl} bestSeller={tour.bestSeller} />
            <ProductHeader tour={tour} />
            <QuickFactCards tour={tour} />

            {tour.description ? <div id="about" className="product-detail-section"><AboutTourSection description={tour.description} /></div> : null}

            <ProductDetailTabs
              hasIncluded={hasIncluded}
              hasMeeting={hasMeeting}
              hasImportantInfo={hasImportantInformation}
              hasReviews={hasReviews}
            />

            <ItineraryTimeline itinerary={itinerary} />
            {hasIncluded ? <div id="included" className="product-detail-section"><IncludedExcludedCards included={tour.included} excluded={tour.excluded} /></div> : null}
            {hasMeeting ? <div id="meeting-pickup" className="product-detail-section"><MeetingPickupCards meetingInfo={tour.meetingInfo} pickupInfo={tour.pickupInfo} /></div> : null}
            {hasImportantInformation ? <div id="important-info" className="product-detail-section"><ImportantInfoCard importantInformation={tour.importantInformation} /></div> : null}
            {hasReviews ? <section id="reviews" className="single-tour-section product-detail-section product-reviews-summary"><h3>Reviews</h3><p>{Number(tour.rating).toFixed(1)} rating from {Number(tour.reviewCount || 0)} verified guest reviews.</p></section> : null}

            {!isDesktop ? <div className="single-product-mobile-booking-form" ref={mobileBookingRef}><StickyAvailabilityCard {...availabilityCardProps} /></div> : null}
            {availabilityError ? <div className="single-booking-inline-error mt-3">{availabilityError}</div> : null}
          </article>

          {isDesktop ? <aside className="product-detail-sidebar"><div className="product-detail-sidebar-inner"><StickyAvailabilityCard {...availabilityCardProps} /><ProductSidebarInfo tour={tour} /></div></aside> : null}
        </div>
      </Container>

      {!isDesktop ? <MobileBookingBar amount={tour.fromPrice} currency={tour.currency} onOpenBooking={openMobileBooking} /> : null}

      <AvailabilityOptionModal
        show={showAvailabilityPicker}
        isDesktop={isDesktop}
        loading={checkingAvailability}
        error={availabilityError}
        options={optionsToRender}
        selectedOptionId={selectedOptionId}
        travelDate={travelDate}
        pax={selectedPax}
        selectedRateLabel={selectedRateLabel}
        selectedStartTimesByOption={selectedStartTimesByOption}
        onClose={() => setShowAvailabilityPicker(false)}
        onEditSearch={handleEditSearch}
        onSelectOption={handleSelectOption}
        onChangeStartTime={handleOptionStartTimeChange}
        onContinue={handleContinueWithOption}
      />
    </main>
  );
};

export default SingleTourPage;
