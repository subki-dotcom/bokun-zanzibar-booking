import { useEffect, useRef, useState } from "react";
import { LuCheck, LuChevronDown, LuSlidersHorizontal, LuX } from "react-icons/lu";
import { fetchToursPage } from "../../../api/toursApi";
import useDialogFocus from "../../common/siteHeader/useDialogFocus";
import { PriceRangeFilter } from "./ToursFilters";
import { DateButton } from "./ToursTop";
import { SORT_OPTIONS, activeFilterCount, apiQuery, shortSortLabel } from "./toursPageData";

const SHORT_DURATIONS = { short: "Up to 4 h", "half-day": "Half day", "full-day": "Full day", "multi-day": "Multi-day" };
const SHORT_CATEGORIES = { "Cultural tours": "Cultural", "Private tours": "Private" };

// Phones: Filters (with how many are on) · Sort · date, under the category chips.
export const MobileFilterBar = ({ filters, onFilters, onSort, onDate }) => {
  const count = activeFilterCount(filters);
  return (
    <div className="tl-mbar">
      <button type="button" className="tl-tool-btn tl-mbar-filters" onClick={onFilters} aria-haspopup="dialog">
        <LuSlidersHorizontal aria-hidden="true" /> Filters
        {count ? (
          <span className="tl-mbar-count" aria-label={`${count} on`}>{count}</span>
        ) : null}
      </button>
      <button type="button" className="tl-tool-btn tl-mbar-sort" onClick={onSort} aria-haspopup="dialog">
        Sort: {shortSortLabel(filters.sort)}
        <LuChevronDown aria-hidden="true" />
      </button>
      <DateButton value={filters.date} onChange={onDate} round />
    </div>
  );
};

// A sheet that slides up from the bottom; Esc, the close button, the backdrop or a swipe down closes it.
const Sheet = ({ title, onClose, children, footer = null, head = null, className = "" }) => {
  const panel = useRef(null);
  const start = useRef(null);
  const [drag, setDrag] = useState(0);
  useDialogFocus(panel, onClose);
  const onTouchStart = (event) => {
    start.current = event.touches[0].clientY;
  };
  const onTouchMove = (event) => {
    if (start.current === null) return;
    setDrag(Math.max(0, event.touches[0].clientY - start.current));
  };
  const onTouchEnd = () => {
    if (drag > 90) onClose();
    setDrag(0);
    start.current = null;
  };
  return (
    <div className="tl-sheet-layer">
      <button type="button" className="tl-sheet-backdrop" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <div
        className={`tl-sheet ${className}`}
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={drag ? { transform: `translateY(${drag}px)` } : undefined}
      >
        <div className="tl-sheet-grab" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          <span aria-hidden="true" />
          <div className="tl-sheet-head">
            <h2>{title}</h2>
            {head}
            <button type="button" className="tl-sheet-close" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`}>
              <LuX aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="tl-sheet-body">{children}</div>
        {footer ? <div className="tl-sheet-foot">{footer}</div> : null}
      </div>
    </div>
  );
};

// Filters on phones. Changes stay in the sheet until "Show N tours"; N is counted live as they change.
export const FiltersSheet = ({ filters, facets, onApply, onClose }) => {
  const [draft, setDraft] = useState(filters);
  const [count, setCount] = useState(null);
  const set = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const toggle = (key, value) => set({ [key]: draft[key].includes(value) ? draft[key].filter((item) => item !== value) : [...draft[key], value] });

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      fetchToursPage(apiQuery(draft, { page: 1, limit: 1 }))
        .then((data) => active && setCount(data.total))
        .catch(() => active && setCount(null));
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [draft]);

  const clearAll = () => set({ category: "", duration: [], time: [], good: [], priceMin: 0, priceMax: 0 });
  const categories = [{ key: "", label: "All" }, ...(facets?.categories || [])];

  return (
    <Sheet
      title="Filters"
      onClose={onClose}
      head={
        <button type="button" className="tl-link-btn" onClick={clearAll}>Clear all</button>
      }
      footer={
        <button type="button" className="tl-sheet-apply" onClick={() => onApply(draft)} disabled={count === 0}>
          {count === null ? "Show tours" : count === 0 ? "No tours match" : `Show ${count} tour${count === 1 ? "" : "s"}`}
        </button>
      }
    >
      <fieldset className="tl-sheet-section">
        <legend>Category</legend>
        <div className="tl-sheet-chips">
          {categories.map((category) => (
            <button key={category.key || "all"} type="button" className="tl-chip" aria-pressed={draft.category === category.key} onClick={() => set({ category: category.key })}>
              {SHORT_CATEGORIES[category.label] || category.label}
            </button>
          ))}
        </div>
      </fieldset>

      {facets?.durations?.length ? (
        <fieldset className="tl-sheet-section">
          <legend>Duration</legend>
          <div className="tl-tiles">
            {facets.durations.map((duration) => (
              <button key={duration.key} type="button" className="tl-tile" aria-pressed={draft.duration.includes(duration.key)} onClick={() => toggle("duration", duration.key)}>
                {SHORT_DURATIONS[duration.key] || duration.label}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="tl-sheet-section tl-sheet-price">
        <PriceRangeFilter range={facets?.price} min={draft.priceMin} max={draft.priceMax} onChange={(price) => set(price)} />
      </div>

      {facets?.good?.length ? (
        <fieldset className="tl-sheet-section">
          <legend>Good to know</legend>
          {facets.good.map((option) => (
            <label key={option.key} className="tl-switch">
              <span>{option.label}</span>
              <input type="checkbox" role="switch" checked={draft.good.includes(option.key)} onChange={() => toggle("good", option.key)} />
            </label>
          ))}
        </fieldset>
      ) : null}
    </Sheet>
  );
};

export const SortSheet = ({ value, onChange, onClose }) => (
  <Sheet title="Sort by" onClose={onClose} className="is-small">
    <ul className="tl-sort-list" role="radiogroup" aria-label="Sort by">
      {SORT_OPTIONS.map((option) => (
        <li key={option.key}>
          <button type="button" role="radio" aria-checked={value === option.key} onClick={() => onChange(option.key)}>
            {option.label}
            {value === option.key ? <LuCheck aria-hidden="true" /> : null}
          </button>
        </li>
      ))}
    </ul>
  </Sheet>
);
