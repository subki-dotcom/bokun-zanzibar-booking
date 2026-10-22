import { useEffect, useId, useMemo, useRef, useState } from "react";
import { LuChevronDown, LuSearch } from "react-icons/lu";
import { phoneCountry, searchPhoneCountries } from "./phone";

// Phone (WhatsApp): a searchable country-code button ("GB +44 ▾") joined to the number field.
const PhoneInput = ({ id, country, value, onCountry, onChange, onBlur, inputProps = {} }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const buttonRef = useRef(null);
  const listId = useId();
  const selected = phoneCountry(country);
  const matches = useMemo(() => searchPhoneCountries(query), [query]);

  useEffect(() => {
    if (!open) return undefined;
    setActive(Math.max(0, matches.findIndex((item) => item.iso === selected?.iso)));
    searchRef.current?.focus();
    const close = (event) => {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
    // Only when the list opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (item) => {
    onCountry(item.iso);
    setOpen(false);
    setQuery("");
    buttonRef.current?.focus();
  };

  const onKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(matches.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (matches[active]) choose(matches[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  return (
    <div className="ck-phone" ref={wrapRef}>
      <div className={`ck-phone-row ${inputProps["aria-invalid"] ? "is-invalid" : ""}`}>
        <button
          ref={buttonRef}
          type="button"
          className="ck-phone-code"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Country code: ${selected ? `${selected.name} +${selected.dial}` : "choose"}`}
          onClick={() => setOpen((current) => !current)}
        >
          {selected ? `${selected.iso} +${selected.dial}` : "+"}
          <LuChevronDown aria-hidden="true" />
        </button>
        <input
          {...inputProps}
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={20}
          value={value}
          placeholder="7700 900123"
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
      </div>
      {open ? (
        <div className="ck-phone-pop">
          <div className="ck-search">
            <LuSearch aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder="Search country or code"
              aria-label="Search country or code"
              aria-controls={listId}
              aria-activedescendant={matches[active] ? `${listId}-${matches[active].iso}` : undefined}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          <ul id={listId} ref={listRef} role="listbox" aria-label="Country codes">
            {matches.map((item, index) => (
              <li
                key={item.iso}
                id={`${listId}-${item.iso}`}
                data-index={index}
                role="option"
                aria-selected={item.iso === selected?.iso}
                className={index === active ? "is-active" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(item)}
              >
                <span>{item.name}</span>
                <span className="ck-muted">+{item.dial}</span>
              </li>
            ))}
            {!matches.length ? <li className="ck-muted ck-empty">No country found</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
};

export default PhoneInput;
