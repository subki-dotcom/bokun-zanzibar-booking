import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LuSearch } from "react-icons/lu";
import { BRAND } from "../../../config/brand";

// Site header on the tour page (desktop): logo, tour search (opens the tour list filtered by the text) and links.
const TourHeader = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const submit = (event) => {
    event.preventDefault();
    const text = query.trim();
    navigate(text ? `/tours?q=${encodeURIComponent(text)}` : "/tours");
  };

  return (
    <header className="tp-header">
      <div className="tp-header-inner">
        <Link to="/" className="tp-logo" aria-label={`${BRAND.name} home`}>
          <span className="tp-logo-mark" aria-hidden="true">{BRAND.name.charAt(0)}</span>
          <strong>{BRAND.name}</strong>
        </Link>
        <form className="tp-search" role="search" onSubmit={submit}>
          <LuSearch aria-hidden="true" />
          <label htmlFor="tp-search-input" className="tp-visually-hidden">Search Zanzibar tours</label>
          <input
            id="tp-search-input"
            type="search"
            value={query}
            placeholder="Search Zanzibar tours"
            onChange={(event) => setQuery(event.target.value)}
          />
        </form>
        <nav className="tp-nav" aria-label="Main">
          <Link to="/tours">Tours</Link>
          <Link to="/my-booking">My booking</Link>
        </nav>
      </div>
    </header>
  );
};

export default TourHeader;
