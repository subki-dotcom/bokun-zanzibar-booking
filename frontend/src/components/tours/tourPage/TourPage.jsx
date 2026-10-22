import { useEffect, useMemo, useState } from "react";
import "./tourPage.css";
import SingleTourPage from "../single/SingleTourPage";
import { Breadcrumb, MobileTourHeader, TourTitle, useShareTour } from "./TourIntro";
import { Lightbox, MobileCarousel, PhotoMosaic } from "./TourPhotos";
import { galleryPhotos } from "./tourPageData";

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

// Public single tour page (mockup "Tour Page"). Step 1: header, breadcrumb, title and photos; the sections and booking
// below still come from the existing page until they are rebuilt.
const TourPage = ({ tour = {} }) => {
  const isMobile = useMediaQuery("(max-width: 767.98px)");
  const photos = useMemo(() => galleryPhotos(tour), [tour]);
  const [photoIndex, setPhotoIndex] = useState(null);
  const { share, message } = useShareTour(tour.title);

  return (
    <div className="tp">
      {isMobile ? <MobileTourHeader onShare={share} /> : null}
      <div className="tp-container">
        {isMobile ? <MobileCarousel photos={photos} onOpen={setPhotoIndex} /> : <Breadcrumb tour={tour} />}
        <TourTitle tour={tour} onShare={share} showActions={!isMobile} />
        {!isMobile ? <PhotoMosaic photos={photos} onOpen={setPhotoIndex} /> : null}
      </div>
      <SingleTourPage tour={tour} hideIntro />
      {photoIndex !== null ? <Lightbox photos={photos} index={photoIndex} onIndexChange={setPhotoIndex} onClose={() => setPhotoIndex(null)} /> : null}
      {message ? <div className="tp-toast" role="status">{message}</div> : null}
    </div>
  );
};

export default TourPage;
