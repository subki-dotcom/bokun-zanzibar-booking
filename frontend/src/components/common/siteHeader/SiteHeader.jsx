import BrandMark from "../BrandMark";
import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LuCalendarDays, LuCheck, LuChevronDown, LuMail, LuMenu, LuMessageCircle, LuPhone, LuSearch } from "react-icons/lu";
import { fetchMenuData, fetchTours } from "../../../api/toursApi";
import { MAIN_NAV, SITE, whatsappLink } from "../../../config/site";
import { activeNavKey, menuSearches } from "./headerData";
import useStickyHeader from "./useStickyHeader";
import CheckoutHeader from "./CheckoutHeader";
import useBookingSession, { signOutBookingSession } from "../../myBooking/useBookingSession";
import "./siteHeader.css";

// The menu, the search and the phone menu load when first opened.
const loadMegaMenu = () => import("./MegaMenu");
const loadSearchPanel = () => import("./SearchPanel");
const loadMobileMenu = () => import("./MobileMenu");
const MegaMenu = lazy(loadMegaMenu);
const SearchPanel = lazy(loadSearchPanel);
const MobileMenu = lazy(loadMobileMenu);

const HOVER_DELAY_MS = 150;

export const Logo = ({ onClick }) => (
  <Link to="/" className="sh-logo" onClick={onClick} aria-label={`${SITE.name} home`}>
    <span className="sh-logo-mark brand-mark-slot" aria-hidden="true"><BrandMark size="100%" /></span>
    <span className="sh-logo-text">
      <strong>{SITE.name}</strong>
      <small>{SITE.address.locality} · {SITE.address.country}</small>
    </span>
  </Link>
);

// Ink line above the bar: promises on the left, contacts and currency on the right (one line on phones).
const UtilityBar = () => (
  <div className="sh-utility">
    <div className="sh-container sh-utility-inner">
      <p className="sh-promises">
        <span><LuCheck aria-hidden="true" /> Free cancellation up to 24h on most tours</span>
        <span className="sh-hide-compact"><LuCheck aria-hidden="true" /> Instant confirmation</span>
      </p>
      <p className="sh-contacts sh-hide-compact">
        <a href={SITE.phoneHref}><LuPhone aria-hidden="true" /> {SITE.phone}</a>
        <a href={`mailto:${SITE.email}`}><LuMail aria-hidden="true" /> {SITE.email}</a>
        <span className="sh-currency" aria-label="Prices in US dollars">{SITE.currencies.length > 1 ? "USD $ ▾" : "USD"}</span>
      </p>
    </div>
  </div>
);

// On "My booking" pages: who is signed in (masked email) and Sign out, in place of the WhatsApp pill.
const BookingAccount = ({ email }) => {
  const navigate = useNavigate();
  return (
    <div className="sh-account">
      <span className="sh-account-avatar" aria-hidden="true">{email.charAt(0).toUpperCase()}</span>
      <span className="sh-account-text">
        <span><span className="sh-visually-hidden">Signed in as </span>{email}</span>
        <button
          type="button"
          onClick={async () => {
            await signOutBookingSession();
            navigate("/my-booking", { replace: true });
          }}
        >
          Sign out
        </button>
      </span>
    </div>
  );
};

const WhatsAppButton = ({ iconOnly = false }) => {
  const href = whatsappLink(SITE.whatsappHelloMessage);
  if (!href) return null;
  return iconOnly ? (
    <a href={href} className="sh-icon-btn sh-wa-icon" target="_blank" rel="noreferrer" aria-label="Chat with us on WhatsApp">
      <LuMessageCircle aria-hidden="true" />
    </a>
  ) : (
    <a href={href} className="sh-pill sh-pill-whatsapp sh-wa" target="_blank" rel="noreferrer">
      <LuMessageCircle aria-hidden="true" /> WhatsApp
    </a>
  );
};

/**
 * The site header.
 * variant "default": utility line and white bar; "transparent": over the home hero until the page scrolls;
 * "checkout": logo, progress and help only (props: step, confirmLeave, showSteps).
 * Once the page scrolls the bar becomes compact and white, with a search box next to the menu.
 */
const SiteHeader = ({ variant = "default", ...checkoutProps }) => {
  const location = useLocation();
  const stuck = useStickyHeader(80);
  const onMyBooking = location.pathname === "/my-booking" || location.pathname.startsWith("/my-booking/");
  const bookingSession = useBookingSession({ load: onMyBooking });
  const signedInEmail = onMyBooking && bookingSession.status === "signed_in" ? bookingSession.email : "";
  const megaId = useId();
  const menuId = useId();
  const [megaOpen, setMegaOpen] = useState(false);
  const [megaMounted, setMegaMounted] = useState(false);
  const [search, setSearch] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const trigger = useRef(null);
  const megaWrap = useRef(null);
  const hoverTimer = useRef(0);
  // The button that opened the search or the phone menu gets focus back when it closes.
  const opener = useRef(null);
  const refocusOpener = () => setTimeout(() => opener.current?.focus(), 0);

  const closeMega = useCallback(() => setMegaOpen(false), []);
  const openMega = useCallback(() => {
    setMegaMounted(true);
    setMegaOpen(true);
  }, []);

  // Any page change closes what is open.
  useEffect(() => {
    setMegaOpen(false);
    setMenuOpen(false);
    setSearch(null);
  }, [location.pathname, location.search]);

  // The menu closes on Esc (focus back on its button) and on a click elsewhere.
  useEffect(() => {
    if (!megaOpen) return undefined;
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      setMegaOpen(false);
      trigger.current?.focus();
    };
    const onDown = (event) => {
      if (!megaWrap.current?.contains(event.target)) setMegaOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [megaOpen]);

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  if (variant === "checkout") return <CheckoutHeader {...checkoutProps} />;

  const activeKey = activeNavKey(location.pathname, location.search);
  const transparent = variant === "transparent" && !stuck && !megaOpen;

  // Hover opens after a short pause (and fetches what the menu and the tours page need).
  const prefetch = () => {
    loadMegaMenu();
    fetchMenuData(menuSearches()).catch(() => {});
    fetchTours({ page: 1, limit: 9 }).catch(() => {});
  };
  const hoverIn = () => {
    prefetch();
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(openMega, HOVER_DELAY_MS);
  };
  const hoverOut = () => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(closeMega, HOVER_DELAY_MS);
  };
  const openSearch = (event, query = "") => {
    opener.current = event?.currentTarget || null;
    loadSearchPanel();
    setMegaOpen(false);
    setSearch({ query });
  };
  const closeSearch = () => {
    setSearch(null);
    refocusOpener();
  };
  const closeMenu = () => {
    setMenuOpen(false);
    refocusOpener();
  };

  const classes = ["sh", `sh-${variant}`, transparent ? "is-transparent" : "", stuck ? "is-stuck" : "", megaOpen ? "is-mega" : ""];

  return (
    <>
      <a className="sh-skip" href="#main-content">Skip to content</a>
      <div className={`sh-shell sh-shell-${variant}`}>
        <header className={classes.filter(Boolean).join(" ")} role="banner">
          <UtilityBar />
          <div className="sh-bar">
            <div className="sh-container sh-bar-inner">
              <Logo />
              <nav className="sh-nav" aria-label="Main">
                <ul>
                  {MAIN_NAV.map((item) =>
                    item.menu ? (
                      <li key={item.key} ref={megaWrap} className="sh-nav-mega" onMouseEnter={hoverIn} onMouseLeave={hoverOut} onFocus={prefetch}>
                        <button
                          ref={trigger}
                          type="button"
                          className={activeKey === item.key ? "sh-nav-link is-active" : "sh-nav-link"}
                          aria-expanded={megaOpen}
                          aria-controls={megaId}
                          onClick={() => (megaOpen ? closeMega() : openMega())}
                        >
                          {item.label} <LuChevronDown aria-hidden="true" className="sh-caret" />
                        </button>
                        {megaMounted ? (
                          <Suspense fallback={null}>
                            <div hidden={!megaOpen}>
                              <MegaMenu id={megaId} onNavigate={closeMega} />
                            </div>
                          </Suspense>
                        ) : null}
                      </li>
                    ) : (
                      <li key={item.key}>
                        <Link
                          to={item.to}
                          className={activeKey === item.key ? "sh-nav-link is-active" : "sh-nav-link"}
                          aria-current={activeKey === item.key ? "page" : undefined}
                        >
                          {item.key === "booking" ? <LuCalendarDays aria-hidden="true" className="sh-nav-icon" /> : null}
                          {item.label}
                        </Link>
                      </li>
                    )
                  )}
                </ul>
              </nav>

              <div className="sh-actions">
                {/* Scrolled: a search box beside the menu (it opens the search panel). */}
                <button type="button" className="sh-inline-search" onClick={(event) => openSearch(event)} tabIndex={stuck ? 0 : -1} aria-hidden={!stuck || undefined}>
                  <LuSearch aria-hidden="true" />
                  <span>Search tours</span>
                </button>
                <button type="button" className="sh-icon-btn sh-search-btn" aria-label="Search tours" onClick={(event) => openSearch(event)}>
                  <LuSearch aria-hidden="true" />
                </button>
                {signedInEmail ? <span className="sh-wa-pill-wrap"><BookingAccount email={signedInEmail} /></span> : <span className="sh-wa-pill-wrap"><WhatsAppButton /></span>}
                <span className="sh-wa-icon-wrap"><WhatsAppButton iconOnly /></span>
                <button
                  type="button"
                  className="sh-icon-btn sh-menu-btn"
                  aria-label="Open menu"
                  aria-expanded={menuOpen}
                  aria-controls={menuId}
                  onClick={(event) => {
                    opener.current = event.currentTarget;
                    loadMobileMenu();
                    setMenuOpen(true);
                  }}
                >
                  <LuMenu aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </header>
        {megaOpen ? <button type="button" className="sh-backdrop sh-mega-backdrop" aria-label="Close menu" tabIndex={-1} onClick={closeMega} /> : null}
      </div>

      {search ? (
        <Suspense fallback={null}>
          <SearchPanel initialQuery={search.query} onClose={closeSearch} />
        </Suspense>
      ) : null}
      {menuOpen ? (
        <Suspense fallback={null}>
          <MobileMenu id={menuId} activeKey={activeKey} onClose={closeMenu} Logo={Logo} />
        </Suspense>
      ) : null}
    </>
  );
};

export default SiteHeader;
