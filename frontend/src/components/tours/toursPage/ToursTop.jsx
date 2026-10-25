import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LuCalendar, LuCheck, LuMinus, LuPlus, LuSearch, LuUser } from "react-icons/lu";
import { shortDate, todayIso, travelersText } from "../../homePage/homeData";

// Breadcrumb, H1, the size of the catalogue and three promises.
export const ToursIntro = ({ total = 0 }) => (
  <section className="tl-intro">
    <div className="tl-container tl-intro-row">
      <div>
        <nav className="tl-crumbs" aria-label="Breadcrumb">
          <Link to="/">Home</Link> <span aria-hidden="true">/</span> <span aria-current="page">Tours &amp; activities</span>
        </nav>
        <h1>Tours &amp; activities in Zanzibar</h1>
        <p className="tl-lead tl-hide-phone">
          {total ? `${total} experiences` : "Experiences"} with live prices and availability – sea trips, Stone Town, spice farms, safaris and transfers.
        </p>
        <p className="tl-lead tl-show-phone">
          {total ? `${total} experiences · ` : ""}live prices · free cancellation on most tours
        </p>
      </div>
      <ul className="tl-promises tl-hide-phone">
        {["Free cancellation", "Hotel pickup options", "Secure payment"].map((item) => (
          <li key={item}>
            <LuCheck aria-hidden="true" /> {item}
          </li>
        ))}
      </ul>
    </div>
  </section>
);

// Travellers: a stepper in a small popover.
export const TravelersButton = ({ value, onChange }) => {
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
    <div className="tl-pop-wrap" ref={wrap}>
      <button type="button" className="tl-tool-btn" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <LuUser aria-hidden="true" /> {travelersText(value)}
      </button>
      {open ? (
        <div className="tl-popover" role="group" aria-label="Number of travelers">
          <span>Travelers</span>
          <div className="tl-stepper">
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

// Date: the browser's date picker behind a button; "Any date" clears it.
export const DateButton = ({ value, onChange, round = false }) => {
  const input = useRef(null);
  const open = () => {
    try {
      input.current?.showPicker?.();
    } catch {
      input.current?.focus();
    }
  };
  return (
    <span className={`tl-date ${round ? "is-round" : ""}`}>
      <button type="button" className="tl-tool-btn" onClick={open} aria-label={value ? `Date: ${shortDate(value)}. Change date` : "Choose a date"}>
        <LuCalendar aria-hidden="true" />
        {round ? null : <span>{value ? shortDate(value) : "Any date"}</span>}
      </button>
      <input
        ref={input}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        min={todayIso()}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && !round ? (
        <button type="button" className="tl-clear-date" onClick={() => onChange("")} aria-label="Any date">
          ×
        </button>
      ) : null}
    </span>
  );
};

// Search box (typing waits 300 ms), date, travellers and "Search".
export const ToursToolbar = ({ filters, update }) => {
  const [text, setText] = useState(filters.q);
  useEffect(() => setText(filters.q), [filters.q]);
  useEffect(() => {
    if (text.trim() === filters.q) return undefined;
    const timer = setTimeout(() => update({ q: text.trim() }, { replace: true }), 300);
    return () => clearTimeout(timer);
    // filters.q is compared, not followed: typing drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  const submit = (event) => {
    event.preventDefault();
    update({ q: text.trim() });
  };
  return (
    <form className="tl-tools" role="search" onSubmit={submit}>
      <label className="tl-search">
        <LuSearch aria-hidden="true" />
        <span className="tl-visually-hidden">Search tours</span>
        <input type="search" value={text} placeholder="Search tours, places or keywords" onChange={(event) => setText(event.target.value)} />
      </label>
      <DateButton value={filters.date} onChange={(date) => update({ date })} />
      <TravelersButton value={filters.pax} onChange={(pax) => update({ pax }, { replace: true })} />
      <button type="submit" className="tl-search-btn">Search</button>
    </form>
  );
};

// All · Sea tours · Cultural tours…, with their counts (styles without tours are left out).
export const CategoryChips = ({ facets, active, onChange, short = false }) => {
  if (!facets) return <div className="tl-chips tl-chips-loading" aria-hidden="true" />;
  const chips = [{ key: "", label: "All", count: facets.total }, ...facets.categories];
  const shortLabel = (label) => (short ? label.replace(" tours", "").replace("Safari trips", "Safaris") : label);
  return (
    <div className="tl-chips" role="group" aria-label="Category">
      {chips.map((chip) => (
        <button key={chip.key || "all"} type="button" className="tl-chip" aria-pressed={active === chip.key} onClick={() => onChange(chip.key)}>
          {shortLabel(chip.label)} <span className="tl-chip-count">{chip.count}</span>
        </button>
      ))}
    </div>
  );
};
