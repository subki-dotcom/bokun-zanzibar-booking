import { Link } from "react-router-dom";
import { LuSearchX } from "react-icons/lu";
import { SITE, whatsappLink } from "../../../config/site";
import { MAIN_SORTS, SORT_OPTIONS, writeFilters } from "./toursPageData";

// Recommended · Price: low to high · Price: high to low, and the other orders under "More".
export const SortPills = ({ value, onChange }) => {
  const others = SORT_OPTIONS.filter((option) => !MAIN_SORTS.includes(option.key));
  const otherActive = others.some((option) => option.key === value);
  return (
    <div className="tl-sorts" role="group" aria-label="Sort tours">
      {SORT_OPTIONS.filter((option) => MAIN_SORTS.includes(option.key)).map((option) => (
        <button key={option.key} type="button" className="tl-sort" aria-pressed={value === option.key} onClick={() => onChange(option.key)}>
          {option.label}
        </button>
      ))}
      <label className={`tl-sort tl-sort-more ${otherActive ? "is-active" : ""}`}>
        <span className="tl-visually-hidden">More ways to sort</span>
        <select value={otherActive ? value : ""} onChange={(event) => event.target.value && onChange(event.target.value)}>
          <option value="">More</option>
          {others.map((option) => (
            <option key={option.key} value={option.key}>{option.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
};

// "Show more tours", how far the visitor is, and page links that work without JavaScript.
export const LoadMore = ({ filters, shown, total, pages, loadMore, loading }) => {
  if (!total) return null;
  const pageHref = (page) => {
    const params = writeFilters({ ...filters, page });
    const query = params.toString();
    return query ? `/tours?${query}` : "/tours";
  };
  return (
    <nav className="tl-more-wrap" aria-label="More tours">
      <p className="tl-progress-text">
        You&apos;ve seen {shown} of {total} tours
      </p>
      <span className="tl-progress" aria-hidden="true">
        <span style={{ width: `${Math.min(100, Math.round((shown / total) * 100))}%` }} />
      </span>
      {shown < total ? (
        <button type="button" className="tl-more" onClick={loadMore} disabled={loading}>
          {loading ? "Loading…" : "Show more tours"}
        </button>
      ) : null}
      {pages > 1 ? (
        <ol className="tl-pages">
          {Array.from({ length: pages }, (_, index) => index + 1).map((page) => (
            <li key={page}>
              <Link to={pageHref(page)} aria-current={page === filters.page ? "page" : undefined} aria-label={`Page ${page}`}>
                {page}
              </Link>
            </li>
          ))}
        </ol>
      ) : null}
    </nav>
  );
};

export const EmptyState = ({ onClear }) => {
  const href = whatsappLink(SITE.whatsappHelloMessage);
  return (
    <div className="tl-empty">
      <LuSearchX aria-hidden="true" />
      <h3>No tours match these filters</h3>
      <p>Try fewer filters or another word. Or tell us what you have in mind – we&apos;ll find it for you.</p>
      <div className="tl-empty-actions">
        <button type="button" className="tl-btn-outline" onClick={onClear}>Clear filters</button>
        {href ? (
          <a href={href} className="tl-btn-link" target="_blank" rel="noreferrer">Ask us on WhatsApp</a>
        ) : null}
      </div>
    </div>
  );
};

const POPULAR = [
  { label: "Mnemba snorkeling", q: "mnemba" },
  { label: "Stone Town tour", q: "stone town" },
  { label: "Sunset dhow cruise", q: "sunset dhow" },
  { label: "Prison Island", q: "prison island" },
  { label: "Spice farm", q: "spice" },
  { label: "Safari from Zanzibar", q: "safari" }
];

// Helpful text for travellers and search engines, with popular searches.
export const SeoContent = () => (
  <section className="tl-seo" aria-labelledby="tl-seo-title">
    <div className="tl-container">
      <h2 id="tl-seo-title">Planning your Zanzibar activities</h2>
      <p>
        Most visitors combine a sea trip – snorkeling at Mnemba, the Nakupenda sandbank or a sunset dhow cruise – with a
        morning in Stone Town and a spice farm. Book a few days ahead in the high season (June to October and
        December), choose hotel pickup where it is offered, and add a fly-in or day safari to see Tanzania&apos;s
        national parks. Prices are per person unless a tour says per group, and most tours can be cancelled free of
        charge up to 24 hours before.
      </p>
      <h3>Popular searches</h3>
      <ul className="tl-popular">
        {POPULAR.map((item) => (
          <li key={item.q}>
            <Link to={`/tours?q=${encodeURIComponent(item.q)}`}>{item.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  </section>
);
