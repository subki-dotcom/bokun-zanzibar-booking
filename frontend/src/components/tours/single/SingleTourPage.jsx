import { useEffect, useMemo, useState } from "react";
import { Col, Container, Row } from "react-bootstrap";
import { useSearchParams } from "react-router-dom";
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

const SingleTourPage = ({ tour = {} }) => {
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
  const [adults, setAdults] = useState(1);
  const [travelDate, setTravelDate] = useState("");
  const [selectedPriceCatalogId, setSelectedPriceCatalogId] = useState("");
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [availabilityResult, setAvailabilityResult] = useState(null);
  const [selectedStartTimesByOption, setSelectedStartTimesByOption] = useState({});

  useEffect(() => {
    const firstOptionId = activeOptions[0]?.bokunOptionId || "";
    const preferredExists = activeOptions.some(
      (option) => String(option.bokunOptionId || "") === preferredOptionId
    );
    const nextOptionId = preferredExists ? preferredOptionId : firstOptionId;
    setSelectedOptionId(nextOptionId);
  }, [activeOptions, preferredOptionId]);

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
    pax = { adults: 1, children: 0, infants: 0 }
  } = {}) => {
    if (!nextTravelDate || checkingAvailability) {
      return;
    }

    const normalizedPax = {
      adults: Math.max(0, Number(pax?.adults || 0)),
      children: Math.max(0, Number(pax?.children || 0)),
      infants: Math.max(0, Number(pax?.infants || 0))
    };
    const effectiveAdults = Math.max(
      1,
      Number(normalizedPax.adults || normalizedPax.children || normalizedPax.infants || 1)
    );

    setTravelDate(nextTravelDate);
    setSelectedPriceCatalogId(String(rateId || ""));
    setAdults(effectiveAdults);
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
    } finally {
      setCheckingAvailability(false);
    }
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
              <AboutTourSection description={tour.description} />
              <ExperienceDetailsGrid tour={tour} />
              <ItineraryTimeline itinerary={itinerary} />
              <MeetingPickupCards meetingInfo={tour.meetingInfo} pickupInfo={tour.pickupInfo} />
              <IncludedExcludedCards included={tour.included} excluded={tour.excluded} />
              <ImportantInfoCard importantInformation={tour.importantInformation} />
              <AvailableOptionsSection
                tour={tour}
                options={optionsToRender}
                selectedOptionId={selectedOptionId}
                onSelectOption={handleSelectOption}
                adults={adults}
                availabilityResult={availabilityResult}
                onClearAvailabilityFilter={clearAvailabilityFilter}
                travelDate={travelDate}
                onOptionStartTimeChange={handleOptionStartTimeChange}
                selectedPriceCatalogId={selectedPriceCatalogId}
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
