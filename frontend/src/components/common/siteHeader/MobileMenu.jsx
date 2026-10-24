import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LuCheck, LuChevronDown, LuChevronRight, LuMail, LuMessageCircle, LuPhone, LuX } from "react-icons/lu";
import { MAIN_NAV, MOBILE_TOUR_LINKS, SITE, whatsappLink } from "../../../config/site";
import useDialogFocus from "./useDialogFocus";

// Phones and tablets: the whole navigation in a sheet over the page ("Tours & activities" folds, open at first).
const MobileMenu = ({ id, activeKey, onClose, Logo }) => {
  const panel = useRef(null);
  const [toursOpen, setToursOpen] = useState(true);
  useDialogFocus(panel, onClose);
  const whatsapp = whatsappLink(SITE.whatsappHelloMessage);
  const current = (key) => (key === activeKey ? { "aria-current": "page" } : {});

  return (
    <div className="sh-menu-layer">
      <div className="sh-menu" id={id} ref={panel} role="dialog" aria-modal="true" aria-label="Menu">
        <div className="sh-menu-head">
          <Logo onClick={onClose} />
          <button type="button" className="sh-icon-btn" onClick={onClose} aria-label="Close menu">
            <LuX aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Main" className="sh-menu-nav">
          <ul>
            {MAIN_NAV.map((item) =>
              item.menu ? (
                <li key={item.key} className="sh-menu-group">
                  <button
                    type="button"
                    className="sh-menu-row"
                    aria-expanded={toursOpen}
                    aria-controls={`${id}-tours`}
                    onClick={() => setToursOpen((open) => !open)}
                  >
                    {item.label}
                    <LuChevronDown aria-hidden="true" className={toursOpen ? "is-open" : ""} />
                  </button>
                  <ul id={`${id}-tours`} hidden={!toursOpen} className="sh-menu-sub">
                    {MOBILE_TOUR_LINKS.map((link) => (
                      <li key={link.label}>
                        <Link to={link.to} onClick={onClose}>{link.label}</Link>
                      </li>
                    ))}
                    <li>
                      <Link to="/tours" onClick={onClose} className="sh-menu-all" {...current("tours")}>
                        View all tours <LuChevronRight aria-hidden="true" />
                      </Link>
                    </li>
                  </ul>
                </li>
              ) : (
                <li key={item.key}>
                  <Link to={item.to} onClick={onClose} className="sh-menu-row" {...current(item.key)}>
                    {item.label}
                    <LuChevronRight aria-hidden="true" />
                  </Link>
                </li>
              )
            )}
          </ul>
          <p className="sh-menu-currency">
            <span>Currency</span>
            <span>{SITE.currencies.length > 1 ? "USD $ ▾" : "USD $"}</span>
          </p>
        </nav>

        <div className="sh-menu-foot">
          {whatsapp ? (
            <a href={whatsapp} className="sh-pill sh-pill-whatsapp sh-menu-wa" target="_blank" rel="noreferrer">
              <LuMessageCircle aria-hidden="true" /> Chat on WhatsApp
            </a>
          ) : null}
          <div className="sh-menu-contact">
            <a href={SITE.phoneHref} className="sh-pill sh-pill-outline">
              <LuPhone aria-hidden="true" /> Call us
            </a>
            <a href={`mailto:${SITE.email}`} className="sh-pill sh-pill-outline">
              <LuMail aria-hidden="true" /> Email us
            </a>
          </div>
          <p className="sh-menu-promise">
            <LuCheck aria-hidden="true" /> Free cancellation up to 24h on most tours
          </p>
        </div>
      </div>
    </div>
  );
};

export default MobileMenu;
