import { useState } from "react";
import { Link } from "react-router-dom";
import { LuChevronRight, LuHeart, LuStar } from "react-icons/lu";
import { money, styleHref } from "./homeData";

// Eyebrow, H2 and an optional link on the right.
export const SectionHeader = ({ id, eyebrow, title, linkTo = "", linkText = "" }) => (
  <div className="hp-section-head">
    <div>
      <p className="hp-eyebrow">{eyebrow}</p>
      <h2 id={id}>{title}</h2>
    </div>
    {linkTo ? (
      <Link to={linkTo} className="hp-section-link">
        {linkText} <LuChevronRight aria-hidden="true" />
      </Link>
    ) : null}
  </div>
);

// Five travel styles with their real tour count (transfers show the lowest price instead).
export const CategoryTiles = ({ styles = [] }) =>
  styles.length ? (
    <section className="hp-section" aria-labelledby="hp-styles-title" id="hp-styles">
      <div className="hp-container">
        <SectionHeader id="hp-styles-title" eyebrow="Browse by style" title="What would you like to do?" />
        <ul className="hp-tiles">
          {styles.map((style) => (
            <li key={style.key}>
              <Link to={styleHref(style.label)} className="hp-tile">
                {style.image ? <img src={style.image} alt="" loading="lazy" decoding="async" width="400" height="520" /> : null}
                <span className="hp-tile-text">
                  <strong>{style.label}</strong>
                  <small>{style.subtitle}</small>
                  <span className="hp-tile-count">
                    {style.key === "transfers" && style.fromPrice
                      ? `from ${money(style.fromPrice, style.currency)}`
                      : `${style.count} tour${style.count === 1 ? "" : "s"}`}
                    <LuChevronRight aria-hidden="true" />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  ) : null;

const WISHLIST_KEY = "riser_wishlist_v1";
const readWishlist = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(WISHLIST_KEY) || "[]"));
  } catch {
    return new Set();
  }
};

// Heart on a card: saved on this device only.
const WishlistButton = ({ tour }) => {
  const [saved, setSaved] = useState(() => readWishlist().has(tour.id));
  const toggle = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const list = readWishlist();
    if (list.has(tour.id)) list.delete(tour.id);
    else list.add(tour.id);
    try {
      localStorage.setItem(WISHLIST_KEY, JSON.stringify([...list]));
    } catch {
      // Storage can be unavailable; the heart still toggles for this visit.
    }
    setSaved(list.has(tour.id));
  };
  return (
    <button
      type="button"
      className={`hp-heart ${saved ? "is-saved" : ""}`}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${tour.title} from your wishlist` : `Save ${tour.title} to your wishlist`}
      onClick={toggle}
    >
      <LuHeart aria-hidden="true" />
    </button>
  );
};

export const Price = ({ tour }) =>
  tour.fromPrice ? (
    <span className="hp-price">
      From <strong>{money(tour.fromPrice, tour.currency)}</strong> / {tour.unit}
    </span>
  ) : null;

// Featured card: photo, badge, heart, meta, title, summary, rating (only with reviews), price and link.
export const TourCard = ({ tour }) => (
  <article className="hp-card">
    <div className="hp-card-media">
      <img src={tour.image} alt={tour.title} loading="lazy" decoding="async" width="600" height="380" />
      {tour.badge ? <span className="hp-badge">{tour.badge}</span> : null}
      <WishlistButton tour={tour} />
    </div>
    <div className="hp-card-body">
      <p className="hp-card-meta">{tour.meta.join(" · ")}</p>
      <h3>
        <Link to={`/tours/${tour.slug}`} className="hp-card-link">{tour.title}</Link>
      </h3>
      {tour.summary ? <p className="hp-card-summary">{tour.summary}</p> : null}
      {tour.reviewCount ? (
        <p className="hp-rating">
          <LuStar aria-hidden="true" /> {tour.rating.toFixed(1)} <span>({tour.reviewCount} reviews)</span>
        </p>
      ) : null}
      <div className="hp-card-foot">
        <Price tour={tour} />
        <span className="hp-card-cta" aria-hidden="true">
          View tour <LuChevronRight />
        </span>
      </div>
    </div>
  </article>
);

export const FeaturedTours = ({ tours = [] }) =>
  tours.length ? (
    <section className="hp-section hp-featured" aria-labelledby="hp-featured-title">
      <div className="hp-container">
        <SectionHeader id="hp-featured-title" eyebrow="Featured" title="Handpicked Zanzibar experiences" linkTo="/tours" linkText="View all tours" />
        <div className="hp-cards">
          {tours.map((tour) => (
            <TourCard key={tour.id} tour={tour} />
          ))}
        </div>
        <Link to="/tours" className="hp-btn hp-btn-outline hp-see-all">See all tours</Link>
      </div>
    </section>
  ) : null;
