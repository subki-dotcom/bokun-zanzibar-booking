import { useEffect, useMemo, useState } from "react";
import "./tourPage.css";
import "./tourSections.css";
import SingleTourPage from "../single/SingleTourPage";
import { Breadcrumb, MobileTourHeader, TourTitle, useShareTour } from "./TourIntro";
import { Lightbox, MobileCarousel, PhotoMosaic } from "./TourPhotos";
import { galleryPhotos } from "./tourPageData";
import { CancellationPolicy, IncludedList, ItineraryTimeline, KeyFacts, Overview, PickupInfo, RelatedTours, Reviews, SectionTabs } from "./TourSections";
import { cancellationText, freeCancellationWindow, includedLists, itineraryStops, keyFacts, overviewParagraphs, pickupAreasText } from "./tourSectionsData";
import { tourHasPickup } from "../single/tourDisplayText";

export const useMediaQuery = (query) => {
  const [matches, setMatches] = useState(() => (typeof window !== "undefined" ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
};

// Public single tour page (mockup "Tour Page"). The booking card still comes from the existing page until it is rebuilt.
const TourPage = ({ tour = {} }) => {
  const isMobile = useMediaQuery("(max-width: 767.98px)");
  const photos = useMemo(() => galleryPhotos(tour), [tour]);
  const [photoIndex, setPhotoIndex] = useState(null);
  const { share, message } = useShareTour(tour.title);
  const facts = useMemo(() => keyFacts(tour), [tour]);
  const paragraphs = useMemo(() => overviewParagraphs(tour), [tour]);
  const lists = useMemo(() => includedLists(tour), [tour]);
  const stops = useMemo(() => itineraryStops(tour), [tour]);
  const pickupAreas = useMemo(() => pickupAreasText(tour), [tour]);
  const cancellation = useMemo(() => cancellationText(tour), [tour]);
  const hasPickup = tourHasPickup(tour);
  const sections = useMemo(() => [
    paragraphs.length ? { id: "overview", label: "Overview" } : null,
    lists.included.length || lists.excluded.length ? { id: "included", label: isMobile ? "Included" : "What's included" } : null,
    stops.length ? { id: "itinerary", label: "Itinerary" } : null,
    pickupAreas && !isMobile ? { id: "pickup", label: "Pickup" } : null,
    { id: "reviews", label: "Reviews" }
  ].filter(Boolean), [paragraphs, lists, stops, pickupAreas, isMobile]);

  return (
    <div className="tp">
      {isMobile ? <MobileTourHeader onShare={share} /> : null}
      <div className="tp-container">
        {isMobile ? <MobileCarousel photos={photos} onOpen={setPhotoIndex} /> : <Breadcrumb tour={tour} />}
        <TourTitle tour={tour} onShare={share} showActions={!isMobile} />
        {!isMobile ? <PhotoMosaic photos={photos} onOpen={setPhotoIndex} /> : null}

        <div className="tp-layout">
          <div className="tp-content">
            <SectionTabs sections={sections} />
            <KeyFacts facts={facts} />
            <Overview paragraphs={paragraphs} />
            <IncludedList included={lists.included} excluded={lists.excluded} compact={isMobile} />
            <ItineraryTimeline stops={stops} hasPickup={hasPickup} compact={isMobile} />
            {!isMobile ? <PickupInfo areas={pickupAreas} /> : null}
            <CancellationPolicy text={cancellation.text} emphasis={cancellation.emphasis} />
            <Reviews rating={tour.rating} reviewCount={tour.reviewCount} freeCancellationWindow={freeCancellationWindow(tour.cancellationPolicy)} />
          </div>
          <aside className="tp-aside" aria-label="Book this tour">
            <SingleTourPage tour={tour} bookingOnly />
          </aside>
        </div>

        <RelatedTours tour={tour} />
      </div>
      {photoIndex !== null ? <Lightbox photos={photos} index={photoIndex} onIndexChange={setPhotoIndex} onClose={() => setPhotoIndex(null)} /> : null}
      {message ? <div className="tp-toast" role="status">{message}</div> : null}
    </div>
  );
};

export default TourPage;
