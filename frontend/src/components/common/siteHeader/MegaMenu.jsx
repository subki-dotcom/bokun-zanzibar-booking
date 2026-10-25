import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LuChevronRight, LuMessageCircle } from "react-icons/lu";
import { fetchMenuData } from "../../../api/toursApi";
import { MEGA_MENU, SITE, menuLinkHref, whatsappLink } from "../../../config/site";
import { money, photoAt } from "../../homePage/homeData";
import { menuLinkPrice, menuSearches, showMenuLink } from "./headerData";
import { trackSelectItem } from "../../../utils/analytics";

const SEARCHES = menuSearches();

const MegaMenuColumn = ({ column, searches }) => (
  <div className="sh-mega-col">
    <h2 className="sh-mega-title">{column.title}</h2>
    <ul>
      {column.links.filter((link) => showMenuLink(link, searches)).map((link) => {
        const price = menuLinkPrice(link, searches);
        return (
          <li key={link.label}>
            <Link to={menuLinkHref(link)}>
              {link.label}
              {/* A no-break space: the link is a flex row, which drops a plain leading space. */}
              {price ? <span className="sh-mega-price">{"\u00a0· from "}{money(price, searches[link.search]?.currency)}</span> : null}
            </Link>
          </li>
        );
      })}
      <li>
        <Link to={column.all.to} className="sh-mega-all">
          {column.all.label} <LuChevronRight aria-hidden="true" />
        </Link>
      </li>
    </ul>
  </div>
);

// The menu's tour: chosen by staff ("Featured") or the most booked ("Most popular").
const FeaturedTourCard = ({ pick }) => {
  if (!pick?.tour) return null;
  const { tour, source } = pick;
  return (
    <Link to={`/tours/${tour.slug}`} onClick={() => trackSelectItem(tour)} className="sh-mega-card">
      <span className="sh-mega-card-media">
        <img src={photoAt(tour.image, 600)} alt="" width="320" height="170" loading="lazy" decoding="async" />
        <span className="sh-mega-badge">{source === "admin" ? "Featured" : "Most popular"}</span>
      </span>
      <strong>{tour.title}</strong>
      <span className="sh-mega-card-meta">
        {[tour.duration, tour.fromPrice ? `From ${money(tour.fromPrice, tour.currency)} / ${tour.unit}` : ""].filter(Boolean).join(" · ")}
      </span>
    </Link>
  );
};

// "Tours & activities": four columns of links, a tour card and a WhatsApp line. Counts and prices come from the
// menu data; until then (or without it) the links from the config show.
const MegaMenu = ({ id, onNavigate, onMouseEnter, onMouseLeave }) => {
  const [data, setData] = useState(null);
  useEffect(() => {
    let active = true;
    fetchMenuData(SEARCHES)
      .then((value) => active && setData(value))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const whatsapp = whatsappLink(SITE.whatsappHelloMessage);

  return (
    <div className="sh-mega" id={id} onClick={(event) => event.target.closest("a") && onNavigate()} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <div className="sh-container">
        <div className="sh-mega-grid">
          {MEGA_MENU.map((column) => (
            <MegaMenuColumn key={column.key} column={column} searches={data?.searches || null} />
          ))}
          <FeaturedTourCard pick={data?.featured} />
        </div>
        <div className="sh-mega-foot">
          <p>
            Not sure which tour fits your plan?{" "}
            {whatsapp ? (
              <a href={whatsapp} target="_blank" rel="noreferrer">
                <LuMessageCircle aria-hidden="true" /> Ask our team on WhatsApp
              </a>
            ) : null}
          </p>
          <Link to="/tours" className="sh-pill sh-pill-brand">View all tours</Link>
        </div>
      </div>
    </div>
  );
};

export default MegaMenu;
