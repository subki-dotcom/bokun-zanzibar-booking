import { useState } from "react";
import { Link } from "react-router-dom";
import { LuCheck, LuChevronRight, LuHeart, LuStar } from "react-icons/lu";
import { money, photoAt, photoSet, styleHref } from "./homeData";

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
                {style.image ? <img src={photoAt(style.image, 400)} srcSet={photoSet(style.image, [300, 600])} sizes="(max-width: 767px) 46vw, 240px" alt="" loading="lazy" decoding="async" width="400" height="520" /> : null}
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
      <img src={photoAt(tour.image, 800)} srcSet={photoSet(tour.image, [400, 800])} sizes="(max-width: 767px) 100vw, 400px" alt={tour.title} loading="lazy" decoding="async" width="600" height="380" />
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

// The flagship safari: its photo, the facts its product page lists and its own "From" price.
export const SafariBanner = ({ safari }) => {
  if (!safari?.tour) return null;
  const { tour } = safari;
  return (
    <section className="hp-section" aria-labelledby="hp-safari-title">
      <div className="hp-container">
        <div className="hp-safari">
          <div className="hp-safari-media">
            <img src={photoAt(tour.image, 960)} srcSet={photoSet(tour.image, [480, 960])} sizes="(max-width: 767px) 100vw, 600px" alt={tour.title} loading="lazy" decoding="async" width="640" height="480" />
          </div>
          <div className="hp-safari-body">
            <p className="hp-eyebrow">Safari from Zanzibar</p>
            <h2 id="hp-safari-title">Fly from the beach to the Serengeti</h2>
            <p className="hp-safari-text">
              A short flight takes you from Zanzibar to Tanzania's best-known parks, and back to the beach after. Our top trip: {tour.title}.
            </p>
            {tour.facts?.length ? (
              <ul className="hp-checks">
                {tour.facts.map((fact) => (
                  <li key={fact}>
                    <LuCheck aria-hidden="true" /> {fact}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="hp-safari-actions">
              <Link to={styleHref("Safari trips")} className="hp-btn hp-btn-white">
                See safari trips <LuChevronRight aria-hidden="true" />
              </Link>
              {safari.fromPrice ? (
                <span className="hp-safari-price">
                  From <strong>{money(safari.fromPrice, safari.currency)}</strong> / {tour.unit}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

// Small card for the "Traveler favorites" row.
const FavoriteCard = ({ tour }) => (
  <article className="hp-fav">
    <div className="hp-fav-media">
      <img src={photoAt(tour.image, 600)} srcSet={photoSet(tour.image, [300, 600])} sizes="(max-width: 767px) 72vw, 300px" alt={tour.title} loading="lazy" decoding="async" width="400" height="260" />
      {tour.badge ? <span className="hp-badge">{tour.badge}</span> : null}
    </div>
    <div className="hp-fav-body">
      <p className="hp-card-meta">{tour.meta.slice(0, 2).join(" · ")}</p>
      <h3>
        <Link to={`/tours/${tour.slug}`} className="hp-card-link">{tour.title}</Link>
      </h3>
      <Price tour={tour} />
    </div>
  </article>
);

export const BestSellers = ({ tours = [] }) =>
  tours.length ? (
    <section className="hp-section" aria-labelledby="hp-best-title">
      <div className="hp-container">
        <SectionHeader id="hp-best-title" eyebrow="Best sellers" title="Traveler favorites" />
        <ul className="hp-favs">
          {tours.map((tour) => (
            <li key={tour.id}>
              <FavoriteCard tour={tour} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  ) : null;

const STEPS = [
  { title: "Choose your experience", text: "Tours, safaris and transfers with clear prices." },
  { title: "Pick a date & time", text: "See live availability for your group." },
  { title: "Pay securely", text: "Card, M-Pesa or PayPal, confirmed instantly." },
  { title: "Enjoy Zanzibar", text: "Meet your local guide, with hotel pickup on most tours." }
];

export const StepsStrip = () => (
  <section className="hp-section" aria-labelledby="hp-steps-title">
    <div className="hp-container">
      <h2 id="hp-steps-title" className="hp-visually-hidden">How booking works</h2>
      <ol className="hp-steps">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <span className="hp-step-num">{String(index + 1).padStart(2, "0")}</span>
            <strong>{step.title}</strong>
            <span>{step.text}</span>
          </li>
        ))}
      </ol>
    </div>
  </section>
);

// Real reviews only: with none the whole section stays hidden.
export const ReviewsSection = ({ reviews }) => {
  if (!reviews?.count) return null;
  // Whole stars, then a half star for .5 and above (4.5 shows four and a half).
  const whole = Math.floor(reviews.rating);
  const half = reviews.rating - whole >= 0.5;
  return (
    <section className="hp-section" aria-labelledby="hp-reviews-title">
      <div className="hp-container">
        <SectionHeader id="hp-reviews-title" eyebrow="Guest reviews" title="What travelers say" />
        <div className={`hp-reviews ${reviews.items?.length ? "" : "is-score-only"}`}>
          <div className="hp-score">
            <strong>{reviews.rating.toFixed(1)}</strong>
            <span className="hp-stars" role="img" aria-label={`${reviews.rating.toFixed(1)} out of 5 stars`}>
              {[1, 2, 3, 4, 5].map((n) =>
                half && n === whole + 1 ? (
                  <span key={n} className="hp-star-half" aria-hidden="true">
                    <LuStar />
                    <LuStar className="is-on" />
                  </span>
                ) : (
                  <LuStar key={n} aria-hidden="true" className={n <= whole ? "is-on" : ""} />
                )
              )}
            </span>
            <span>
              {reviews.count} review{reviews.count === 1 ? "" : "s"}{reviews.source ? ` on ${reviews.source}` : ""}
            </span>
            {reviews.url ? (
              <a className="hp-reviews-source" href={reviews.url} target="_blank" rel="noopener noreferrer">
                Read our reviews{reviews.source ? ` on ${reviews.source}` : ""} <LuChevronRight aria-hidden="true" />
              </a>
            ) : null}
          </div>
          {(reviews.items || []).slice(0, 2).map((item) => (
            <figure className="hp-review" key={`${item.author}-${item.date || item.text.slice(0, 20)}`}>
              <blockquote>{item.text}</blockquote>
              <figcaption>
                <strong>{item.author}</strong>
                {item.tour ? <span>{item.tour}</span> : null}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
};
