import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LuChevronLeft, LuChevronRight, LuLayoutGrid, LuX } from "react-icons/lu";

// Fullscreen photo viewer: arrows, swipe, Esc, counter. Focus moves to the close button and returns on close.
export const Lightbox = ({ photos = [], index = 0, onClose, onIndexChange }) => {
  const closeRef = useRef(null);
  const touchStart = useRef(null);
  const count = photos.length;
  const photo = photos[index];
  const go = (step) => onIndexChange?.((index + step + count) % count);

  // Opened: focus the close button and lock the page scroll; closed: restore both.
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "Tab") {
        const focusable = [...document.querySelectorAll(".tp-lightbox button")];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  if (!photo) return null;

  return createPortal(
    <div className="tp-lightbox" role="dialog" aria-modal="true" aria-label="Tour photos">
      <div className="tp-lightbox-top">
        <span aria-live="polite">{index + 1} / {count}</span>
        <button ref={closeRef} type="button" className="tp-lightbox-btn" onClick={onClose} aria-label="Close photos">
          <LuX aria-hidden="true" />
        </button>
      </div>
      <div
        className="tp-lightbox-stage"
        onTouchStart={(event) => { touchStart.current = event.touches[0].clientX; }}
        onTouchEnd={(event) => {
          if (touchStart.current === null) return;
          const delta = event.changedTouches[0].clientX - touchStart.current;
          if (Math.abs(delta) > 40) go(delta < 0 ? 1 : -1);
          touchStart.current = null;
        }}
      >
        <img src={photo.url} alt={photo.alt} />
        {count > 1 ? (
          <>
            <button type="button" className="tp-lightbox-btn tp-lightbox-prev" onClick={() => go(-1)} aria-label="Previous photo"><LuChevronLeft aria-hidden="true" /></button>
            <button type="button" className="tp-lightbox-btn tp-lightbox-next" onClick={() => go(1)} aria-label="Next photo"><LuChevronRight aria-hidden="true" /></button>
          </>
        ) : null}
      </div>
      <p className="tp-lightbox-caption">{photo.caption}</p>
    </div>,
    document.body
  );
};

// Desktop mosaic: one large photo and up to four smaller ones; the last tile opens all photos.
export const PhotoMosaic = ({ photos = [], onOpen }) => {
  const shown = photos.slice(0, 5);
  if (!shown.length) return null;
  return (
    <div className={`tp-mosaic is-count-${Math.min(shown.length, 5)}`}>
      {shown.map((photo, index) => (
        <button
          key={photo.url}
          type="button"
          className={`tp-tile ${index === 0 ? "is-main" : ""}`.trim()}
          onClick={() => onOpen?.(index)}
          aria-label={`Open photo ${index + 1} of ${photos.length}${photo.caption ? `: ${photo.caption}` : ""}`}
        >
          <img src={photo.url} alt={photo.alt} loading={index === 0 ? "eager" : "lazy"} fetchpriority={index === 0 ? "high" : undefined} decoding="async" />
          {photo.caption ? <span className="tp-caption">{photo.caption}</span> : null}
        </button>
      ))}
      {photos.length > 1 ? (
        <button type="button" className="tp-see-all" onClick={() => onOpen?.(0)}>
          <LuLayoutGrid aria-hidden="true" /> See all {photos.length} photos
        </button>
      ) : null}
    </div>
  );
};

// Mobile: full-width swipeable photos with a "1 / N" counter; a tap opens the viewer.
export const MobileCarousel = ({ photos = [], onOpen }) => {
  const [current, setCurrent] = useState(0);
  const trackRef = useRef(null);
  if (!photos.length) return null;

  const onScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    setCurrent(Math.round(track.scrollLeft / Math.max(1, track.clientWidth)));
  };

  return (
    <div className="tp-carousel" aria-roledescription="carousel" aria-label="Tour photos">
      <div className="tp-carousel-track" ref={trackRef} onScroll={onScroll}>
        {photos.map((photo, index) => (
          <button
            key={photo.url}
            type="button"
            className="tp-carousel-slide"
            onClick={() => onOpen?.(index)}
            aria-label={`Photo ${index + 1} of ${photos.length}${photo.caption ? `: ${photo.caption}` : ""}`}
          >
            <img src={photo.url} alt={photo.alt} loading={index === 0 ? "eager" : "lazy"} decoding="async" />
          </button>
        ))}
      </div>
      {photos[current]?.caption ? <span className="tp-caption">Photo: {photos[current].caption}</span> : null}
      <span className="tp-counter">{current + 1} / {photos.length}</span>
    </div>
  );
};
