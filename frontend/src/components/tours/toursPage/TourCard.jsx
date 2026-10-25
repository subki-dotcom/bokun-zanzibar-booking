import { useState } from "react";
import { Link } from "react-router-dom";
import { LuCheck, LuChevronRight, LuClock3, LuHeart, LuStar } from "react-icons/lu";
import { money, photoAt, photoSet } from "../../homePage/homeData";
import { readWishlist, toggleWishlist } from "../../../utils/wishlist";
import { trackSelectItem } from "../../../utils/analytics";

const WishlistButton = ({ tour }) => {
  const [saved, setSaved] = useState(() => readWishlist().has(tour.id));
  return (
    <button
      type="button"
      className={`tl-heart ${saved ? "is-saved" : ""}`}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${tour.title} from your wishlist` : `Save ${tour.title} to your wishlist`}
      onClick={() => setSaved(toggleWishlist(tour.id))}
    >
      <LuHeart aria-hidden="true" />
    </button>
  );
};

// One tour: the whole card opens the tour page (one link); the heart sits beside the link, not inside it.
const TourCard = ({ tour, priority = false }) => (
  <article className="tl-card">
    <Link to={`/tours/${tour.slug}`} onClick={() => trackSelectItem(tour)} className="tl-card-link">
      <span className="tl-card-media">
        {tour.image ? (
          <img
            src={photoAt(tour.image, 600)}
            srcSet={photoSet(tour.image, [400, 600, 800])}
            sizes="(max-width: 767px) 100vw, (max-width: 1199px) 45vw, 300px"
            alt=""
            width="400"
            height="200"
            loading={priority ? "eager" : "lazy"}
            fetchpriority={priority === "high" ? "high" : undefined}
            decoding="async"
          />
        ) : null}
        {tour.badge ? <span className="tl-badge">{tour.badge}</span> : null}
      </span>
      <span className="tl-card-body">
        {tour.category ? <span className="tl-card-cat">{tour.category.label}</span> : null}
        <strong className="tl-card-title">{tour.title}</strong>
        {/* Desktop: free cancellation on its own line; phones: at the end of the meta line. */}
        <span className="tl-card-meta">
          <LuClock3 aria-hidden="true" />
          {[tour.duration, tour.meta].filter(Boolean).join(" · ")}
          {tour.freeCancellation ? <span className="tl-free tl-free-inline"> · Free cancellation</span> : null}
        </span>
        {tour.freeCancellation ? (
          <span className="tl-free tl-free-line">
            <LuCheck aria-hidden="true" /> Free cancellation
          </span>
        ) : null}
        {/* Desktop: rating, then price and "View tour" under a line; phones: rating and price side by side. */}
        <span className="tl-card-foot">
          {tour.reviewCount ? (
            <span className="tl-rating">
              <LuStar aria-hidden="true" /> {Number(tour.rating).toFixed(1)}{" "}
              <span>
                ({tour.reviewCount}
                <span className="tl-hide-phone"> review{tour.reviewCount === 1 ? "" : "s"}</span>)
              </span>
            </span>
          ) : (
            <span className="tl-new">New on our site</span>
          )}
          {tour.fromPrice ? (
            <span className="tl-price">
              From <strong>{money(tour.fromPrice, tour.currency)}</strong>
              <span className="tl-hide-phone"> / {tour.unit}</span>
            </span>
          ) : null}
          <span className="tl-card-cta" aria-hidden="true">
            View tour <LuChevronRight />
          </span>
        </span>
      </span>
    </Link>
    <WishlistButton tour={tour} />
  </article>
);

// Placeholder cards while results load (same size as real cards, so nothing moves).
export const SkeletonCards = ({ count = 6 }) =>
  Array.from({ length: count }, (_, index) => (
    <div key={index} className="tl-card tl-card-skeleton" aria-hidden="true">
      <span className="tl-card-media" />
      <span className="tl-card-body">
        <span className="tl-sk tl-sk-short" />
        <span className="tl-sk" />
        <span className="tl-sk tl-sk-mid" />
        <span className="tl-sk tl-sk-short" />
      </span>
    </div>
  ));

export default TourCard;
