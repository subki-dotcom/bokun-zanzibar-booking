import { useEffect, useId, useState } from "react";
import { LuMessageCircle } from "react-icons/lu";
import { SITE, whatsappLink } from "../../../config/site";
import { money } from "../../homePage/homeData";

// The price slider stops here; its top end means "and more".
export const PRICE_CAP = 500;
const PRICE_STEP = 5;

const toggle = (list, key) => (list.includes(key) ? list.filter((item) => item !== key) : [...list, key]);

const CheckList = ({ legend, options, selected, onChange }) =>
  options.length ? (
    <fieldset className="tl-fieldset">
      <legend>{legend}</legend>
      {options.map((option) => (
        <label key={option.key} className="tl-check">
          <input type="checkbox" checked={selected.includes(option.key)} onChange={() => onChange(toggle(selected, option.key))} />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  ) : null;

// Two handles on one track. The price moves with the handles and is sent once they rest (400 ms).
export const PriceRangeFilter = ({ range, min, max, onChange }) => {
  const id = useId();
  const floor = Math.max(0, Math.floor((range?.min || 0) / PRICE_STEP) * PRICE_STEP);
  const ceiling = Math.max(floor + PRICE_STEP, Math.min(PRICE_CAP, Math.ceil((range?.max || PRICE_CAP) / PRICE_STEP) * PRICE_STEP));
  const [low, setLow] = useState(min || floor);
  const [high, setHigh] = useState(max || ceiling);
  useEffect(() => {
    setLow(min || floor);
    setHigh(max || ceiling);
  }, [min, max, floor, ceiling]);
  useEffect(() => {
    const nextMin = low > floor ? low : 0;
    const nextMax = high < ceiling ? high : 0;
    if (nextMin === (min || 0) && nextMax === (max || 0)) return undefined;
    const timer = setTimeout(() => onChange({ priceMin: nextMin, priceMax: nextMax }), 400);
    return () => clearTimeout(timer);
    // The handles drive this; the address follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [low, high]);
  if (!range?.max) return null;
  const highText = high >= ceiling && (range?.max || 0) > ceiling ? `${money(ceiling)}+` : money(high);
  const share = (value) => ((value - floor) / (ceiling - floor)) * 100;
  return (
    <fieldset className="tl-fieldset">
      <legend>Price per person</legend>
      <div className="tl-range" style={{ "--from": `${share(low)}%`, "--to": `${share(high)}%` }}>
        <input
          type="range"
          min={floor}
          max={ceiling}
          step={PRICE_STEP}
          value={low}
          onChange={(event) => setLow(Math.min(Number(event.target.value), high - PRICE_STEP))}
          aria-label="Lowest price"
          aria-valuetext={money(low)}
          id={`${id}-low`}
        />
        <input
          type="range"
          min={floor}
          max={ceiling}
          step={PRICE_STEP}
          value={high}
          onChange={(event) => setHigh(Math.max(Number(event.target.value), low + PRICE_STEP))}
          aria-label="Highest price"
          aria-valuetext={highText}
          id={`${id}-high`}
        />
      </div>
      <p className="tl-range-labels" aria-hidden="true">
        <span>{money(low)}</span>
        <span>{highText}</span>
      </p>
    </fieldset>
  );
};

export const CustomTourBox = () => {
  const href = whatsappLink(SITE.whatsappHelloMessage);
  return (
    <div className="tl-custom">
      <strong>Want a private or custom tour?</strong>
      <p>Send your dates and hotel – we&apos;ll plan it for you.</p>
      {href ? (
        <a href={href} className="tl-wa-btn" target="_blank" rel="noreferrer">
          <LuMessageCircle aria-hidden="true" /> Chat on WhatsApp
        </a>
      ) : null}
    </div>
  );
};

// Duration, price, time of day and "Good to know" (only the options some tour has).
export const FilterFields = ({ filters, facets, update }) => (
  <>
    <CheckList legend="Duration" options={facets?.durations || []} selected={filters.duration} onChange={(duration) => update({ duration })} />
    <PriceRangeFilter range={facets?.price} min={filters.priceMin} max={filters.priceMax} onChange={(price) => update(price, { replace: true })} />
    <CheckList legend="Time of day" options={facets?.times || []} selected={filters.time} onChange={(time) => update({ time })} />
    <CheckList legend="Good to know" options={facets?.good || []} selected={filters.good} onChange={(good) => update({ good })} />
  </>
);

export const FiltersSidebar = ({ filters, facets, update, clear, activeCount }) => (
  <aside className="tl-side" aria-labelledby="tl-filters-title">
    <div className="tl-side-head">
      <h2 id="tl-filters-title">Filters</h2>
      {activeCount ? (
        <button type="button" className="tl-link-btn" onClick={clear}>Clear all</button>
      ) : null}
    </div>
    <FilterFields filters={filters} facets={facets} update={update} />
    <CustomTourBox />
  </aside>
);
