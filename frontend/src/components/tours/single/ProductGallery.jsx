import { useMemo, useState } from "react";
import { FALLBACK_IMAGE } from "./singleTour.helpers";

const ProductGallery = ({ images = [], title = "Tour" }) => {
  const galleryImages = useMemo(() => {
    const valid = (images || []).filter(Boolean);
    return valid.length ? valid : [FALLBACK_IMAGE];
  }, [images]);

  const [activeIndex, setActiveIndex] = useState(0);
  const activeImage = galleryImages[activeIndex] || galleryImages[0];

  return (
    <section className="single-tour-gallery">
      <div className="single-tour-gallery-main-wrap">
        <img className="single-tour-gallery-main" src={activeImage} alt={title} />
        <span className="single-tour-gallery-counter">
          {Math.min(activeIndex + 1, galleryImages.length)} / {galleryImages.length}
        </span>
      </div>

      {galleryImages.length > 1 ? (
        <div className="single-tour-gallery-thumbs">
          {galleryImages.slice(0, 6).map((image, index) => (
            <button
              key={`${image}-${index}`}
              type="button"
              className={`single-tour-thumb ${activeIndex === index ? "is-active" : ""}`.trim()}
              onClick={() => setActiveIndex(index)}
              aria-label={`Show image ${index + 1}`}
            >
              <img src={image} alt={`${title} ${index + 1}`} />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
};

export default ProductGallery;
