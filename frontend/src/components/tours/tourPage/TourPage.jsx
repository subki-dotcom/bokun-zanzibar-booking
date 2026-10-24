import { useEffect, useMemo, useState } from "react";
import "./tourPage.css";
import "./tourSections.css";
import "./tourBooking.css";
import "./mobileBooking.css";
import { Breadcrumb, MobileTourHeader, TourTitle, useShareTour } from "./TourIntro";
import { Lightbox, MobileCarousel, PhotoMosaic } from "./TourPhotos";
import { galleryPhotos } from "./tourPageData";
import { CancellationPolicy, IncludedList, ItineraryTimeline, KeyFacts, Overview, PickupInfo, RelatedTours, Reviews, SectionTabs } from "./TourSections";
import { cancellationText, freeCancellationWindow, includedLists, itineraryStops, keyFacts, overviewParagraphs, pickupAreasText } from "./tourSectionsData";
import { tourHasPickup } from "../single/tourDisplayText";
import useTourBooking from "./useTourBooking";
import { BookingCard } from "./TourBooking";
import { MobileBookingBar, MobileBookingSheet } from "./MobileBooking";
import useMediaQuery from "../../../hooks/useMediaQuery";

// Public single tour page (mockup "Tour Page", "Mobile" and "MobileSheet"). Data, availability, prices and checkout come
// from the existing API; this file and its parts only present them.
const TourPage = ({ tour = {} }) => {
  const isMobile = useMediaQuery("(max-width: 767.98px)");
  // Below 1024px the booking card would sit under all the content, so phones and tablets book from the bar and sheet.
  const compactBooking = useMediaQuery("(max-width: 1023.98px)");
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
  const booking = useTourBooking(tour);
  const [sheetOpen, setSheetOpen] = useState(false);
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
        <TourTitle tour={tour} onShare={share} showActions={!isMobile} lowAvailability={booking.lowAvailability} />
        {!isMobile ? <PhotoMosaic photos={photos} onOpen={setPhotoIndex} /> : null}

        <div className="tp-layout">
          <div className="tp-content">
            <SectionTabs sections={sections} />
            <KeyFacts facts={facts} />
            <Overview paragraphs={paragraphs} />
            <IncludedList included={lists.included} excluded={lists.excluded} compact={isMobile} />
            <ItineraryTimeline stops={stops} hasPickup={hasPickup} compact={isMobile} />
            {!isMobile ? <PickupInfo areas={pickupAreas} startTimes={booking.startTimes} /> : null}
            <CancellationPolicy text={cancellation.text} emphasis={cancellation.emphasis} />
            <Reviews rating={tour.rating} reviewCount={tour.reviewCount} source={tour.reviewSource} url={tour.reviewUrl} listing={tour.tripadvisor} freeCancellationWindow={freeCancellationWindow(tour.cancellationPolicy)} />
          </div>
          {compactBooking ? null : (
            <aside className="tp-aside" aria-label="Book this tour">
              <BookingCard tour={tour} booking={booking} />
            </aside>
          )}
        </div>

        <RelatedTours tour={tour} />
      </div>
      {compactBooking ? <MobileBookingBar booking={booking} onOpen={() => setSheetOpen(true)} /> : null}
      {compactBooking && sheetOpen ? <MobileBookingSheet booking={booking} onClose={() => setSheetOpen(false)} /> : null}
      {photoIndex !== null ? <Lightbox photos={photos} index={photoIndex} onIndexChange={setPhotoIndex} onClose={() => setPhotoIndex(null)} /> : null}
      {message ? <div className="tp-toast" role="status">{message}</div> : null}
    </div>
  );
};

export default TourPage;
