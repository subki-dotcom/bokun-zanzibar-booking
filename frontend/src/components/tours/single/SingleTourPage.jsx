import { useEffect, useMemo, useState } from "react";
import { Col, Container, Row } from "react-bootstrap";
import { useNavigate, useSearchParams } from "react-router-dom";
import ProductGallery from "./ProductGallery";
import ProductHeader from "./ProductHeader";
import QuickFactCards from "./QuickFactCards";
import StickyAvailabilityCard from "./StickyAvailabilityCard";
import AboutTourSection from "./AboutTourSection";
import ExperienceDetailsGrid from "./ExperienceDetailsGrid";
import ItineraryTimeline from "./ItineraryTimeline";
import MeetingPickupCards from "./MeetingPickupCards";
import IncludedExcludedCards from "./IncludedExcludedCards";
import ImportantInfoCard from "./ImportantInfoCard";
import AvailableOptionsSection from "./AvailableOptionsSection";
import { buildItinerary } from "./singleTour.helpers";
import { checkTourOptionsAvailability } from "../../../api/toursApi";
import { saveBookingSession } from "../../../utils/bookingSession";

const CollapsibleInfoBlock = ({ title = "", subtitle = "", defaultOpen = false, children = null }) => (
  <details className="single-tour-collapse-block" open={defaultOpen}>
    <summary className="single-tour-collapse-summary">
      <div>
        <div className="single-tour-collapse-title">{title}</div>
        {subtitle ? <div className="single-tour-collapse-subtitle">{subtitle}</div> : null}
      </div>
    </summary>
    <div className="single-tour-collapse-content">{children}</div>
  </details>
);

const SingleTourPage = ({ tour = {} }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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
  const [latestQuote, setLatestQuote] = useState(null);

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
        [targetOptionId]: preferredStartTime
      };
    });
  }, [preferredStartTime, preferredOptionId, selectedOptionId]);

  const selectedOption =
    activeOptions.find((option) => String(option.bokunOptionId) === String(selectedOptionId)) || null;

  const itinerary = useMemo(() => buildItinerary(tour), [tour]);
  const normalizeOptionId = (value) => String(value || "").trim();
  const getFirstAvailableTime = (optionAvailability = {}) => {
    const openSlot =
      (optionAvailability?.slots || []).find(
        (slot) => slot?.status === "available" || slot?.status === "limited"
      ) || null;

    return (
      openSlot?.time ||
      optionAvailability?.firstAvailableStartTime ||
      optionAvailability?.cheapestStartTime ||
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

  const clearAvailabilityFilter = () => {
    setAvailabilityResult(null);
    setAvailabilityError("");
    setSelectedStartTimesByOption({});
  };

  const handleSelectOption = (option) => {
    const nextOptionId = option?.bokunOptionId || "";
    setSelectedOptionId(nextOptionId);
  };

  const handleOptionStartTimeChange = (optionId, startTime) => {
    const normalizedOptionId = normalizeOptionId(optionId);
    setSelectedStartTimesByOption((prev) => ({
      ...prev,
      [normalizedOptionId]: String(startTime || "")
    }));
  };

  const handleLiveAvailabilityChecked = async ({
    travelDate: nextTravelDate = "",
    rateId = "",
    pax = { adults: 1, children: 0, infants: 0 },
    passengers = [],
    quote = null
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

    setTravelDate(nextTravelDate);
    setSelectedPriceCatalogId(String(rateId || ""));
    setSelectedPax(normalizedPax);
    setSelectedPassengers(normalizedPassengers);
    setLatestQuote(quote || null);
    setCheckingAvailability(true);
    setAvailabilityError("");

    try {
      const result = await checkTourOptionsAvailability(tour.slug, {
        travelDate: nextTravelDate,
        pax: normalizedPax,
        priceCatalogId: String(rateId || "")
      });

      setAvailabilityResult(result);
      setSelectedStartTimesByOption((prev) => {
        const next = {};

        (result?.options || []).forEach((optionAvailability) => {
          const optionId = normalizeOptionId(optionAvailability?.optionId);
          if (!optionId) {
            return;
          }

          const openTimes = (optionAvailability?.slots || [])
            .filter((slot) => slot?.status === "available" || slot?.status === "limited")
            .map((slot) => String(slot.time || ""));
          const previousTime = String(prev[optionId] || "");
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
    const resolvedStartTime = String(
      startTime || selectedStartTimesByOption[String(optionId || "").trim()] || preferredStartTime || ""
    ).trim();
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
      source: "single_product_page",
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

    navigate(`/booking/${tour.slug}?${query.toString()}`);
  };

  return (
    <section className="single-tour-page py-4 py-lg-5">
      <Container>
        <Row className="g-4 g-xl-5">
          <Col lg={8}>
            <div className="single-tour-left-column">
              <ProductGallery images={tour.images} title={tour.title} />
              <ProductHeader tour={tour} />
              <QuickFactCards tour={tour} />

              <section className="single-tour-collapsible-stack">
                <CollapsibleInfoBlock
                  title="About this tour"
                  subtitle="Overview and key experience context"
                  defaultOpen
                >
                  <AboutTourSection description={tour.description} />
                </CollapsibleInfoBlock>

                <CollapsibleInfoBlock
                  title="Experience details"
                  subtitle="Type, duration, categories, guide, difficulty"
                >
                  <ExperienceDetailsGrid tour={tour} />
                </CollapsibleInfoBlock>

                <CollapsibleInfoBlock
                  title="Itinerary"
                  subtitle="Stops, route, and day flow"
                >
                  <ItineraryTimeline itinerary={itinerary} />
                </CollapsibleInfoBlock>

                <CollapsibleInfoBlock
                  title="Meeting and pickup"
                  subtitle="Pickup/meeting setup from Bokun"
                >
                  <MeetingPickupCards meetingInfo={tour.meetingInfo} pickupInfo={tour.pickupInfo} />
                </CollapsibleInfoBlock>

                <CollapsibleInfoBlock
                  title="Included and excluded"
                  subtitle="What is covered and what is not"
                >
                  <IncludedExcludedCards included={tour.included} excluded={tour.excluded} />
                </CollapsibleInfoBlock>

                <CollapsibleInfoBlock
                  title="Important information"
                  subtitle="Policies and practical notes"
                >
                  <ImportantInfoCard importantInformation={tour.importantInformation} />
                </CollapsibleInfoBlock>
              </section>

              <AvailableOptionsSection
                tour={tour}
                options={optionsToRender}
                selectedOptionId={selectedOptionId}
                onSelectOption={handleSelectOption}
                pax={selectedPax}
                passengers={selectedPassengers}
                availabilityResult={availabilityResult}
                onClearAvailabilityFilter={clearAvailabilityFilter}
                travelDate={travelDate}
                onOptionStartTimeChange={handleOptionStartTimeChange}
                selectedPriceCatalogId={selectedPriceCatalogId}
                onBookOption={handleBookOption}
              />
              {availabilityError ? (
                <div className="single-booking-inline-error mt-2">{availabilityError}</div>
              ) : null}
            </div>
          </Col>

          <Col lg={4}>
            <StickyAvailabilityCard
              tour={tour}
              selectedOption={selectedOption}
              selectedStartTime={selectedStartTimesByOption[normalizeOptionId(selectedOption?.bokunOptionId)] || ""}
              initialSelection={{
                rateId: preferredCatalogId,
                travelDate: preferredTravelDate,
                startTime: preferredStartTime,
                passengers: preferredPassengers
              }}
              onLiveAvailabilityChecked={handleLiveAvailabilityChecked}
            />
          </Col>
        </Row>
      </Container>
    </section>
  );
};

export default SingleTourPage;
