import { useMemo, useState } from "react";
import { Modal } from "react-bootstrap";
import { BsChevronLeft, BsChevronRight, BsPlayFill } from "react-icons/bs";
import { FALLBACK_IMAGE } from "./singleTour.helpers";

const ProductGallery = ({ images = [], title = "Tour", videoUrl = "", bestSeller = false }) => {
  const galleryImages = useMemo(() => {
    const valid = (images || []).filter(Boolean);
    return valid.length ? valid : [FALLBACK_IMAGE];
  }, [images]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const activeImage = galleryImages[activeIndex] || galleryImages[0];
  const hiddenImageCount = Math.max(galleryImages.length - 6, 0);

  const moveImage = (direction) => {
    setActiveIndex((current) => (current + direction + galleryImages.length) % galleryImages.length);
  };

  return (
    <section className="single-tour-gallery product-gallery">
      <div className={`product-gallery-stage ${galleryImages.length > 2 ? "has-secondary" : ""}`.trim()}>
        <div className="product-gallery-primary-wrap">
          <button type="button" className="product-gallery-main-button" onClick={() => setLightboxOpen(true)} aria-label="Open image gallery">
            <img className="single-tour-gallery-main" src={activeImage} alt={title} fetchPriority="high" />
          </button>
          {bestSeller ? <span className="product-gallery-best-seller">Best seller</span> : null}
          {galleryImages.length > 1 ? (
            <>
              <button type="button" className="product-gallery-nav is-prev" onClick={() => moveImage(-1)} aria-label="Previous image"><BsChevronLeft /></button>
              <button type="button" className="product-gallery-nav is-next" onClick={() => moveImage(1)} aria-label="Next image"><BsChevronRight /></button>
            </>
          ) : null}
        </div>

        {galleryImages.length > 2 ? (
          <div className="product-gallery-secondary-grid">
            {galleryImages.slice(1, 3).map((image, index) => (
              <button key={`${image}-${index + 1}`} type="button" className="product-gallery-secondary-button" onClick={() => { setActiveIndex(index + 1); setLightboxOpen(true); }} aria-label={`Open image ${index + 2}`}>
                <img src={image} alt={`${title} ${index + 2}`} loading="lazy" />
                {index === 0 && videoUrl ? <span className="product-gallery-video-overlay"><BsPlayFill /> Watch video</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {galleryImages.length > 1 ? (
        <div className="single-tour-gallery-thumbs product-gallery-thumbs">
          {galleryImages.slice(0, 6).map((image, index) => (
            <button
              key={`${image}-${index}`}
              type="button"
              className={`single-tour-thumb ${activeIndex === index ? "is-active" : ""}`.trim()}
              onClick={() => setActiveIndex(index)}
              aria-label={`Show image ${index + 1}`}
            >
              <img src={image} alt={`${title} ${index + 1}`} loading="lazy" />
            </button>
          ))}
          {hiddenImageCount ? <button type="button" className="product-gallery-more" onClick={() => setLightboxOpen(true)} aria-label={`View ${hiddenImageCount} more images`}><strong>+{hiddenImageCount}</strong><span>more</span></button> : null}
        </div>
      ) : null}

      <Modal show={lightboxOpen} onHide={() => setLightboxOpen(false)} centered size="xl" contentClassName="product-gallery-lightbox">
        <Modal.Header closeButton><Modal.Title>{title}</Modal.Title></Modal.Header>
        <Modal.Body>
          <img src={activeImage} alt={title} />
          {galleryImages.length > 1 ? <div className="product-gallery-lightbox-actions"><button type="button" onClick={() => moveImage(-1)} aria-label="Previous image"><BsChevronLeft /></button><span>{activeIndex + 1} / {galleryImages.length}</span><button type="button" onClick={() => moveImage(1)} aria-label="Next image"><BsChevronRight /></button></div> : null}
        </Modal.Body>
      </Modal>
    </section>
  );
};

export default ProductGallery;
