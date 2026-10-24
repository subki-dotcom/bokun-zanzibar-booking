import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LuCheck, LuMenu, LuMessageCircle, LuX } from "react-icons/lu";
import { BRAND } from "../../config/brand";
import { HOME_STYLES, styleHref } from "./homeData";

// Ink bar above the header: the cancellation promise, WhatsApp, My booking and the currency.
export const UtilityBar = () => (
  <div className="hp-utility">
    <div className="hp-container hp-utility-inner">
      <span className="hp-utility-promise">
        <LuCheck aria-hidden="true" /> Free cancellation up to 24 hours on most tours
      </span>
      <span className="hp-utility-links">
        {BRAND.whatsappHref ? (
          <a href={BRAND.whatsappHref} target="_blank" rel="noreferrer">WhatsApp {BRAND.phone}</a>
        ) : null}
        <Link to="/my-booking">My booking</Link>
        <span aria-label="Prices in US dollars">USD $</span>
      </span>
    </div>
  </div>
);

const Logo = () => (
  <Link to="/" className="hp-logo" aria-label={`${BRAND.name} home`}>
    <span className="hp-logo-mark" aria-hidden="true">{BRAND.name.charAt(0)}</span>
    <span className="hp-logo-text">
      <strong>{BRAND.name}</strong>
      <small>Zanzibar · Tanzania</small>
    </span>
  </Link>
);

// Phones: the same links in a panel (focus kept inside, Esc closes).
const MobileMenu = ({ onClose }) => {
  const panel = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.querySelector("a, button")?.focus();
    document.body.style.overflow = "hidden";
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const items = [...(panel.current?.querySelectorAll("a, button") || [])];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="hp-menu-layer">
      <button type="button" className="hp-menu-backdrop" aria-label="Close menu" onClick={onClose} tabIndex={-1} />
      <nav className="hp-menu" ref={panel} aria-label="Main" id="hp-mobile-menu">
        <div className="hp-menu-head">
          <strong>Menu</strong>
          <button type="button" className="hp-icon-btn" onClick={onClose} aria-label="Close menu">
            <LuX aria-hidden="true" />
          </button>
        </div>
        <ul>
          {HOME_STYLES.map((style) => (
            <li key={style.key}>
              <Link to={styleHref(style.label)} onClick={onClose}>{style.nav}</Link>
            </li>
          ))}
          <li><Link to="/tours" onClick={onClose}>All tours</Link></li>
          <li><Link to="/my-booking" onClick={onClose}>My booking</Link></li>
        </ul>
        {BRAND.whatsappHref ? (
          <a className="hp-btn hp-btn-brand hp-menu-whatsapp" href={BRAND.whatsappHref} target="_blank" rel="noreferrer">
            <LuMessageCircle aria-hidden="true" /> Chat on WhatsApp
          </a>
        ) : null}
      </nav>
    </div>
  );
};

// Header: logo, the five travel styles and "View all tours" (a menu button on phones).
export const SiteHeader = () => {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <header className="hp-header">
      <div className="hp-container hp-header-inner">
        <Logo />
        <nav className="hp-nav" aria-label="Main">
          {HOME_STYLES.map((style) => (
            <Link key={style.key} to={styleHref(style.label)}>{style.nav}</Link>
          ))}
        </nav>
        <Link to="/tours" className="hp-btn hp-btn-brand hp-header-cta">View all tours</Link>
        <button
          type="button"
          className="hp-icon-btn hp-menu-btn"
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="hp-mobile-menu"
          onClick={() => setOpen(true)}
        >
          <LuMenu aria-hidden="true" />
        </button>
      </div>
      {open ? <MobileMenu onClose={close} /> : null}
    </header>
  );
};
