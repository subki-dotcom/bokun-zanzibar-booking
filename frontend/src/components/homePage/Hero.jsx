import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LuCalendar, LuCheck, LuMessageCircle, LuMinus, LuPlus, LuSearch, LuUser } from "react-icons/lu";
import { BRAND } from "../../config/brand";
import { HOME_STYLES, searchHref, shortDate, todayIso, travelersText, whatsappPlanHref } from "./homeData";

const HERO_IMAGE = "/images/home/hero-dhow";

// Full-bleed photo with the promise, the H1 and two actions.
export const Hero = () => {
  const whatsapp = whatsappPlanHref(BRAND.whatsappHref, BRAND.name);
  return (
    <section className="hp-hero" aria-labelledby="hp-hero-title">
      <picture>
        <source type="image/avif" srcSet={`${HERO_IMAGE}-640.avif 640w, ${HERO_IMAGE}-960.avif 960w, ${HERO_IMAGE}-1280.avif 1280w`} sizes="100vw" />
        <source type="image/webp" srcSet={`${HERO_IMAGE}-640.webp 640w, ${HERO_IMAGE}-960.webp 960w, ${HERO_IMAGE}-1280.webp 1280w`} sizes="100vw" />
        <img
          className="hp-hero-img"
          src={`${HERO_IMAGE}-1280.jpg`}
          alt="A traditional dhow sailing at sunset off the coast of Zanzibar"
          width="1264"
          height="836"
          fetchpriority="high"
          decoding="async"
        />
      </picture>
      <div className="hp-container hp-hero-inner">
        <span className="hp-hero-pill">Local Zanzibar team · Live availability</span>
        <h1 id="hp-hero-title">
          Zanzibar tours, safaris &amp; transfers<span className="hp-hide-mobile"> – booked with local experts</span>
        </h1>
        <p className="hp-hero-lead">
          <span className="hp-hide-mobile">Snorkel Mnemba, explore Stone Town, fly to the Serengeti. Instant confirmation and secure checkout.</span>
          <span className="hp-show-mobile">Booked with local experts. Instant confirmation &amp; secure checkout.</span>
        </p>
        <div className="hp-hero-actions">
          <a href="#hp-styles" className="hp-btn hp-btn-white">Explore tours</a>
          {whatsapp ? (
            <a href={whatsapp} className="hp-btn hp-btn-outline-light" target="_blank" rel="noreferrer">
              <LuMessageCircle aria-hidden="true" /> Plan with us on WhatsApp
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
};

const TRUST = ["Free cancellation on most tours", "Instant confirmation", "Hotel pickup options", "Card, M-Pesa & PayPal"];

export const TrustList = () => (
  <ul className="hp-trust">
    {TRUST.map((item) => (
      <li key={item}>
        <LuCheck aria-hidden="true" /> {item}
      </li>
    ))}
  </ul>
);

// Travellers: a small stepper in a popover.
const TravelersField = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => !wrap.current?.contains(event.target) && setOpen(false);
    const esc = (event) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="hp-field hp-travelers" ref={wrap}>
      <span className="hp-field-label" id="hp-travelers-label">Travelers</span>
      <button type="button" className="hp-control" aria-labelledby="hp-travelers-label hp-travelers-value" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <LuUser aria-hidden="true" />
        <span id="hp-travelers-value">{travelersText(value)}</span>
      </button>
      {open ? (
        <div className="hp-popover" role="group" aria-label="Number of travelers">
          <span>Travelers</span>
          <div className="hp-stepper">
            <button type="button" onClick={() => onChange(Math.max(1, value - 1))} disabled={value <= 1} aria-label="Fewer travelers">
              <LuMinus aria-hidden="true" />
            </button>
            <output aria-live="polite">{value}</output>
            <button type="button" onClick={() => onChange(Math.min(20, value + 1))} disabled={value >= 20} aria-label="More travelers">
              <LuPlus aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

// Date: the browser's own date picker behind an "Any date" button.
const DateField = ({ value, onChange }) => {
  const input = useRef(null);
  const open = () => {
    try {
      input.current?.showPicker?.();
    } catch {
      input.current?.focus();
    }
  };
  return (
    <div className="hp-field hp-date">
      <label className="hp-field-label" htmlFor="hp-date-input">Date</label>
      <div className="hp-control hp-date-control" onClick={open}>
        <LuCalendar aria-hidden="true" />
        <span aria-hidden="true">{value ? shortDate(value) : "Any date"}</span>
        <input
          ref={input}
          id="hp-date-input"
          type="date"
          min={todayIso()}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={value ? `Date: ${shortDate(value)}` : "Date: any date"}
        />
      </div>
    </div>
  );
};

// The search card under the hero: style, date and travellers, sent to /tours.
export const HeroSearchCard = () => {
  const navigate = useNavigate();
  const [category, setCategory] = useState("");
  const [date, setDate] = useState("");
  const [travelers, setTravelers] = useState(2);
  return (
    <div className="hp-container hp-search-wrap">
      <form
        className="hp-search"
        role="search"
        aria-label="Find tours"
        onSubmit={(event) => {
          event.preventDefault();
          navigate(searchHref({ category, date, travelers }));
        }}
      >
        <div className="hp-search-fields">
          <div className="hp-field hp-experience">
            <label className="hp-field-label" htmlFor="hp-experience">Experience</label>
            <select id="hp-experience" className="hp-control" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">All experiences</option>
              {HOME_STYLES.map((style) => (
                <option key={style.key} value={style.label}>{style.label}</option>
              ))}
            </select>
          </div>
          <DateField value={date} onChange={setDate} />
          <TravelersField value={travelers} onChange={setTravelers} />
          <button type="submit" className="hp-search-btn">
            <LuSearch aria-hidden="true" /> Find tours
          </button>
        </div>
        <TrustList />
      </form>
    </div>
  );
};
