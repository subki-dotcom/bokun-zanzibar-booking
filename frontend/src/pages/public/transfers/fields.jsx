import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { FaCheck, FaChevronDown, FaHotel, FaLocationDot, FaMinus, FaPlane, FaPlus, FaShip, FaUserGroup } from "react-icons/fa6";
import { COUNTRY_CODES, PROGRESS_STEPS, STEPS, travellerSummary } from "../../../utils/transferWizard";

const TYPE_ORDER = ["AIRPORT", "PORT", "HOTEL", "AREA", "OTHER"];
const TYPE_LABELS = { AIRPORT: "Airports", PORT: "Ports & ferry terminals", HOTEL: "Hotels", AREA: "Areas", OTHER: "Other places" };

export const LocationIcon = ({ type }) => {
  if (type === "AIRPORT") return <FaPlane aria-hidden="true" />;
  if (type === "PORT") return <FaShip aria-hidden="true" />;
  if (type === "HOTEL") return <FaHotel aria-hidden="true" />;
  return <FaLocationDot aria-hidden="true" />;
};

export const FieldError = ({ id, children }) => (children ? <div id={id} className="tw-error">{children}</div> : null);

// Progress across Search → Vehicle → Details → Payment → Confirmed. Completed steps the customer filled in can be
// reopened (when onGo is given); later steps cannot be skipped to. `complete` marks every step done (a verified
// payment).
export const StepProgress = ({ current, onGo, complete = false }) => (
  <nav className="tw-progress" aria-label="Booking steps">
    <ol>
      {PROGRESS_STEPS.map((label, index) => {
        const done = complete || index < current;
        const state = done ? "is-done" : index === current ? "is-current" : "";
        const content = (
          <>
            <span className="tw-progress-dot" aria-hidden="true">{done ? <FaCheck /> : index + 1}</span>
            <span className="tw-progress-label">{label}</span>
            {done ? <span className="visually-hidden"> (completed)</span> : null}
          </>
        );
        const reopenable = onGo && done && !complete && index < STEPS.length;
        return (
          <li key={label} className={state} aria-current={!complete && index === current ? "step" : undefined}>
            {reopenable ? (
              <button type="button" className="tw-progress-item" onClick={() => onGo(index)}>{content}</button>
            ) : (
              <span className="tw-progress-item">{content}</span>
            )}
          </li>
        );
      })}
    </ol>
  </nav>
);

// Travellers and luggage in one compact control: the bar shows "2 Adults, 1 Child", the panel holds the counters.
// It closes with Done, Escape or a click outside.
export const TravellerSelector = ({ form, set, errors }) => {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (root.current && !root.current.contains(event.target)) setOpen(false);
    };
    const escape = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        document.getElementById("transfer-travellers")?.focus();
      }
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const error = errors.adults || errors.children || errors.infants || errors.largeBags || errors.smallBags;
  const large = Number(form.largeBags) || 0;
  const small = Number(form.smallBags) || 0;
  const bags = large + small ? ` · ${large + small} bag${large + small === 1 ? "" : "s"}` : "";
  return (
    <div className={`tw-field tw-travellers ${error ? "is-invalid" : ""}`} ref={root}>
      <span className="tw-label" id="transfer-travellers-label">Travelers</span>
      <button
        type="button"
        id="transfer-travellers"
        className="tw-input tw-travellers-toggle"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="transfer-travellers-panel"
        aria-labelledby="transfer-travellers-label transfer-travellers"
        aria-describedby={error ? "transfer-passengers-error" : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <FaUserGroup className="tw-travellers-icon" aria-hidden="true" />
        <span className="tw-travellers-text">{travellerSummary(form)}{bags}</span>
        <FaChevronDown className="tw-control-chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div id="transfer-travellers-panel" className="tw-travellers-panel" role="dialog" aria-label="Travelers and luggage">
          <Counter id="transfer-adults" label="Adults" hint="12+ years" value={form.adults} min={1} onChange={set("adults")} invalid={errors.adults} />
          <Counter id="transfer-children" label="Children" hint="4–11 years" value={form.children} onChange={set("children")} invalid={errors.children} />
          <Counter id="transfer-infants" label="Infants" hint="0–3 years, need a seat" value={form.infants} onChange={set("infants")} invalid={errors.infants} />
          <Counter id="transfer-largeBags" label="Large luggage" hint="Suitcases" value={form.largeBags} max={40} onChange={set("largeBags")} invalid={errors.largeBags} />
          <Counter id="transfer-smallBags" label="Small luggage" hint="Backpacks, hand luggage" value={form.smallBags} max={40} onChange={set("smallBags")} invalid={errors.smallBags} />
          <p className="tw-help mb-2">Infants need their own seat, so they count towards the vehicle&apos;s capacity.</p>
          <button type="button" className="tw-btn tw-btn-navy tw-travellers-done" onClick={() => { setOpen(false); document.getElementById("transfer-travellers")?.focus(); }}>Done</button>
        </div>
      ) : null}
      <FieldError id="transfer-passengers-error">{error}</FieldError>
    </div>
  );
};

// A searchable place picker (ARIA combobox). Typing filters the configured places; arrows, Enter and Escape work
// from the keyboard, and a tap selects on touch screens.
export const LocationCombobox = ({ id, label, value, locations, exclude, onChange, error, placeholder }) => {
  const selected = locations.find((location) => location.id === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const listId = `${id}-options`;
  const search = query.trim().toLowerCase();
  const options = useMemo(
    () => TYPE_ORDER.flatMap((type) => locations.filter((location) => location.type === type && (!search || location.name.toLowerCase().includes(search)))),
    [locations, search]
  );
  const optionId = (location) => `${listId}-${location.id}`;

  useEffect(() => {
    if (open && options[active]) document.getElementById(optionId(options[active]))?.scrollIntoView?.({ block: "nearest" });
    // optionId depends only on listId, which never changes.
  }, [open, active, options]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setActive(-1);
  };
  const choose = (location) => {
    if (!location || location.id === exclude) return;
    onChange(location.id);
    close();
  };
  const onKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(options.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      choose(options[active]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
    }
  };

  return (
    <div className={`tw-field tw-combo ${error ? "is-invalid" : ""}`}>
      <label htmlFor={id} className="tw-label">{label}</label>
      <div className="tw-control">
        <span className="tw-control-icon"><LocationIcon type={selected?.type} /></span>
        <input
          id={id}
          className="tw-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? optionId(options[active]) : undefined}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={selected?.name || placeholder}
          value={open ? query : selected?.name || ""}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={close}
          onKeyDown={onKeyDown}
        />
        <FaChevronDown className="tw-control-chevron" aria-hidden="true" />
      </div>
      {open ? (
        <ul id={listId} role="listbox" aria-label={label} className="tw-combo-list">
          {options.length ? (
            options.map((location, index) => (
              <Fragment key={location.id}>
                {index === 0 || options[index - 1].type !== location.type ? (
                  <li role="presentation" className="tw-combo-group">{TYPE_LABELS[location.type]}</li>
                ) : null}
                <li
                  id={optionId(location)}
                  role="option"
                  aria-selected={location.id === value}
                  aria-disabled={location.id === exclude}
                  className={`tw-combo-option ${index === active ? "is-active" : ""}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(location);
                  }}
                  onMouseEnter={() => setActive(index)}
                >
                  <LocationIcon type={location.type} />
                  <span>{location.name}</span>
                  {location.id === value ? <FaCheck className="tw-combo-check" aria-hidden="true" /> : null}
                </li>
              </Fragment>
            ))
          ) : (
            <li role="presentation" className="tw-combo-empty">No matching places. Try another name.</li>
          )}
        </ul>
      ) : null}
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  );
};

// A number with large minus and plus buttons; the number can also be typed.
export const Counter = ({ id, label, hint, value, min = 0, max = 99, onChange, invalid }) => {
  const number = Number(value) || 0;
  return (
    <div className={`tw-counter ${invalid ? "is-invalid" : ""}`}>
      <label htmlFor={id} className="tw-counter-label">{label}</label>
      {hint ? <span className="tw-counter-hint">{hint}</span> : null}
      <div className="tw-counter-control">
        <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} onClick={() => onChange(Math.max(min, number - 1))} disabled={number <= min}>
          <FaMinus aria-hidden="true" />
        </button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          aria-invalid={Boolean(invalid)}
          onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}
        />
        <button type="button" aria-label={`More ${label.toLowerCase()}`} onClick={() => onChange(Math.min(max, number + 1))} disabled={number >= max}>
          <FaPlus aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

// Country code plus local number. Typing a number that starts with "+" uses that code instead.
export const PhoneField = ({ country, national, onCountry, onNational, error }) => (
  <div className={`tw-field ${error ? "is-invalid" : ""}`}>
    <label htmlFor="transfer-phone" className="tw-label">Phone <span className="tw-required" aria-hidden="true">*</span></label>
    <div className="tw-phone">
      <select
        id="transfer-phoneCountry"
        className="tw-input tw-select"
        aria-label="Country code"
        value={country}
        onChange={(event) => onCountry(event.target.value)}
        aria-invalid={Boolean(error)}
        autoComplete="tel-country-code"
      >
        <option value="">Code</option>
        {COUNTRY_CODES.map(([code, name]) => <option key={`${code}-${name}`} value={code}>{name} ({code})</option>)}
      </select>
      <input
        id="transfer-phone"
        className="tw-input"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        maxLength={24}
        placeholder="Phone number"
        value={national}
        onChange={(event) => onNational(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={`transfer-phone-help${error ? " transfer-phone-error" : ""}`}
        required
      />
    </div>
    <div id="transfer-phone-help" className="tw-help">Choose your country code, or type the number starting with +.</div>
    <FieldError id="transfer-phone-error">{error}</FieldError>
  </div>
);
