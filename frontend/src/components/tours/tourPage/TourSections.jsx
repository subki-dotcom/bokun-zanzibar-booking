import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LuBus, LuCheck, LuClock, LuExternalLink, LuMapPin, LuMessageSquare, LuShieldCheck, LuStar, LuUsers, LuX } from "react-icons/lu";
import { fetchTours } from "../../../api/toursApi";
import { formatCurrency } from "../../../utils/formatters";
import { durationTag } from "../single/tourDisplayText";
import { Stars } from "./TourIntro";

const FACT_ICONS = { clock: LuClock, check: LuCheck, bus: LuBus, shield: LuShieldCheck, message: LuMessageSquare, users: LuUsers };

// Sticky section tabs with scroll-spy.
export const SectionTabs = ({ sections = [] }) => {
  const [active, setActive] = useState(sections[0]?.id || "");

  useEffect(() => {
    const elements = sections.map((section) => document.getElementById(section.id)).filter(Boolean);
    if (!elements.length || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-140px 0px -55% 0px" }
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [sections]);

  const go = (event, id) => {
    event.preventDefault();
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav className="tp-tabs" aria-label="Tour sections">
      {sections.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className={active === section.id ? "is-active" : ""}
          aria-current={active === section.id ? "true" : undefined}
          onClick={(event) => go(event, section.id)}
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
};

export const KeyFacts = ({ facts = [] }) => (
  <ul className="tp-facts">
    {facts.map((fact) => {
      const Icon = FACT_ICONS[fact.icon] || LuCheck;
      return (
        <li key={fact.id}>
          <Icon aria-hidden="true" />
          <span>
            <strong>{fact.title}</strong>
            <small>{fact.detail}</small>
          </span>
        </li>
      );
    })}
  </ul>
);

export const Overview = ({ paragraphs = [] }) => {
  const [open, setOpen] = useState(false);
  const long = paragraphs.join(" ").length > 320 || paragraphs.length > 2;
  if (!paragraphs.length) return null;
  return (
    <section id="overview" className="tp-section">
      <h2>Overview</h2>
      <div className={`tp-overview ${open || !long ? "is-open" : ""}`.trim()}>
        {paragraphs.map((text, index) => <p key={index}>{text}</p>)}
      </div>
      {long ? (
        <button type="button" className="tp-link-btn" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? "Read less" : "Read more"}
        </button>
      ) : null}
    </section>
  );
};

const MOBILE_LIST_LIMIT = 5;

export const IncludedList = ({ included = [], excluded = [], compact = false }) => {
  const [all, setAll] = useState(false);
  if (!included.length && !excluded.length) return null;
  const items = [...included.map((text) => ({ text, ok: true })), ...excluded.map((text) => ({ text, ok: false }))];
  const shown = compact && !all ? items.slice(0, MOBILE_LIST_LIMIT) : items;
  const renderItem = (item, index) => (
    <li key={`${item.ok}-${index}`} className={item.ok ? "is-included" : "is-excluded"}>
      {item.ok ? <LuCheck aria-hidden="true" /> : <LuX aria-hidden="true" />}
      <span>{item.ok ? "" : <span className="tp-visually-hidden">Not included: </span>}{item.text}</span>
    </li>
  );
  return (
    <section id="included" className="tp-section">
      <h2>What&apos;s included</h2>
      {compact ? (
        <ul className="tp-included">{shown.map(renderItem)}</ul>
      ) : (
        <div className="tp-included-grid">
          <ul className="tp-included">{items.filter((item) => item.ok).map(renderItem)}</ul>
          <ul className="tp-included">{items.filter((item) => !item.ok).map(renderItem)}</ul>
        </div>
      )}
      {compact && items.length > MOBILE_LIST_LIMIT ? (
        <button type="button" className="tp-link-btn" aria-expanded={all} onClick={() => setAll((value) => !value)}>
          {all ? "Show less" : "See all"}
        </button>
      ) : null}
    </section>
  );
};

// Phones: two lines of a stop's description with "… Read more"; the button appears only when the text is longer.
const StopDescription = ({ text }) => {
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const paragraph = useRef(null);
  useEffect(() => {
    const node = paragraph.current;
    if (!node || open) return undefined;
    const measure = () => setLong(node.scrollHeight > node.clientHeight + 1);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [text, open]);
  return (
    <div className={`tp-stop-text ${open ? "is-open" : ""}`}>
      <p ref={paragraph}>
        {text}
        {open ? (
          <>
            {" "}
            <button type="button" className="tp-stop-more" aria-expanded="true" onClick={() => setOpen(false)}>
              Read less
            </button>
          </>
        ) : null}
      </p>
      {!open && long ? (
        <button type="button" className="tp-stop-more is-overlay" aria-expanded="false" onClick={() => setOpen(true)}>
          <span aria-hidden="true">… </span>Read more
        </button>
      ) : null}
    </div>
  );
};

export const ItineraryTimeline = ({ stops = [], hasPickup = false, pickupTimes = "", compact = false }) => {
  const [all, setAll] = useState(false);
  if (!stops.length) return null;
  const shown = compact && !all ? stops.slice(0, 3) : stops;
  return (
    <section id="itinerary" className="tp-section">
      <h2>What to expect</h2>
      <ol className={`tp-timeline ${compact ? "is-compact" : ""}`}>
        {hasPickup && !compact ? (
          <li className="tp-step is-endpoint">
            <span className="tp-step-marker is-filled"><LuBus aria-hidden="true" /></span>
            <div className="tp-step-body">
              <strong>Pickup from your hotel{pickupTimes ? ` · ${pickupTimes}` : ""}</strong>
              <small>Exact pickup time is confirmed after booking.</small>
            </div>
          </li>
        ) : null}
        {shown.map((stop, index) => (
          <li key={`${stop.title}-${index}`} className="tp-step">
            <span className="tp-step-marker">{index + 1}</span>
            <div className="tp-step-body">
              {stop.image && !compact ? <img className="tp-step-image" src={stop.image} alt={stop.title || `Stop ${index + 1}`} loading="lazy" decoding="async" width="120" height="84" /> : null}
              <div>
                {stop.title ? <h3>{stop.title}</h3> : null}
                {stop.meta.length && !compact ? <small>{stop.meta.join(" · ")}</small> : null}
                {stop.description ? compact ? <StopDescription text={stop.description} /> : <p>{stop.description}</p> : null}
                {stop.meta.length && compact ? <small className="tp-stop-meta">{stop.meta.join(" • ")}</small> : null}
              </div>
            </div>
          </li>
        ))}
        {hasPickup && !compact ? (
          <li className="tp-step is-endpoint">
            <span className="tp-step-marker is-filled"><LuMapPin aria-hidden="true" /></span>
            <div className="tp-step-body">
              <strong>Drop-off at your hotel</strong>
            </div>
          </li>
        ) : null}
      </ol>
      {compact && stops.length > 3 ? (
        <button type="button" className="tp-link-btn" onClick={() => setAll((value) => !value)}>{all ? "Show less" : "See full itinerary"}</button>
      ) : null}
    </section>
  );
};

export const PickupInfo = ({ areas = "", startTimes = [] }) => {
  if (!areas && !startTimes.length) return null;
  return (
    <section id="pickup" className="tp-section">
      <h2>Pickup &amp; departure</h2>
      <div className="tp-two-col">
        {areas ? (
          <div>
            <h3 className="tp-label">Pickup areas</h3>
            <p>{areas}</p>
          </div>
        ) : null}
        {startTimes.length ? (
          <div>
            <h3 className="tp-label">Start times</h3>
            <p>{startTimes.join(", ")}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
};

export const CancellationPolicy = ({ text = "", emphasis = "" }) => {
  if (!text) return null;
  const at = emphasis ? text.indexOf(emphasis) : -1;
  return (
    <section id="cancellation" className="tp-section">
      <h2>Cancellation policy</h2>
      <p>
        {at >= 0 ? <>{text.slice(0, at)}<strong>{emphasis}</strong>{text.slice(at + emphasis.length)}</> : text}
      </p>
    </section>
  );
};

// Reviews: real score, counts and texts only. Without reviews the section says so instead of showing numbers.
// source/url: where the rating comes from (e.g. the tour's Tripadvisor page) and where to read the reviews.
// listing: the tour's own Tripadvisor page; with reviews but no score yet it is shown as "1 review on Tripadvisor".
export const Reviews = ({ rating = 0, reviewCount = 0, reviews = [], distribution = null, freeCancellationWindow = "", source = "", url = "", listing = null }) => {
  const count = Number(reviewCount) || 0;
  const unrated = listing?.scope === "product" && listing.url && Number(listing.reviewCount) > 0 ? listing : null;
  if ((count <= 0 || !(Number(rating) > 0)) && unrated) {
    const listed = Number(unrated.reviewCount);
    return (
      <section id="reviews" className="tp-section">
        <h2>Reviews</h2>
        <div className="tp-reviews-empty">
          <LuStar aria-hidden="true" />
          <div>
            <strong>{listed} review{listed === 1 ? "" : "s"} on Tripadvisor</strong>
            <p>
              <a className="tp-reviews-source" href={unrated.url} target="_blank" rel="noopener noreferrer">
                Read {listed === 1 ? "it" : "them"} on Tripadvisor <LuExternalLink aria-hidden="true" />
              </a>
            </p>
          </div>
        </div>
      </section>
    );
  }
  if (count <= 0 || !(Number(rating) > 0)) {
    return (
      <section id="reviews" className="tp-section">
        <h2>Reviews</h2>
        <div className="tp-reviews-empty">
          <LuStar aria-hidden="true" />
          <div>
            <strong>New experience</strong>
            <p>No reviews yet. Be one of the first travellers to book{freeCancellationWindow ? ` — with free cancellation up to ${freeCancellationWindow} before` : ""}.</p>
          </div>
        </div>
      </section>
    );
  }
  const bars = distribution ? [5, 4, 3, 2, 1].map((stars) => ({ stars, share: Math.max(0, Math.min(1, Number(distribution[stars] || 0) / count)) })) : [];
  return (
    <section id="reviews" className="tp-section">
      <h2>Reviews</h2>
      <div className="tp-reviews-summary">
        <div>
          <div className="tp-score">{Number(rating).toFixed(1)}</div>
          <Stars rating={rating} />
          <small>{count} {source ? `review${count === 1 ? "" : "s"} on ${source}` : `verified review${count === 1 ? "" : "s"}`}</small>
          {url ? (
            <a className="tp-reviews-source" href={url} target="_blank" rel="noopener noreferrer">
              Read the reviews{source ? ` on ${source}` : ""} <LuExternalLink aria-hidden="true" />
            </a>
          ) : null}
        </div>
        {bars.length ? (
          <ul className="tp-bars">
            {bars.map((bar) => (
              <li key={bar.stars}>
                <span>{bar.stars} star{bar.stars === 1 ? "" : "s"}</span>
                <span className="tp-bar"><span style={{ width: `${Math.round(bar.share * 100)}%` }} /></span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {reviews.length ? (
        <div className="tp-review-cards">
          {reviews.slice(0, 2).map((review, index) => (
            <article key={index} className="tp-review">
              <header>
                <span className="tp-avatar" aria-hidden="true">{String(review.name || "?").charAt(0).toUpperCase()}</span>
                <span><strong>{review.name}</strong><small>{[review.country, review.date].filter(Boolean).join(" · ")}</small></span>
              </header>
              <Stars rating={review.rating} />
              <p>{review.text}</p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
};

// "You might also like": four other tours with their real lowest price.
export const RelatedTours = ({ tour = {} }) => {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let active = true;
    fetchTours({ page: 1, limit: 18 })
      .then((result) => active && setRows(result.items || []))
      .catch(() => active && setRows([]));
    return () => { active = false; };
  }, []);
  const related = useMemo(
    () => rows.filter((row) => row.slug && row.slug !== tour.slug).slice(0, 4),
    [rows, tour.slug]
  );
  if (!related.length) return null;
  return (
    <section className="tp-related" aria-labelledby="tp-related-title">
      <h2 id="tp-related-title">You might also like</h2>
      <div className="tp-related-grid">
        {related.map((row) => {
          const image = Array.isArray(row.images) ? (typeof row.images[0] === "string" ? row.images[0] : row.images[0]?.url) : "";
          const tag = durationTag(row.duration, row.experienceType);
          return (
            <Link key={row.slug} to={`/tours/${row.slug}`} className="tp-related-card">
              <span className="tp-related-image">{image ? <img src={image} alt="" loading="lazy" decoding="async" /> : null}</span>
              <strong>{String(row.title || "").trim()}</strong>
              <small>{[row.duration, tag].filter(Boolean).join(" · ")}</small>
              {Number(row.fromPrice) > 0 ? <span className="tp-related-price">From <b>{formatCurrency(row.fromPrice, row.currency || "USD")}</b></span> : null}
            </Link>
          );
        })}
      </div>
    </section>
  );
};
