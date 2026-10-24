import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { BsFacebook, BsInstagram, BsTiktok, BsWhatsapp, BsYoutube } from "react-icons/bs";
import { FaTripadvisor } from "react-icons/fa";
import { LuChevronDown, LuMail, LuMapPin, LuMessageCircle, LuPhone } from "react-icons/lu";
import { fetchTours } from "../../../api/toursApi";
import { FOOTER_LINKS, SITE, whatsappLink } from "../../../config/site";
import { openCookiePreferences } from "../../../utils/consent";
import NewsletterForm from "./NewsletterForm";
import PaymentBadges from "./PaymentBadges";
import "./siteFooter.css";

const MOBILE_QUERY = "(max-width: 767.98px)";

const useIsMobile = () => {
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.matchMedia?.(MOBILE_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia?.(MOBILE_QUERY);
    if (!media) return undefined;
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return Boolean(mobile);
};

// Links marked "onlyIfFound" (Safari Blue) appear once a search for them finds a tour.
const useFoundSearches = (links) => {
  const [found, setFound] = useState(() => new Set());
  const searches = links.map((link) => link.onlyIfFound).filter(Boolean).join("|");
  useEffect(() => {
    if (!searches) return undefined;
    let active = true;
    Promise.all(
      searches.split("|").map((query) =>
        fetchTours({ page: 1, limit: 1, query })
          .then((result) => (result.items?.length ? query : ""))
          .catch(() => "")
      )
    ).then((hits) => {
      if (active) setFound(new Set(hits.filter(Boolean)));
    });
    return () => {
      active = false;
    };
  }, [searches]);
  return found;
};

const SOCIAL = [
  { key: "instagram", label: "Instagram", icon: BsInstagram },
  { key: "facebook", label: "Facebook", icon: BsFacebook },
  { key: "tripadvisor", label: "Tripadvisor", icon: FaTripadvisor },
  { key: "tiktok", label: "TikTok", icon: BsTiktok },
  { key: "youtube", label: "YouTube", icon: BsYoutube }
];

const SocialLinks = () => {
  const links = SOCIAL.filter((item) => SITE.social[item.key]).map((item) => ({ ...item, href: SITE.social[item.key] }));
  const whatsapp = whatsappLink();
  if (whatsapp) links.push({ key: "whatsapp", label: "WhatsApp", icon: BsWhatsapp, href: whatsapp });
  if (!links.length) return null;
  return (
    <ul className="sf-social">
      {links.map(({ key, label, icon: Icon, href }) => (
        <li key={key}>
          <a href={href} target="_blank" rel="noreferrer" aria-label={`${SITE.name} on ${label}`}>
            <Icon aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  );
};

// A link column; on phones it folds, and the first one starts open.
const LinkColumn = ({ title, links, mobile, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  const listId = useId();
  const expanded = !mobile || open;
  return (
    <nav className="sf-col" aria-label={title}>
      <h2 className="sf-col-title">
        {mobile ? (
          <button type="button" className="sf-fold" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((value) => !value)}>
            {title}
            <LuChevronDown aria-hidden="true" className={open ? "is-open" : ""} />
          </button>
        ) : (
          title
        )}
      </h2>
      <ul id={listId} className="sf-links" hidden={!expanded}>
        {links.map((link) => (
          <li key={link.label}>
            <Link to={link.to}>{link.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
};

const ContactList = () => (
  <ul className="sf-contact">
    <li>
      <LuMapPin aria-hidden="true" />
      <span>{SITE.address.locality}, {SITE.address.country}</span>
    </li>
    <li>
      <LuPhone aria-hidden="true" />
      <a href={SITE.phoneHref}>{SITE.phone}</a>
    </li>
    <li>
      <LuMail aria-hidden="true" />
      <a href={`mailto:${SITE.email}`}>{SITE.email}</a>
    </li>
  </ul>
);

const CookieButton = ({ children = "Cookie preferences" }) => (
  <button type="button" className="sf-textbtn" onClick={openCookiePreferences}>{children}</button>
);

// Checkout, payment and confirmation pages: one bar, so guests stay on paying.
const CompactFooter = () => {
  const year = new Date().getFullYear();
  return (
    <footer className="sf sf-compact" role="contentinfo">
      <div className="sf-container sf-compact-row">
        <p className="sf-compact-links">
          <span>© {year} {SITE.name}</span>
          <span aria-hidden="true">·</span>
          <Link to="/terms">Terms</Link>
          <span aria-hidden="true">·</span>
          <Link to="/privacy">Privacy</Link>
          <span aria-hidden="true">·</span>
          <CookieButton />
          <span aria-hidden="true">·</span>
          <a href={`mailto:${SITE.email}`}>{SITE.email}</a>
          <span aria-hidden="true">·</span>
          <a href={SITE.phoneHref}>{SITE.phone}</a>
        </p>
        <PaymentBadges />
      </div>
    </footer>
  );
};

const SiteFooter = ({ compact = false }) => {
  const mobile = useIsMobile();
  const found = useFoundSearches(compact ? [] : FOOTER_LINKS.experiences);
  if (compact) return <CompactFooter />;

  const year = new Date().getFullYear();
  const whatsapp = whatsappLink();
  const experiences = FOOTER_LINKS.experiences.filter((link) => !link.onlyIfFound || found.has(link.onlyIfFound));

  return (
    <footer className="sf" role="contentinfo">
      <section className="sf-cta" aria-labelledby="sf-cta-title">
        <div className="sf-container sf-cta-row">
          <div>
            <h2 id="sf-cta-title">Planning a trip to Zanzibar?</h2>
            <p>
              Tell us your dates and hotel – we&apos;ll help you <span className="sf-hide-mobile">build the perfect plan</span>
              <span className="sf-show-mobile">plan</span>.
            </p>
          </div>
          <div className="sf-cta-actions">
            {whatsapp ? (
              <a href={whatsapp} className="sf-pill sf-pill-white" target="_blank" rel="noreferrer">
                <LuMessageCircle aria-hidden="true" /> Chat on WhatsApp
              </a>
            ) : null}
            <a href={SITE.phoneHref} className="sf-pill sf-pill-outline">
              <span>
                <span className="sf-show-mobile">Call </span>
                {SITE.phone}
              </span>
            </a>
          </div>
        </div>
      </section>

      <div className="sf-container sf-main">
        <div className="sf-brand">
          <Link to="/" className="sf-logo">
            <span className="sf-logo-mark" aria-hidden="true">R</span>
            <span className="sf-logo-name">{SITE.name}</span>
          </Link>
          <p>
            <span className="sf-hide-mobile">{SITE.description}</span>
            <span className="sf-show-mobile">{SITE.tagline}</span>
          </p>
          <SocialLinks />
        </div>

        <LinkColumn title="Top experiences" links={experiences} mobile={mobile} defaultOpen />
        <LinkColumn title="Company" links={FOOTER_LINKS.company} mobile={mobile} />
        <LinkColumn title="Help" links={FOOTER_LINKS.help} mobile={mobile} />

        <div className="sf-col sf-contact-col">
          <h2 className="sf-col-title">Contact</h2>
          <ContactList />
          <NewsletterForm />
        </div>
      </div>

      <div className="sf-bottom">
        <div className="sf-container sf-bottom-row">
          <p className="sf-copy sf-hide-mobile">
            © {year} {SITE.name}. All rights reserved. <span aria-hidden="true">·</span> <CookieButton />
          </p>
          <div className="sf-secure">
            <span className="sf-hide-mobile">Secure payments</span>
            <PaymentBadges />
          </div>
          <p className="sf-copy sf-show-mobile">
            © {year} {SITE.name} <span aria-hidden="true">·</span> <Link to="/terms">Terms</Link> <span aria-hidden="true">·</span>{" "}
            <Link to="/privacy">Privacy</Link> <span aria-hidden="true">·</span> <CookieButton>Cookies</CookieButton>
          </p>
        </div>
      </div>
    </footer>
  );
};

export default SiteFooter;
