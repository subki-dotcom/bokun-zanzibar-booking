import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LuChevronRight, LuSearch, LuX } from "react-icons/lu";
import { fetchMenuData, fetchTours } from "../../../api/toursApi";
import { POPULAR_SEARCHES, SITE, whatsappLink } from "../../../config/site";
import { money, photoAt } from "../../homePage/homeData";
import { menuSearches } from "./headerData";
import useDialogFocus from "./useDialogFocus";

// One result row: a listing item (typed search) or a home card (top tours).
const toResult = (tour = {}) => {
  const image = tour.image || (Array.isArray(tour.images) ? tour.images[0] : "");
  const meta = [tour.fromPrice ? `From ${money(tour.fromPrice, tour.currency)}` : "", tour.duration].filter(Boolean).join(" · ");
  return { slug: tour.slug, title: tour.title, image, meta };
};

const toursHref = (query) => (query ? `/tours?q=${encodeURIComponent(query)}` : "/tours");

// Search over the page (desktop: a panel at the top; phones: full screen). Popular searches, the top tours or the
// first three matches; ↑/↓ choose a result, Enter opens it (or the full list), Esc closes.
const SearchPanel = ({ onClose, initialQuery = "" }) => {
  const navigate = useNavigate();
  const panel = useRef(null);
  const input = useRef(null);
  const listId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState([]);
  const [top, setTop] = useState([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  useDialogFocus(panel, onClose, { initialFocus: input });

  useEffect(() => {
    fetchMenuData(menuSearches())
      .then((data) => setTop((data?.top || []).map(toResult)))
      .catch(() => {});
  }, []);

  const text = query.trim();
  useEffect(() => {
    setActive(-1);
    if (!text) {
      setResults([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    let current = true;
    const timer = setTimeout(() => {
      fetchTours({ page: 1, limit: 3, query: text })
        .then((data) => current && setResults((data.items || []).slice(0, 3).map(toResult)))
        .catch(() => current && setResults([]))
        .finally(() => current && setLoading(false));
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [text]);

  const shown = text ? results : top;
  const go = (href) => {
    onClose();
    navigate(href);
  };
  const onKeyDown = (event) => {
    if (event.key === "ArrowDown" && shown.length) {
      event.preventDefault();
      setActive((index) => (index + 1) % shown.length);
    } else if (event.key === "ArrowUp" && shown.length) {
      event.preventDefault();
      setActive((index) => (index <= 0 ? shown.length - 1 : index - 1));
    }
  };
  const submit = (event) => {
    event.preventDefault();
    go(active >= 0 && shown[active] ? `/tours/${shown[active].slug}` : toursHref(text));
  };
  const whatsapp = whatsappLink(SITE.whatsappHelloMessage);

  return (
    <div className="sh-search-layer">
      <button type="button" className="sh-backdrop" aria-label="Close search" tabIndex={-1} onClick={onClose} />
      <div className="sh-search" ref={panel} role="dialog" aria-modal="true" aria-label="Search tours">
        <form className="sh-search-row" role="search" onSubmit={submit}>
          <label className="sh-search-field">
            <LuSearch aria-hidden="true" />
            <span className="sh-visually-hidden">Search tours</span>
            <input
              ref={input}
              type="search"
              value={query}
              placeholder="Where do you want to go? Mnemba, Stone Town, safari…"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded={shown.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
              enterKeyHint="search"
            />
          </label>
          <button type="button" className="sh-search-cancel" onClick={onClose}>
            <span className="sh-show-phone">Cancel</span>
            <LuX aria-hidden="true" className="sh-hide-phone" />
            <span className="sh-visually-hidden sh-hide-phone">Close search</span>
          </button>
        </form>

        <div className="sh-search-body">
          <p className="sh-search-label">Popular searches</p>
          <ul className="sh-chips">
            {POPULAR_SEARCHES.map((item) => (
              <li key={item.label}>
                <button type="button" onClick={() => setQuery(item.query)}>{item.label}</button>
              </li>
            ))}
          </ul>

          <p className="sh-search-label" aria-live="polite">
            {text ? `Tours matching “${text}”` : "Top tours"}
          </p>
          {text && !loading && !results.length ? <p className="sh-search-empty">No tours match yet. Try another word.</p> : null}
          <ul className="sh-results" id={listId} role="listbox" aria-label={text ? `Tours matching ${text}` : "Top tours"}>
            {shown.map((tour, index) => (
              <li key={tour.slug} id={`${listId}-${index}`} role="option" aria-selected={index === active}>
                <Link to={`/tours/${tour.slug}`} onClick={onClose} className={index === active ? "is-active" : ""} tabIndex={-1}>
                  <span className="sh-result-thumb">{tour.image ? <img src={photoAt(tour.image, 160)} alt="" width="80" height="64" loading="lazy" /> : null}</span>
                  <span>
                    <strong>{tour.title}</strong>
                    <small>{tour.meta}</small>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link to={toursHref(text)} onClick={onClose} className="sh-search-all">
            {text ? "See all results" : "See all tours"} <LuChevronRight aria-hidden="true" />
          </Link>
        </div>

        {whatsapp ? (
          <p className="sh-search-foot">
            Can&apos;t find it?{" "}
            <a href={whatsapp} target="_blank" rel="noreferrer">Ask us on WhatsApp</a>
          </p>
        ) : null}
      </div>
    </div>
  );
};

export default SearchPanel;
