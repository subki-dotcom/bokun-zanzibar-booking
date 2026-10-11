import { Fragment, useEffect, useMemo, useState } from "react";
import { FaCheck, FaChevronDown, FaHotel, FaLocationDot, FaMinus, FaPlane, FaPlus, FaShip } from "react-icons/fa6";
import { STEPS, COUNTRY_CODES } from "../../../utils/transferWizard";

const TYPE_ORDER = ["AIRPORT", "PORT", "HOTEL", "AREA", "OTHER"];
const TYPE_LABELS = { AIRPORT: "Airports", PORT: "Ports & ferry terminals", HOTEL: "Hotels", AREA: "Areas", OTHER: "Other places" };

export const LocationIcon = ({ type }) => {
  if (type === "AIRPORT") return <FaPlane aria-hidden="true" />;
  if (type === "PORT") return <FaShip aria-hidden="true" />;
  if (type === "HOTEL") return <FaHotel aria-hidden="true" />;
  return <FaLocationDot aria-hidden="true" />;
};

export const FieldError = ({ id, children }) => (children ? <div id={id} className="tw-error">{children}</div> : null);

// Progress across the four steps. Completed steps can be reopened; later steps cannot be skipped to.
export const StepProgress = ({ current, onGo }) => (
  <nav className="tw-progress" aria-label="Booking steps">
    <ol>
      {STEPS.map((step, index) => {
        const state = index < current ? "is-done" : index === current ? "is-current" : "";
        const content = (
          <>
            <span className="tw-progress-dot" aria-hidden="true">{index < current ? <FaCheck /> : index + 1}</span>
            <span className="tw-progress-label">{step.label}</span>
            {index < current ? <span className="visually-hidden"> (completed)</span> : null}
          </>
        );
        return (
          <li key={step.id} className={state} aria-current={index === current ? "step" : undefined}>
            {index < current ? (
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
